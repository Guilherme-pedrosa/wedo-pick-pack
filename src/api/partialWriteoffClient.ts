import { supabase } from '@/integrations/supabase/client';
import type {
  PartialBudgetSearchResult,
  PartialWriteoffOperation,
} from './partialWriteoff';

type DocumentType = 'os' | 'venda';
type BudgetKind = PartialBudgetSearchResult['budget_kind'];
const EXISTING_SALE_FINAL_STATUS_ID = '8955109';
type AuthContext = {
  id: string;
  email: string;
  name: string;
  profile: Record<string, any>;
};

const cloud = supabase as any;

function compact(value: unknown): string {
  if (value == null) return '';
  const raw = value instanceof Error
    ? value.message
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function apiError(payload: any): string {
  const values = [
    payload?.message,
    payload?.mensagem,
    payload?.erro,
    payload?.error,
    payload?.data?.mensagem,
    payload?.data?.erro,
    payload?.data?.message,
    payload?.raw,
  ].map(compact).filter(Boolean);
  return [...new Set(values)].slice(0, 4).join(' | ');
}

async function gcRequest(path: string, method = 'GET', body?: unknown): Promise<any> {
  const { data, error } = await supabase.functions.invoke('gc-proxy', {
    body: { path, method, payload: body },
  });
  if (error) throw new Error(error.message || `GestaoClick ${method} ${path}`);
  if (!data?._proxy?.ok) {
    const status = data?._proxy?.gc_http_status || 500;
    throw new Error(`GestaoClick ${method} ${path} (${status}): ${apiError(data) || 'falha na integracao'}`);
  }
  return data;
}

async function authenticate(): Promise<AuthContext> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('AUTH_REQUIRED');

  const { data: profile } = await cloud
    .from('profiles')
    .select('name, auvo_user_id, gc_usuario_id, default_os_conclusion_status, default_venda_conclusion_status')
    .eq('id', data.user.id)
    .maybeSingle();

  return {
    id: data.user.id,
    email: data.user.email || '',
    name: profile?.name || data.user.email || 'Operador',
    profile: profile || {},
  };
}

function numberValue(value: unknown): number {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function qtyString(value: number): string {
  return String(Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000);
}

function normalizeId(value: unknown): string {
  const id = String(value ?? '').trim();
  return ['0', 'null', 'undefined'].includes(id.toLowerCase()) ? '' : id;
}

function unwrapProductLine(line: any): any {
  return line?.produto || line?.Produto || line || {};
}

function lineKey(product: any, index: number): string {
  return `${normalizeId(product.produto_id)}::${normalizeId(product.variacao_id)}::${index}`;
}

export function documentTypeForBudgetKind(kind: BudgetKind | undefined, budget: any): DocumentType {
  if (kind === 'produto' || kind === 'venda') return 'venda';
  if (kind === 'servico') return 'os';
  const hasServices = Array.isArray(budget?.servicos) && budget.servicos.length > 0;
  return hasServices || numberValue(budget?.valor_servicos) > 0 ? 'os' : 'venda';
}

export function isBudgetEligibleForPartialWriteoff(budget: any): boolean {
  const status = String(budget?.nome_situacao || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
  const generatedDocument = /\b(os|venda)\b.*\bgerad[ao]\b|\bgerad[ao]\b.*\b(os|venda)\b/.test(status);
  return !generatedDocument;
}

export function isSaleEligibleForPartialWriteoff(sale: any): boolean {
  return String(sale?.situacao_estoque ?? '').trim() === '0';
}

function isSourceEligibleForPartialWriteoff(kind: BudgetKind, source: any): boolean {
  return kind === 'venda'
    ? isSaleEligibleForPartialWriteoff(source)
    : isBudgetEligibleForPartialWriteoff(source);
}

function operationSourceKind(operation: PartialWriteoffOperation): BudgetKind | undefined {
  const kind = (operation.budget_snapshot as any)?._partial_source_kind;
  return kind === 'produto' || kind === 'servico' || kind === 'venda' ? kind : undefined;
}

function sourceOperationKey(kind: BudgetKind, sourceId: string): string {
  return kind === 'venda' ? `venda:${sourceId}` : sourceId;
}

function operationSourceId(operation: PartialWriteoffOperation): string {
  const snapshotId = normalizeId((operation.budget_snapshot as any)?._partial_source_id);
  if (snapshotId) return snapshotId;
  return operationSourceKind(operation) === 'venda'
    ? operation.budget_id.replace(/^venda:/, '')
    : operation.budget_id;
}

function operationItemsFromBudget(budget: any) {
  return (budget?.produtos || []).map((line: any, index: number) => {
    const product = unwrapProductLine(line);
    return {
      line_key: lineKey(product, index),
      product_id: normalizeId(product.produto_id),
      variation_id: normalizeId(product.variacao_id),
      product_name: String(product.nome_produto || 'Produto').trim(),
      product_code: String(product.codigo_produto || '').trim(),
      unit: String(product.sigla_unidade || 'UN').trim(),
      original_quantity: numberValue(product.quantidade),
      line_snapshot: line,
    };
  }).filter((item: any) => item.product_id && item.original_quantity > 0);
}

async function fetchSource(id: string, kind: BudgetKind): Promise<any> {
  const collection = kind === 'venda' ? '/api/vendas' : '/api/orcamentos';
  const response = await gcRequest(`${collection}/${encodeURIComponent(id)}`);
  if (!response?.data?.id) throw new Error('BUDGET_NOT_FOUND');
  return response.data;
}

async function searchBudgets(term: string, kind: BudgetKind): Promise<Array<any & { budget_kind: BudgetKind }>> {
  const value = term.trim();
  if (value.length < 2) throw new Error('SEARCH_TOO_SHORT');
  if (kind !== 'produto' && kind !== 'servico' && kind !== 'venda') throw new Error('SEARCH_BUDGET_KIND_REQUIRED');
  const encoded = encodeURIComponent(value);
  const collection = kind === 'produto'
    ? '/api/orcamentos_produtos'
    : kind === 'servico' ? '/api/orcamentos_servicos' : '/api/vendas';
  const requests = [
    `${collection}?pagina=1&limite=100&codigo=${encoded}`,
    `${collection}?pagina=1&limite=100&nome=${encoded}`,
    `${collection}?pagina=1&limite=100&pesquisa=${encoded}`,
  ];
  const settled = await Promise.allSettled(requests.map(path => gcRequest(path)));
  const rows = settled.flatMap(result => result.status === 'fulfilled'
    ? (result.value?.data || []).map((row: any) => ({
        ...row,
        budget_kind: kind,
        eligible_for_partial_writeoff: isSourceEligibleForPartialWriteoff(kind, row),
      }))
    : []);
  const normalized = value.toLocaleLowerCase('pt-BR').replace(/\D/g, '');
  const byId = new Map<string, any>();
  for (const row of rows) {
    const haystack = `${row.codigo || ''} ${row.nome_cliente || ''} ${row.cpf_cnpj || ''} ${row.cnpj || ''}`.toLocaleLowerCase('pt-BR');
    const digits = haystack.replace(/\D/g, '');
    if (haystack.includes(value.toLocaleLowerCase('pt-BR')) || (normalized.length >= 3 && digits.includes(normalized))) {
      byId.set(`${row.budget_kind}:${row.id}`, row);
    }
  }
  return [...byId.values()]
    .sort((a, b) => {
      const exactA = String(a.codigo || '') === value ? 0 : 1;
      const exactB = String(b.codigo || '') === value ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;
      return String(b.codigo || '').localeCompare(String(a.codigo || ''), 'pt-BR', { numeric: true });
    })
    .slice(0, 50);
}

function unwrapProductDetail(response: any): any {
  return response?.data?.Produto || response?.data?.produto || response?.data || {};
}

function currentStock(detail: any, variationId: string): number {
  if (variationId && Array.isArray(detail?.variacoes)) {
    const match = detail.variacoes.find((entry: any) => {
      const variation = entry?.variacao || entry;
      return normalizeId(variation?.id || variation?.variacao_id) === variationId;
    });
    if (match) return numberValue((match?.variacao || match)?.estoque);
  }
  return numberValue(detail?.estoque);
}

async function getOperationGraph(operationId: string): Promise<PartialWriteoffOperation> {
  const [operationResult, itemsResult, batchesResult] = await Promise.all([
    cloud.from('partial_writeoff_operations').select('*').eq('id', operationId).single(),
    cloud.from('partial_writeoff_item_balances').select('*').eq('operation_id', operationId).order('created_at'),
    cloud.from('partial_writeoff_batches').select('*').eq('operation_id', operationId).order('sequence'),
  ]);
  if (operationResult.error) throw operationResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (batchesResult.error) throw batchesResult.error;
  return {
    ...operationResult.data,
    items: itemsResult.data || [],
    batches: batchesResult.data || [],
  } as PartialWriteoffOperation;
}

async function listOperationGraphs(): Promise<PartialWriteoffOperation[]> {
  const { data: operations, error } = await cloud
    .from('partial_writeoff_operations')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  if (!operations?.length) return [];

  const ids = operations.map((operation: any) => operation.id);
  const [itemsResult, batchesResult] = await Promise.all([
    cloud.from('partial_writeoff_item_balances').select('*').in('operation_id', ids).order('created_at'),
    cloud.from('partial_writeoff_batches').select('*').in('operation_id', ids).order('sequence'),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (batchesResult.error) throw batchesResult.error;
  return operations.map((operation: any) => ({
    ...operation,
    items: (itemsResult.data || []).filter((item: any) => item.operation_id === operation.id),
    batches: (batchesResult.data || []).filter((batch: any) => batch.operation_id === operation.id),
  })) as PartialWriteoffOperation[];
}

async function getSettings(): Promise<Record<string, string>> {
  const { data, error } = await cloud
    .from('partial_writeoff_settings')
    .select('*')
    .eq('singleton', true)
    .single();
  if (error) throw error;
  return data as Record<string, string>;
}

function selectedLine(snapshot: any, quantity: number): any {
  const cloned = structuredClone(snapshot || {});
  const product = unwrapProductLine(cloned);
  const originalQuantity = numberValue(product.quantidade);
  const ratio = originalQuantity > 0 ? quantity / originalQuantity : 1;
  product.quantidade = qtyString(quantity);

  if (originalQuantity > 0 && product.valor_total != null && String(product.valor_total).trim() !== '') {
    product.valor_total = (numberValue(product.valor_total) * ratio).toFixed(2);
  }
  const discountKind = String(product.desconto_tipo || product.tipo_desconto || '').toLocaleLowerCase('pt-BR');
  const isPercentageDiscount = discountKind.includes('porcent') || discountKind.includes('percent') || discountKind.includes('%');
  if (!isPercentageDiscount && originalQuantity > 0 && product.desconto_valor != null && String(product.desconto_valor).trim() !== '') {
    product.desconto_valor = (numberValue(product.desconto_valor) * ratio).toFixed(2);
  }
  return cloned;
}

function budgetAttributeValue(budget: Record<string, any>, attributeId: string, nameHint?: string): string {
  for (const entry of budget.atributos || []) {
    const attribute = entry?.atributo || entry;
    const id = String(attribute?.atributo_id || attribute?.id || '');
    const name = String(attribute?.nome || attribute?.atributo || '').toLowerCase();
    const matchesId = id === attributeId;
    const matchesName = !!nameHint && name.includes(nameHint);
    if (matchesId || matchesName) {
      const value = String(attribute?.conteudo ?? '').trim();
      if (value) return value;
    }
  }
  return '';
}

/**
 * Os IDs dos campos do orçamento são diferentes dos IDs exigidos na OS.
 * Mantém o mesmo mapeamento usado pelo fluxo funcional de geração do Rastreador
 * (generate-os): 73341 -> 73343/73344, 73350 -> 68658, 67350 -> 73897.
 * Nenhum conteúdo pode ir vazio: o GestãoClick trata vazio como "não enviado".
 */
function auxiliaryOsAttributes(operation: PartialWriteoffOperation, budgetOverride?: Record<string, any>) {
  const budget = budgetOverride || operation.budget_snapshot || {};
  const sourceTaskId = budgetAttributeValue(budget, '73341', 'tarefa os');
  const localReparo = budgetAttributeValue(budget, '73350', 'local do reparo');
  const horas = budgetAttributeValue(budget, '67350', 'horas');
  return [
    { atributo: { atributo_id: '81831', conteudo: String(operation.budget_code || '-') } },
    { atributo: { atributo_id: '73343', conteudo: sourceTaskId || '-' } },
    { atributo: { atributo_id: '73344', conteudo: sourceTaskId || '-' } },
    { atributo: { atributo_id: '68658', conteudo: localReparo || 'CLIENTE' } },
    { atributo: { atributo_id: '73897', conteudo: horas || '0' } },
  ];
}

function auxiliaryPayload(
  operation: PartialWriteoffOperation,
  selected: Array<{ item: any; quantity: number }>,
  waitingStatusId: string,
  marker: string,
  gcUserId?: string,
  budgetOverride?: Record<string, any>,
) {
  const budget = budgetOverride || operation.budget_snapshot || {};

  const products = selected.map(({ item, quantity }) => selectedLine(item.line_snapshot, quantity));
  const sourceLabel = operationSourceKind(operation) === 'venda' ? 'da venda' : 'do orcamento';
  const note = `[${marker}] BAIXA PARCIAL ${sourceLabel} #${operation.budget_code}. Documento auxiliar: sem financeiro, comissao, servicos ou Auvo.`;
  const common: Record<string, any> = {
    cliente_id: operation.client_id,
    data: new Date().toISOString().slice(0, 10),
    situacao_id: waitingStatusId,
    produtos: products,
    valor_frete: '0.00',
    condicao_pagamento: 'a_vista',
    centro_custo_id: (budget as any).centro_custo_id || '501357',
    usuario_id: gcUserId || '1320473',
    observacoes: note,
    observacoes_interna: marker,
  };
  return operation.document_type === 'os'
    ? {
        ...common,
        servicos: [],
        equipamentos: [],
        atributos: auxiliaryOsAttributes(operation, budget),
      }
    : { ...common, tipo: 'produto' };
}

function unwrapListDocument(entry: any): any {
  return entry?.OrdemServico || entry?.ordem_servico || entry?.Venda || entry?.venda || entry;
}

async function findAuxiliaryByMarker(type: DocumentType, marker: string): Promise<any | null> {
  const collection = type === 'os' ? '/api/ordens_servicos' : '/api/vendas';
  const encoded = encodeURIComponent(marker);
  const paths = [
    `${collection}?pagina=1&limite=100&pesquisa=${encoded}`,
    `${collection}?pagina=1&limite=100`,
  ];
  const results = await Promise.allSettled(paths.map((path) => gcRequest(path)));
  let hadSuccessfulLookup = false;
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    hadSuccessfulLookup = true;
    for (const entry of result.value?.data || []) {
      const document = unwrapListDocument(entry);
      const searchable = `${document?.observacoes_interna || ''} ${document?.observacoes || ''}`;
      if (searchable.includes(marker)) return document;
    }
  }
  if (!hadSuccessfulLookup) throw new Error('AUXILIARY_RECOVERY_LOOKUP_FAILED');
  return null;
}

async function markBatchReconciliation(
  batchId: string,
  message: string,
  auth: AuthContext,
  document?: any,
): Promise<void> {
  const { error } = await cloud.rpc('partial_writeoff_mark_batch_reconciliation', {
    p_batch_id: batchId,
    p_error_message: message,
    p_document: document || null,
    p_actor_id: auth.id,
    p_actor_name: auth.name,
  });
  if (error) throw error;
}

function statusUpdatePayload(document: any, statusId: string, type: DocumentType): Record<string, any> {
  const keys = [
    'cliente_id', 'data', 'data_entrada', 'data_saida', 'valor_total', 'valor_frete',
    'condicao_pagamento', 'produtos', 'servicos', 'equipamentos', 'atributos',
    'pagamentos', 'vendedor_id', 'tecnico_id', 'centro_custo_id', 'usuario_id',
    'observacoes', 'observacoes_interna', 'desconto_valor', 'desconto_tipo', 'tipo_desconto',
  ];
  const payload: Record<string, any> = { situacao_id: statusId };
  for (const key of keys) {
    if (document?.[key] !== undefined && document?.[key] !== null) payload[key] = document[key];
  }
  if (type === 'venda') payload.tipo = document?.tipo || 'produto';
  if (!payload.data) payload.data = new Date().toISOString().slice(0, 10);
  if (!Array.isArray(payload.produtos)) payload.produtos = [];
  return payload;
}

async function updateDocumentStatus(type: DocumentType, id: string, statusId: string): Promise<any> {
  if (!statusId) throw new Error(`PARTIAL_${type.toUpperCase()}_STATUS_NOT_CONFIGURED`);
  const path = type === 'os'
    ? `/api/ordens_servicos/${encodeURIComponent(id)}`
    : `/api/vendas/${encodeURIComponent(id)}`;
  const latest = (await gcRequest(path))?.data;
  if (!latest) throw new Error('AUXILIARY_DOCUMENT_NOT_FOUND');
  if (normalizeId(latest.situacao_id) === statusId) return latest;
  await gcRequest(path, 'PUT', statusUpdatePayload(latest, statusId, type));
  const confirmed = (await gcRequest(path))?.data;
  if (normalizeId(confirmed?.situacao_id) !== statusId) throw new Error('STATUS_NOT_APPLIED');
  return confirmed;
}

function quantityMap(lines: any[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines || []) {
    const product = unwrapProductLine(line);
    const key = `${normalizeId(product.produto_id)}::${normalizeId(product.variacao_id)}`;
    map.set(key, (map.get(key) || 0) + numberValue(product.quantidade));
  }
  return map;
}

function sameQuantities(expected: Map<string, number>, actual: Map<string, number>): boolean {
  if (expected.size !== actual.size) return false;
  for (const [key, quantity] of expected) {
    if (Math.abs((actual.get(key) || 0) - quantity) > 0.000001) return false;
  }
  return true;
}

async function handleOpenOperation(body: any, auth: AuthContext): Promise<PartialWriteoffOperation> {
  const kind: BudgetKind | undefined = body.budget_kind === 'produto' || body.budget_kind === 'servico' || body.budget_kind === 'venda'
    ? body.budget_kind
    : undefined;
  if (!kind) throw new Error('SEARCH_BUDGET_KIND_REQUIRED');
  const source = await fetchSource(String(body.budget_id || ''), kind);
  if (!isSourceEligibleForPartialWriteoff(kind, source)) {
    throw new Error(kind === 'venda' ? 'SALE_ALREADY_MOVED_STOCK' : 'BUDGET_ALREADY_HAS_DOCUMENT');
  }
  const sourceId = normalizeId(source.id);
  const snapshot = {
    ...source,
    id: sourceOperationKey(kind, sourceId),
    _partial_source_kind: kind,
    _partial_source_id: sourceId,
    _partial_source_code: String(source.codigo || ''),
  };
  const items = operationItemsFromBudget(snapshot);
  if (!items.length) throw new Error('BUDGET_HAS_NO_STOCK_ITEMS');
  const type = documentTypeForBudgetKind(kind, snapshot);
  const { data, error } = await cloud.rpc('partial_writeoff_open_operation', {
    p_budget: snapshot,
    p_document_type: type,
    p_items: items,
    p_created_by: auth.id,
    p_created_by_name: auth.name,
  });
  if (error) throw error;
  return getOperationGraph(String(data));
}

async function handlePrepareBatch(body: any, auth: AuthContext): Promise<PartialWriteoffOperation> {
  const operationId = String(body.operation_id || '');
  const requested: Array<{ item_id: string; quantity: number }> = Array.isArray(body.items) ? body.items : [];
  if (!operationId || !requested.length) throw new Error('EMPTY_BATCH');
  const operation = await getOperationGraph(operationId);
  if (operationSourceKind(operation) === 'venda') {
    const sale = await fetchSource(operationSourceId(operation), 'venda');
    if (!isSaleEligibleForPartialWriteoff(sale)) throw new Error('SALE_ALREADY_MOVED_STOCK');
  }
  const selected = requested.map((request) => {
    const item = operation.items.find((candidate) => candidate.id === request.item_id);
    const quantity = numberValue(request.quantity);
    if (!item) throw new Error('ITEM_NOT_FOUND');
    if (quantity <= 0 || quantity > numberValue(item.available_to_reserve_quantity)) {
      throw new Error(`QUANTITY_EXCEEDS_PENDING:${item.product_name}`);
    }
    return { item, quantity };
  });

  const selectedWithStock = [];
  for (const { item, quantity } of selected) {
    const detail = unwrapProductDetail(await gcRequest(`/api/produtos/${encodeURIComponent(item.product_id)}`));
    const stock = currentStock(detail, item.variation_id);
    if (quantity > stock) throw new Error(`INSUFFICIENT_STOCK:${item.product_name}:${stock}`);
    selectedWithStock.push({ item, quantity, stockQuantity: stock });
  }

  const idempotencyKey = String(body.idempotency_key || crypto.randomUUID());
  const { data: reservation, error: reserveError } = await cloud.rpc('partial_writeoff_reserve_batch', {
    p_operation_id: operationId,
    p_idempotency_key: idempotencyKey,
    p_items: selectedWithStock.map(({ item, quantity, stockQuantity }) => ({
      item_id: item.id,
      quantity,
      stock_quantity: stockQuantity,
    })),
    p_actor_id: auth.id,
    p_actor_name: auth.name,
  });
  if (reserveError) throw reserveError;
  const batchId = String(reservation?.batch_id || '');
  const existingReservation = reservation?.existing === true;

  const { data: batch, error: batchError } = await cloud
    .from('partial_writeoff_batches')
    .select('*')
    .eq('id', batchId)
    .single();
  if (batchError) throw batchError;
  if (batch.status === 'awaiting_checkout') return getOperationGraph(operationId);
  if (existingReservation && batch.status === 'creating') {
    let recovered: any | null = null;
    try {
      recovered = await findAuxiliaryByMarker(operation.document_type, batch.marker);
    } catch {
      throw new Error('BATCH_CREATION_IN_PROGRESS');
    }
    if (!recovered?.id) throw new Error('BATCH_CREATION_IN_PROGRESS');
    const { error: attachRecoveredError } = await cloud.rpc('partial_writeoff_attach_auxiliary', {
      p_batch_id: batchId,
      p_document_id: String(recovered.id),
      p_document_code: String(recovered.codigo || ''),
      p_gc_response: recovered,
    });
    if (attachRecoveredError) throw attachRecoveredError;
    return getOperationGraph(operationId);
  }
  if (existingReservation) throw new Error(`BATCH_NOT_REUSABLE:${batch.status}`);

  const settings = await getSettings();
  const waitingStatus = settings[`${operation.document_type}_waiting_status_id`];
  if (!waitingStatus) throw new Error('PARTIAL_STATUS_NOT_CONFIGURED');
  // Igual ao Rastreador: busca o orçamento COMPLETO no GC (o snapshot local pode
  // estar sem `atributos`), para preencher TAREFA OS/EXECUÇÃO, LOCAL e HORAS.
  let freshBudget: Record<string, any> | undefined;
  try {
    freshBudget = await fetchSource(operationSourceId(operation), operationSourceKind(operation) || 'servico');
  } catch {
    freshBudget = undefined;
  }
  const payload = auxiliaryPayload(operation, selected, waitingStatus, batch.marker, auth.profile.gc_usuario_id, freshBudget);

  const path = operation.document_type === 'os' ? '/api/ordens_servicos' : '/api/vendas';

  let document: any = null;
  try {
    const response = await gcRequest(path, 'POST', payload);
    document = response?.data || null;
    if (!document?.id) throw new Error('GESTAOCLICK_RETURNED_NO_DOCUMENT_ID');
  } catch (createError) {
    try {
      document = await findAuxiliaryByMarker(operation.document_type, batch.marker);
    } catch { /* ambiguous request */ }
    if (!document?.id) {
      const message = compact(createError) || 'Falha ambigua ao criar documento auxiliar';
      const explicitRejection = message.startsWith(`GestaoClick POST ${path}`);
      if (explicitRejection) {
        await cloud.rpc('partial_writeoff_release_batch', {
          p_batch_id: batchId,
          p_error_message: message,
        });
      } else {
        await markBatchReconciliation(batchId, `Criacao ambigua no GestaoClick: ${message}`, auth);
      }
      throw createError;
    }
  }

  const { error: attachError } = await cloud.rpc('partial_writeoff_attach_auxiliary', {
    p_batch_id: batchId,
    p_document_id: String(document.id),
    p_document_code: String(document.codigo || ''),
    p_gc_response: document,
  });
  if (attachError) {
    const message = `Documento auxiliar #${document.codigo || document.id} criado, mas nao vinculado: ${compact(attachError)}`;
    try {
      const cancelStatus = settings[`${operation.document_type}_cancel_status_id`];
      if (!cancelStatus) throw new Error('PARTIAL_CANCEL_STATUS_NOT_CONFIGURED');
      await updateDocumentStatus(operation.document_type, String(document.id), cancelStatus);
      await cloud.rpc('partial_writeoff_release_batch', {
        p_batch_id: batchId,
        p_error_message: message,
      });
    } catch (cancelError) {
      await markBatchReconciliation(
        batchId,
        `${message}. Cancelamento automatico falhou: ${compact(cancelError)}`,
        auth,
        document,
      );
    }
    throw attachError;
  }

  // Tarefa Auvo da entrega parcial: roda no servidor (credenciais Auvo são secretas).
  // Falha aqui NÃO invalida o lote — fica registrado o aviso para nova tentativa.
  try {
    await createBatchAuvoTask(batchId, body.auvo_customer_id ? String(body.auvo_customer_id) : undefined);
  } catch (taskError) {
    console.error('[partial-writeoff] falha ao criar tarefa Auvo:', compact(taskError));
  }
  return getOperationGraph(operationId);
}

/** Cria a tarefa Auvo do lote via edge function (usa AUVO_API_KEY/TOKEN do servidor). */
export async function createBatchAuvoTask(batchId: string, auvoCustomerId?: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('partial-writeoff', {
    body: { action: 'create_batch_task', batch_id: batchId, auvo_customer_id: auvoCustomerId },
  });
  if (error || (data as any)?.error) {
    throw new Error((data as any)?.error || error?.message || 'Falha ao criar tarefa no Auvo');
  }
}

async function handleConfirmBatch(body: any, auth: AuthContext): Promise<PartialWriteoffOperation> {
  const batchId = String(body.batch_id || '');
  const { data: batch, error: batchError } = await cloud
    .from('partial_writeoff_batches')
    .select('*')
    .eq('id', batchId)
    .single();
  if (batchError || !batch) throw new Error('BATCH_NOT_FOUND');
  if (batch.status === 'confirmed') return getOperationGraph(batch.operation_id);
  if (batch.status !== 'awaiting_checkout') throw new Error(`BATCH_NOT_CONFIRMABLE:${batch.status}`);
  const operation = await getOperationGraph(batch.operation_id);
  if (operationSourceKind(operation) === 'venda') {
    const sale = await fetchSource(operationSourceId(operation), 'venda');
    if (!isSaleEligibleForPartialWriteoff(sale)) throw new Error('SALE_ALREADY_MOVED_STOCK');
  }

  const { data: batchItems, error: itemsError } = await cloud
    .from('partial_writeoff_batch_items')
    .select('quantity, partial_writeoff_items(*)')
    .eq('batch_id', batchId);
  if (itemsError) throw itemsError;
  const expectedLines = (batchItems || []).map((entry: any) => selectedLine(
    entry.partial_writeoff_items.line_snapshot,
    numberValue(entry.quantity),
  ));
  const type = batch.auxiliary_document_type as DocumentType;
  const path = type === 'os'
    ? `/api/ordens_servicos/${encodeURIComponent(batch.auxiliary_document_id)}`
    : `/api/vendas/${encodeURIComponent(batch.auxiliary_document_id)}`;
  const currentDocument = (await gcRequest(path))?.data;
  if (!sameQuantities(quantityMap(expectedLines), quantityMap(currentDocument?.produtos || []))) {
    throw new Error('AUXILIARY_ITEMS_CHANGED');
  }

  const { data: claim, error: claimError } = await cloud.rpc('partial_writeoff_claim_confirmation', {
    p_batch_id: batchId,
  });
  if (claimError) throw claimError;
  if (claim === 'confirmed') return getOperationGraph(batch.operation_id);

  const settings = await getSettings();
  const stockStatus = settings[`${type}_stock_status_id`];
  try {
    await updateDocumentStatus(type, String(batch.auxiliary_document_id), stockStatus);
    const { error: finishError } = await cloud.rpc('partial_writeoff_finish_confirmation', {
      p_batch_id: batchId,
      p_success: true,
      p_error_message: null,
      p_actor_id: auth.id,
      p_actor_name: auth.name,
    });
    if (finishError) throw finishError;
  } catch (error) {
    const message = compact(error);
    let applied = false;
    try {
      const latest = (await gcRequest(path))?.data;
      applied = normalizeId(latest?.situacao_id) === stockStatus;
    } catch { /* keep false */ }
    const { error: finishError } = await cloud.rpc('partial_writeoff_finish_confirmation', {
      p_batch_id: batchId,
      p_success: applied,
      p_error_message: applied ? null : message,
      p_actor_id: auth.id,
      p_actor_name: auth.name,
    });
    if (finishError || !applied) throw new Error(applied ? compact(finishError) || message : message);
  }
  return getOperationGraph(batch.operation_id);
}

async function compensateAuxiliaries(batches: any[], settings: Record<string, string>): Promise<boolean> {
  let ok = true;
  for (const batch of batches) {
    try {
      await updateDocumentStatus(
        batch.auxiliary_document_type,
        batch.auxiliary_document_id,
        settings[`${batch.auxiliary_document_type}_stock_status_id`],
      );
    } catch {
      ok = false;
    }
  }
  return ok;
}

async function resetConsolidation(operationId: string, auth: AuthContext): Promise<void> {
  const { error } = await cloud.rpc('partial_writeoff_reset_consolidation', {
    p_operation_id: operationId,
    p_actor_id: auth.id,
    p_actor_name: auth.name,
  });
  if (error) throw error;
}

async function finishConsolidation(
  operationId: string,
  success: boolean,
  auth: AuthContext,
  generated?: any,
  errorMessage?: string,
): Promise<void> {
  const { error } = await cloud.rpc('partial_writeoff_finish_consolidation', {
    p_operation_id: operationId,
    p_success: success,
    p_document_id: generated?.os_id ? String(generated.os_id) : null,
    p_document_code: generated?.os_codigo ? String(generated.os_codigo) : null,
    p_auvo_task_id: generated?.auvo_task_id ? String(generated.auvo_task_id) : null,
    p_error_message: errorMessage || null,
    p_actor_id: auth.id,
    p_actor_name: auth.name,
  });
  if (error) throw error;
}

async function handleConsolidate(body: any, auth: AuthContext): Promise<PartialWriteoffOperation> {
  const operationId = String(body.operation_id || '');
  const operation = await getOperationGraph(operationId);
  if (operation.status === 'completed') return operation;
  const sourceKind = operationSourceKind(operation);
  const existingSale = sourceKind === 'venda';
  if (existingSale) {
    const sale = await fetchSource(operationSourceId(operation), 'venda');
    if (!isSaleEligibleForPartialWriteoff(sale)) throw new Error('SALE_ALREADY_MOVED_STOCK');
  }
  if (operation.document_type === 'os' && !auth.profile.default_os_conclusion_status) {
    throw new Error('CONFIGURE_OS_CONCLUSION_STATUS');
  }
  if (!existingSale && !auth.profile.auvo_user_id) throw new Error('CONFIGURE_AUVO_USER_ID');

  const { error: claimError } = await cloud.rpc('partial_writeoff_claim_consolidation', {
    p_operation_id: operationId,
  });
  if (claimError) throw claimError;
  const settings = await getSettings();
  const confirmedBatches = operation.batches.filter((batch) => batch.status === 'confirmed');

  const cancelled: any[] = [];
  try {
    for (const batch of confirmedBatches) {
      cancelled.push(batch);
      await updateDocumentStatus(
        batch.auxiliary_document_type,
        String(batch.auxiliary_document_id),
        settings[`${batch.auxiliary_document_type}_cancel_status_id`],
      );
    }
  } catch (error) {
    const compensated = await compensateAuxiliaries(cancelled, settings);
    const message = `Falha ao compensar auxiliares antes da consolidacao: ${compact(error)}`;
    if (compensated) await resetConsolidation(operationId, auth);
    else await finishConsolidation(operationId, false, auth, undefined, message);
    throw new Error(message);
  }

  let generated: any;
  let existingSaleUpdateAttempted = false;
  try {
    if (existingSale) {
      existingSaleUpdateAttempted = true;
      const sourceId = operationSourceId(operation);
      const updatedSale = await updateDocumentStatus('venda', sourceId, EXISTING_SALE_FINAL_STATUS_ID);
      if (numberValue(updatedSale.situacao_estoque) !== 1) throw new Error('SALE_FINAL_STOCK_NOT_APPLIED');
      if (numberValue(updatedSale.situacao_financeiro) !== 1) throw new Error('SALE_FINAL_FINANCIAL_NOT_PRESERVED');
      generated = {
        doc_kind: 'venda',
        existing_sale: true,
        os_id: sourceId,
        os_codigo: String(updatedSale.codigo || operation.budget_code),
        gc_response: updatedSale,
      };
    } else {
      // Histórico das entregas parciais (documento auxiliar + tarefa Auvo de cada
      // lote). Vai junto para o generate-os gravar TODAS as tarefas no atributo do
      // documento final — assim o sistema enxerga que existe mais de uma tarefa.
      const partialAuxiliaries = operation.batches
        .filter((batch) => batch.auxiliary_document_id)
        .map((batch) => ({
          sequence: batch.sequence,
          document_type: batch.auxiliary_document_type,
          document_id: String(batch.auxiliary_document_id),
          document_code: batch.auxiliary_document_code ? String(batch.auxiliary_document_code) : null,
          auvo_task_id: batch.auvo_task_id ? String(batch.auvo_task_id) : null,
          status: batch.status,
        }));
      const result = await supabase.functions.invoke('generate-os', {
        body: {
          orcamento: operation.budget_snapshot,
          auvo_user_id: auth.profile.auvo_user_id,
          gc_usuario_id: auth.profile.gc_usuario_id || undefined,
          auvo_customer_id: body.auvo_customer_id || undefined,
          manual_equipamento: body.manual_equipamento || undefined,
          partial_auxiliaries: partialAuxiliaries.length ? partialAuxiliaries : undefined,
        },
      });
      generated = result.data;
      if (result.error || generated?.error) {
        throw new Error(generated?.error || result.error?.message || 'Falha ao gerar documento definitivo');
      }
      generated.partial_auxiliaries = partialAuxiliaries;
      if (operation.document_type === 'os') {
        await updateDocumentStatus('os', String(generated.os_id), String(auth.profile.default_os_conclusion_status));
      }
    }

  } catch (error) {
    if (existingSaleUpdateAttempted) {
      const message = `A atualização da venda original ficou inconclusiva e precisa ser conferida: ${compact(error)}`;
      await finishConsolidation(operationId, false, auth, generated, message);
      throw new Error(message);
    }
    const compensated = generated?.os_id ? false : await compensateAuxiliaries(cancelled, settings);
    const message = generated?.os_id
      ? `Documento definitivo #${generated.os_codigo || generated.os_id} foi criado, mas nao foi possivel finaliza-lo: ${compact(error)}`
      : `Falha ao criar documento definitivo: ${compact(error)}`;
    if (compensated) await resetConsolidation(operationId, auth);
    else await finishConsolidation(operationId, false, auth, generated, message);
    throw new Error(message);
  }

  if (!existingSale) {
    await cloud.from('os_generation_logs').insert({
      orcamento_codigo: operation.budget_code,
      orcamento_id: operation.budget_id,
      nome_cliente: operation.client_name,
      os_id: String(generated.os_id || ''),
      os_codigo: String(generated.os_codigo || ''),
      auvo_task_id: String(generated.auvo_task_id || ''),
      operator_id: auth.id,
      operator_name: auth.name,
      valor_total: numberValue((operation.budget_snapshot as any)?.valor_total),
      warnings: generated.warnings || null,
      partial_auxiliaries: generated.partial_auxiliaries?.length ? generated.partial_auxiliaries : null,
      success: true,

    });
  }

  await finishConsolidation(operationId, true, auth, generated);
  return getOperationGraph(operationId);
}

/** Cancela a baixa parcial que ainda nao foi efetivada no GestaoClick. */
async function handleCancelOperation(body: any, auth: AuthContext): Promise<PartialWriteoffOperation> {
  const operationId = String(body.operation_id || '');
  if (!operationId) throw new Error('OPERATION_ID_REQUIRED');
  const { error } = await cloud.rpc('partial_writeoff_cancel_operation', {
    p_operation_id: operationId,
    p_actor_id: auth.id,
    p_actor_name: auth.name,
    p_reason: String(body.reason || ''),
  });
  if (error) throw new Error(error.message || 'OPERATION_NOT_CANCELLABLE');
  return getOperationGraph(operationId);
}

/** Cancela um lote cujo documento auxiliar foi cancelado no GestaoClick. */
async function handleCancelBatch(body: any, auth: AuthContext): Promise<PartialWriteoffOperation> {
  const batchId = String(body.batch_id || '');
  if (!batchId) throw new Error('BATCH_ID_REQUIRED');
  const { data: batch, error: batchError } = await cloud
    .from('partial_writeoff_batches' as any)
    .select('operation_id')
    .eq('id', batchId)
    .maybeSingle();
  if (batchError) throw new Error(batchError.message);
  if (!batch) throw new Error('BATCH_NOT_FOUND');
  const { error } = await (cloud as any).rpc('partial_writeoff_cancel_batch', {
    p_batch_id: batchId,
    p_actor_id: auth.id,
    p_actor_name: auth.name,
    p_reason: String(body.reason || ''),
  });
  if (error) throw new Error(error.message || 'BATCH_NOT_CANCELLABLE');
  return getOperationGraph(String((batch as any).operation_id));
}

/**
 * Audita, no GestãoClick, cada documento auxiliar gerado pela baixa parcial:
 * verifica se ainda existe, se foi excluído e se a situação continua a esperada.
 */
async function handleAuditDocuments(body: any): Promise<any[]> {
  const operationId = String(body.operation_id || '');
  if (!operationId) throw new Error('OPERATION_ID_REQUIRED');

  const { data: batches, error } = await cloud
    .from('partial_writeoff_batches' as any)
    .select('id, sequence, status, auxiliary_document_type, auxiliary_document_id, auxiliary_document_code')
    .eq('operation_id', operationId)
    .order('sequence', { ascending: true });
  if (error) throw new Error(error.message);

  let settings: Record<string, string> = {};
  try {
    settings = await getSettings();
  } catch {
    settings = {};
  }

  const results: any[] = [];
  for (const batch of (batches || []) as any[]) {
    const type: DocumentType = batch.auxiliary_document_type === 'os' ? 'os' : 'venda';
    const base = {
      batchId: batch.id,
      sequence: Number(batch.sequence),
      type,
      batchStatus: String(batch.status),
      documentId: batch.auxiliary_document_id ? String(batch.auxiliary_document_id) : null,
      documentCode: batch.auxiliary_document_code ? String(batch.auxiliary_document_code) : null,
      situacaoId: null as string | null,
      situacaoNome: null as string | null,
    };

    if (!batch.auxiliary_document_id) {
      results.push({ ...base, state: 'unchecked', message: 'Lote sem documento no GestãoClick.' });
      continue;
    }

    const path = type === 'os'
      ? `/api/ordens_servicos/${encodeURIComponent(String(batch.auxiliary_document_id))}`
      : `/api/vendas/${encodeURIComponent(String(batch.auxiliary_document_id))}`;

    try {
      const document = (await gcRequest(path))?.data;
      if (!document || !normalizeId(document.id)) {
        results.push({ ...base, state: 'missing', message: 'Documento não existe mais no GestãoClick (excluído).' });
        continue;
      }
      const situacaoId = normalizeId(document.situacao_id);
      const situacaoNome = String(document.nome_situacao || '').trim() || '—';
      const cancelId = normalizeId(settings[`${type}_cancel_status_id`]);
      const waitingId = normalizeId(settings[`${type}_waiting_status_id`]);
      const stockId = normalizeId(settings[`${type}_stock_status_id`]);
      const expected = [waitingId, stockId].filter(Boolean);

      const enriched = { ...base, situacaoId, situacaoNome, documentCode: String(document.codigo || base.documentCode || '') };

      if (cancelId && situacaoId === cancelId) {
        results.push({ ...enriched, state: 'cancelled', message: `Documento cancelado no GestãoClick ("${situacaoNome}").` });
      } else if (expected.length && !expected.includes(situacaoId)) {
        results.push({ ...enriched, state: 'status_changed', message: `Situação mudou no GestãoClick: "${situacaoNome}".` });
      } else {
        results.push({ ...enriched, state: 'ok', message: `Documento existe e está em "${situacaoNome}".` });
      }
    } catch (auditError) {
      const message = auditError instanceof Error ? auditError.message : String(auditError);
      if (/\(404\)|not found|nao encontrad|não encontrad/i.test(message)) {
        results.push({ ...base, state: 'missing', message: 'Documento não encontrado no GestãoClick (excluído).' });
      } else {
        results.push({ ...base, state: 'error', message: `Falha ao consultar o GestãoClick: ${message}` });
      }
    }
  }

  return results;
}


export async function invokePartialWriteoffClient<T>(body: Record<string, unknown>): Promise<T> {
  const auth = await authenticate();
  const action = String(body.action || '');


  if (action === 'search_budgets') {
    const kind = body.budget_kind === 'produto' || body.budget_kind === 'servico' || body.budget_kind === 'venda'
      ? body.budget_kind
      : undefined;
    if (!kind) throw new Error('SEARCH_BUDGET_KIND_REQUIRED');
    const budgets = await searchBudgets(String(body.term || ''), kind);
    const operationKeys = budgets.map((budget) => sourceOperationKey(budget.budget_kind, String(budget.id)));
    const { data: operations } = operationKeys.length
      ? await cloud
          .from('partial_writeoff_operations')
          .select('id, budget_id, status')
          .in('budget_id', operationKeys)
          .not('status', 'in', '(completed,cancelled)')
      : { data: [] as any[] };
    const active = new Map((operations || []).map((operation: any) => [operation.budget_id, operation]));
    const result: PartialBudgetSearchResult[] = budgets.map((budget) => ({
      ...budget,
      partial_operation: active.get(sourceOperationKey(budget.budget_kind, String(budget.id))) || null,
    }));
    return { budgets: result } as T;
  }
  if (action === 'open_operation') return { operation: await handleOpenOperation(body, auth) } as T;
  if (action === 'get_operation') {
    return { operation: await getOperationGraph(String(body.operation_id || '')) } as T;
  }
  if (action === 'list_operations') return { operations: await listOperationGraphs() } as T;
  if (action === 'prepare_batch') return { operation: await handlePrepareBatch(body, auth) } as T;
  if (action === 'confirm_batch') return { operation: await handleConfirmBatch(body, auth) } as T;
  if (action === 'consolidate') return { operation: await handleConsolidate(body, auth) } as T;
  if (action === 'cancel_operation') return { operation: await handleCancelOperation(body, auth) } as T;
  if (action === 'cancel_batch') return { operation: await handleCancelBatch(body, auth) } as T;
  if (action === 'delete_operation') {
    const operationId = String(body.operation_id || '');
    if (!operationId) throw new Error('OPERATION_ID_REQUIRED');
    const { error } = await (cloud as any).rpc('partial_writeoff_delete_operation', {
      p_operation_id: operationId,
      p_actor_id: auth.id,
      p_actor_name: auth.name,
    });
    if (error) throw new Error(error.message || 'OPERATION_NOT_DELETABLE');
    return { deleted: true } as T;
  }
  if (action === 'audit_documents') return { audits: await handleAuditDocuments(body) } as T;


  throw new Error('UNKNOWN_ACTION');
}
