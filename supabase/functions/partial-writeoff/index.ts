import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GC_API_URL = 'https://api.gestaoclick.com';
const PARTIAL_WRITEOFF_BUDGET_STATUS_ID = Deno.env.get('PARTIAL_WRITEOFF_BUDGET_STATUS_ID') || '9348312';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type DocumentType = 'os' | 'venda';
type AuthContext = { id: string; email: string; name: string; profile: Record<string, any> };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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
  const accessToken = Deno.env.get('GC_ACCESS_TOKEN');
  const secretToken = Deno.env.get('GC_SECRET_TOKEN');
  if (!accessToken || !secretToken) throw new Error('GC_CREDENTIALS_NOT_CONFIGURED');

  const response = await fetch(`${GC_API_URL}${path}`, {
    method,
    headers: {
      'access-token': accessToken,
      'secret-access-token': secretToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!response.ok || parsed?.status === 'error' || Number(parsed?.code || 0) >= 400) {
    throw new Error(`GestãoClick ${method} ${path} (${response.status}): ${apiError(parsed) || response.statusText}`);
  }
  return parsed;
}

async function authenticate(req: Request): Promise<AuthContext> {
  const authorization = req.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('AUTH_REQUIRED');

  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new Error('AUTH_REQUIRED');

  const { data: profile } = await service
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

function documentTypeForBudget(budget: any): DocumentType {
  const hasServices = Array.isArray(budget?.servicos) && budget.servicos.length > 0;
  return hasServices || numberValue(budget?.valor_servicos) > 0 ? 'os' : 'venda';
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

async function fetchBudget(id: string): Promise<any> {
  const response = await gcRequest(`/api/orcamentos/${encodeURIComponent(id)}`);
  if (!response?.data?.id) throw new Error('BUDGET_NOT_FOUND');
  return response.data;
}

async function searchBudgets(term: string): Promise<any[]> {
  const value = term.trim();
  if (value.length < 2) throw new Error('SEARCH_TOO_SHORT');
  const encoded = encodeURIComponent(value);
  const paths = [
    `/api/orcamentos?pagina=1&limite=100&codigo=${encoded}`,
    `/api/orcamentos?pagina=1&limite=100&nome=${encoded}`,
    `/api/orcamentos?pagina=1&limite=100&pesquisa=${encoded}`,
  ];
  const settled = await Promise.allSettled(paths.map((path) => gcRequest(path)));
  const rows = settled.flatMap((result) => result.status === 'fulfilled' ? result.value?.data || [] : []);
  const normalized = value.toLocaleLowerCase('pt-BR').replace(/\D/g, '');
  const byId = new Map<string, any>();
  for (const row of rows) {
    const haystack = `${row.codigo || ''} ${row.nome_cliente || ''} ${row.cpf_cnpj || ''} ${row.cnpj || ''}`.toLocaleLowerCase('pt-BR');
    const digits = haystack.replace(/\D/g, '');
    if (haystack.includes(value.toLocaleLowerCase('pt-BR')) || (normalized.length >= 3 && digits.includes(normalized))) {
      byId.set(String(row.id), row);
    }
  }
  return [...byId.values()].slice(0, 50);
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

async function getOperationGraph(operationId: string) {
  const [operationResult, itemsResult, batchesResult] = await Promise.all([
    service.from('partial_writeoff_operations').select('*').eq('id', operationId).single(),
    service.from('partial_writeoff_item_balances').select('*').eq('operation_id', operationId).order('created_at'),
    service.from('partial_writeoff_batches').select('*').eq('operation_id', operationId).order('sequence'),
  ]);
  if (operationResult.error) throw operationResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (batchesResult.error) throw batchesResult.error;
  return { ...operationResult.data, items: itemsResult.data || [], batches: batchesResult.data || [] };
}

async function listOperationGraphs() {
  const { data: operations, error } = await service
    .from('partial_writeoff_operations')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  if (!operations?.length) return [];

  const ids = operations.map((operation: any) => operation.id);
  const [itemsResult, batchesResult] = await Promise.all([
    service.from('partial_writeoff_item_balances').select('*').in('operation_id', ids).order('created_at'),
    service.from('partial_writeoff_batches').select('*').in('operation_id', ids).order('sequence'),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (batchesResult.error) throw batchesResult.error;
  return operations.map((operation: any) => ({
    ...operation,
    items: (itemsResult.data || []).filter((item: any) => item.operation_id === operation.id),
    batches: (batchesResult.data || []).filter((batch: any) => batch.operation_id === operation.id),
  }));
}

async function getSettings() {
  const { data, error } = await service.from('partial_writeoff_settings').select('*').eq('singleton', true).single();
  if (error) throw error;
  return data as Record<string, string>;
}

function selectedLine(snapshot: any, quantity: number): any {
  const cloned = structuredClone(snapshot || {});
  const product = unwrapProductLine(cloned);
  const originalQuantity = numberValue(product.quantidade);
  const ratio = originalQuantity > 0 ? quantity / originalQuantity : 1;
  product.quantidade = qtyString(quantity);

  // GestãoClick devolve valor_total/desconto_valor relativos à linha inteira.
  // Ao retirar só parte da quantidade, esses campos também precisam acompanhar
  // a proporção; caso contrário o auxiliar nasce com total incorreto.
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

// ============================================================
// AUVO — mesma receita usada pelo gerador de OS (generate-os):
// login, criação de tarefa (PUT /tasks), clone de cliente/equipamentos a
// partir da "TAREFA OS" do orçamento e tipo de atividade por tipo de doc.
// Cada baixa parcial gera a sua própria tarefa; nenhuma tarefa parcial é
// apagada na consolidação — todas ficam amarradas à OS/Venda final.
// ============================================================
const AUVO_API_URL = 'https://api.auvo.com.br/v2';
const AUVO_TASK_TYPE_OS = 180177;
const AUVO_TASK_TYPE_VENDA = 200268;
const AUVO_QUESTIONNAIRE_ID = 214757;
const INT32_MAX = 2147483647;

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

async function auvoLogin(): Promise<string> {
  const apiKey = Deno.env.get('AUVO_API_KEY');
  const apiToken = Deno.env.get('AUVO_API_TOKEN');
  if (!apiKey || !apiToken) throw new Error('AUVO_CREDENTIALS_NOT_CONFIGURED');
  const url = `${AUVO_API_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.result?.accessToken) throw new Error(`Auvo login falhou (${res.status})`);
  return data.result.accessToken as string;
}

async function auvoCreateTask(token: string, payload: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${AUVO_API_URL}/tasks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Auvo rejeitou a tarefa (${res.status}): ${compact(data).slice(0, 300)}`);
  const taskId = data?.result?.taskID ?? data?.result?.[0]?.taskID ?? data?.taskID ?? null;
  if (!taskId) throw new Error('Auvo não retornou o número da tarefa');
  return String(taskId);
}

async function auvoGetTask(token: string, taskId: string): Promise<any> {
  const res = await fetch(`${AUVO_API_URL}/tasks/${encodeURIComponent(taskId)}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Auvo get task ${taskId} (${res.status})`);
  return res.json();
}

function budgetAttrValue(budget: any, targetId: string, nameIncludes: string): string {
  for (const entry of budget?.atributos || []) {
    const attr = entry?.atributo || entry;
    const id = String(attr?.atributo_id || attr?.id || '');
    if (id === targetId || normalizeText(attr?.descricao).includes(normalizeText(nameIncludes))) {
      return String(attr?.conteudo ?? '').trim();
    }
  }
  return '';
}

function budgetEquipmentText(budget: any): string {
  const fromAttr = budgetAttrValue(budget, '', 'equipamento');
  if (fromAttr) return fromAttr;
  const equip = budget?.equipamentos?.[0]?.equipamento;
  if (!equip) return '';
  return [equip.equipamento, equip.marca, equip.modelo].filter(Boolean).join(' · ');
}

/** Cria a tarefa Auvo da baixa parcial. Nunca derruba o lote: erros viram aviso. */
async function createPartialAuvoTask(
  operation: any,
  batch: any,
  selected: Array<{ item: any; quantity: number }>,
  auvoUserId: string,
  fallbackCustomerId?: string,
): Promise<string> {
  const budget = operation.budget_snapshot || {};
  const token = await auvoLogin();

  const sourceTaskId = budgetAttrValue(budget, '73341', 'tarefa os');
  let customerId = Number(fallbackCustomerId || budget.auvo_customer_id || 0);
  let equipmentIds: number[] = String(budgetAttrValue(budget, '88695', 'id equipamento') || '')
    .split(/[^0-9]+/)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= INT32_MAX);

  if (sourceTaskId) {
    try {
      const source = (await auvoGetTask(token, sourceTaskId))?.result || {};
      if (Number(source?.customerId) > 0) customerId = Number(source.customerId);
      if (!equipmentIds.length && Array.isArray(source?.equipmentsId)) {
        equipmentIds = source.equipmentsId
          .map((v: unknown) => Number(v))
          .filter((n: number) => Number.isFinite(n) && n > 0 && n <= INT32_MAX);
      }
    } catch { /* segue sem clone */ }
  }

  if (!Number.isFinite(customerId) || customerId <= 0) {
    throw new Error('Cliente Auvo não identificado para a tarefa parcial');
  }

  const equipText = budgetEquipmentText(budget);
  const address = [budget.endereco, budget.cidade, budget.estado, budget.cep].filter(Boolean).join(', ')
    || operation.client_name;

  const orientation = [
    `ENTREGA PARCIAL ${batch.sequence} — Orçamento #${operation.budget_code}`,
    `Cliente: ${operation.client_name}`,
    equipText ? `Equipamento: ${equipText}` : '',
    `Documento auxiliar: ${operation.document_type === 'os' ? 'OS' : 'Venda'} #${batch.auxiliary_document_code || batch.auxiliary_document_id}`,
    '',
    'PEÇAS DESTA ENTREGA:',
    ...selected.map(({ item, quantity }) => {
      const line: any = item.line_snapshot || {};
      const unit = numberValue(line.valor_venda ?? line.valor_unitario ?? line.valor);
      const suffix = unit > 0
        ? ` — Valor: ${unit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} un. (Total: ${(unit * Number(quantity)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`
        : '';
      return `  • ${item.product_name} — Qtd: ${qtyString(quantity)}${suffix}`;
    }),

    '',
    'Esta é uma entrega parcial. As demais peças serão entregues quando chegarem e o orçamento será reagrupado numa OS/Venda final.',
  ].filter(Boolean).join('\n');

  const payload: Record<string, unknown> = {
    taskType: operation.document_type === 'venda' ? AUVO_TASK_TYPE_VENDA : AUVO_TASK_TYPE_OS,
    idUserFrom: Number(auvoUserId),
    orientation,
    priority: 2,
    questionnaireId: AUVO_QUESTIONNAIRE_ID,
    address,
    latitude: -23.55,
    longitude: -46.63,
    customerId,
  };
  if (equipmentIds.length) payload.equipmentsId = equipmentIds;

  return auvoCreateTask(token, payload);
}

/** Grava o número da tarefa Auvo no campo extra do documento auxiliar no GC. */
async function attachAuvoTaskToAuxiliary(
  type: DocumentType,
  documentId: string,
  taskId: string,
  budgetCode: string,
): Promise<void> {
  const listPath = type === 'os' ? '/api/atributos_ordens_servicos' : '/api/atributos_vendas';
  const metas: any[] = (await gcRequest(listPath))?.data || [];
  const findAttr = (...tokens: string[]) => metas.find((meta) => {
    const nome = normalizeText(meta?.nome);
    return tokens.every((token) => nome.includes(normalizeText(token)));
  })?.id || null;

  const taskAttrId = type === 'os' ? findAttr('tarefa', 'execu') : findAttr('tarefa', 'entrega');
  const budgetAttrId = findAttr('numero', 'orcamento');
  const path = type === 'os'
    ? `/api/ordens_servicos/${encodeURIComponent(documentId)}`
    : `/api/vendas/${encodeURIComponent(documentId)}`;
  const latest = (await gcRequest(path))?.data;
  if (!latest) return;

  // Preserva TODOS os atributos obrigatórios já gravados e só sobrescreve os dois alvos.
  const atributos = normalizeDocumentAtributos(latest, type);
  const upsert = (id: string | null, conteudo: string) => {
    if (!id) return;
    const key = String(id);
    const idx = atributos.findIndex((a) => a.atributo.atributo_id === key);
    if (idx >= 0) atributos[idx] = { atributo: { atributo_id: key, conteudo } };
    else atributos.push({ atributo: { atributo_id: key, conteudo } });
  };
  upsert(taskAttrId, taskId);
  upsert(budgetAttrId, String(budgetCode));
  if (!atributos.length) return;

  const payload = statusUpdatePayload(latest, normalizeId(latest.situacao_id), type);
  payload.atributos = atributos;
  await gcRequest(path, 'PUT', payload);
}

/**
 * Atributos obrigatórios do documento auxiliar — mesma receita da geração de OS.
 * O GC recusa (400) a OS sem LOCAL DO REPARO, TAREFA OS, TAREFA EXECUÇÃO,
 * HORAS TÉCNICAS e NÚMERO ORÇAMENTO. Os IDs do orçamento são diferentes dos IDs
 * de OS, então descobrimos os IDs corretos pelo nome no registro de atributos.
 */
async function buildAuxiliaryAtributos(operation: any, type: DocumentType) {
  const budget = operation.budget_snapshot || {};
  const listPath = type === 'os' ? '/api/atributos_ordens_servicos' : '/api/atributos_vendas';
  let metas: any[] = [];
  try {
    metas = (await gcRequest(listPath))?.data || [];
  } catch (e) {
    console.warn('[partial-writeoff] falha ao listar atributos do GC:', compact(e));
  }
  const findAttr = (fallbackId: string, ...tokens: string[]) => String(metas.find((meta) => {
    const nome = normalizeText(meta?.nome ?? meta?.descricao);
    return tokens.every((token) => nome.includes(normalizeText(token)));
  })?.id || fallbackId);

  const atributos: Array<{ atributo: { atributo_id: string; conteudo: string } }> = [];
  const push = (id: string | null, conteudo: string) => {
    if (!id) return;
    atributos.push({ atributo: { atributo_id: String(id), conteudo: String(conteudo ?? '') } });
  };

  const numeroOrcamento = String(operation.budget_code || '');
  if (type === 'os') {
    const tarefaOs = budgetAttrValue(budget, '73341', 'tarefa os');
    const localReparo = budgetAttrValue(budget, '73350', 'local do reparo');
    const horas = budgetAttrValue(budget, '67350', 'horas tecnicas');
    // IDs oficiais do cadastro de atributos de OS no GC. A descoberta por nome
    // continua sendo usada, mas nunca pode fazer o POST perder campos obrigatórios.
    push(findAttr('81831', 'numero', 'orcamento'), numeroOrcamento);
    push(findAttr('73343', 'tarefa', 'os'), tarefaOs || '-');
    // Preenchido de verdade logo após a criação da tarefa Auvo desta entrega.
    push(findAttr('73344', 'tarefa', 'execu'), tarefaOs || '-');
    push(findAttr('68658', 'local', 'reparo'), localReparo || 'CLIENTE');
    push(findAttr('73897', 'horas', 'tecnic'), horas || '0');
  } else {
    push(findAttr('', 'numero', 'orcamento'), numeroOrcamento);
    push(findAttr('', 'tarefa', 'entrega'), '-');
  }
  console.log(`[partial-writeoff] atributos ${type}: ${atributos.map((entry) => `${entry.atributo.atributo_id}=${entry.atributo.conteudo}`).join(', ')}`);
  return atributos;
}

async function auxiliaryPayload(operation: any, selected: Array<{ item: any; quantity: number }>, waitingStatusId: string, marker: string, gcUserId?: string) {
  const budget = operation.budget_snapshot || {};
  const products = selected.map(({ item, quantity }) => selectedLine(item.line_snapshot, quantity));
  const note = `[${marker}] BAIXA PARCIAL do orçamento #${operation.budget_code}. Documento auxiliar: sem financeiro, comissão nem serviços.`;
  const atributos = await buildAuxiliaryAtributos(operation, operation.document_type);

  const common: Record<string, any> = {
    cliente_id: operation.client_id,
    data: new Date().toISOString().slice(0, 10),
    situacao_id: waitingStatusId,
    produtos: products,
    valor_frete: '0.00',
    condicao_pagamento: 'a_vista',
    centro_custo_id: budget.centro_custo_id || '501357',
    usuario_id: gcUserId || '1320473',
    observacoes: note,
    observacoes_interna: marker,
  };
  if (atributos.length) common.atributos = atributos;
  return operation.document_type === 'os'
    ? { ...common, servicos: [], equipamentos: [] }
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
  operationId: string,
  message: string,
  document?: any,
): Promise<void> {
  const batchPatch: Record<string, unknown> = {
    status: 'reconciliation_required',
    error_message: message.slice(0, 1000),
  };
  if (document?.id) batchPatch.auxiliary_document_id = String(document.id);
  if (document?.codigo) batchPatch.auxiliary_document_code = String(document.codigo);
  if (document) batchPatch.gc_create_response = document;
  await service.from('partial_writeoff_batches').update(batchPatch).eq('id', batchId);
  await service.from('partial_writeoff_operations').update({
    status: 'reconciliation_required',
    reconciliation_reason: message.slice(0, 1000),
  }).eq('id', operationId);
  await service.from('partial_writeoff_events').insert({
    operation_id: operationId,
    batch_id: batchId,
    event_type: 'batch_reconciliation_required',
    payload: { error: message, document_id: document?.id || null, document_code: document?.codigo || null },
  });
}

/**
 * Normaliza os atributos vindos do GET (que trazem id interno + descrição) para o
 * formato aceito no PUT e garante os obrigatórios de OS. Sem isso o GC devolve
 * 400 "atributos obrigatórios não enviados" (ex.: HORAS TÉCNICAS #73897).
 */
function normalizeDocumentAtributos(document: any, type: DocumentType): Array<{ atributo: { atributo_id: string; conteudo: string } }> {
  const list: Array<{ atributo: { atributo_id: string; conteudo: string } }> = [];
  const upsert = (atributo_id: string, conteudo: string) => {
    if (!atributo_id) return;
    const idx = list.findIndex((a) => a.atributo.atributo_id === atributo_id);
    if (idx >= 0) list[idx] = { atributo: { atributo_id, conteudo } };
    else list.push({ atributo: { atributo_id, conteudo } });
  };
  for (const entry of document?.atributos || []) {
    const attr = entry?.atributo || entry;
    const id = String(attr?.atributo_id || '').trim();
    if (!id) continue;
    upsert(id, String(attr?.conteudo ?? '').trim());
  }
  if (type === 'os') {
    const has = (id: string) => list.some((a) => a.atributo.atributo_id === id && a.atributo.conteudo !== '');
    const budgetFromNote = String(document?.observacoes || '').match(/orçamento #(\d+)/i)?.[1] || '';
    if (!has('81831') && budgetFromNote) upsert('81831', budgetFromNote);
    if (!has('73343')) upsert('73343', '-');
    if (!has('73344')) upsert('73344', '-');
    if (!has('68658')) upsert('68658', 'CLIENTE');
    if (!has('73897')) upsert('73897', '1');
  }
  return list;
}

function statusUpdatePayload(document: any, statusId: string, type: DocumentType): Record<string, any> {
  const keys = [
    'cliente_id', 'data', 'data_entrada', 'data_saida', 'valor_total', 'valor_frete',
    'condicao_pagamento', 'produtos', 'servicos', 'equipamentos',
    'pagamentos', 'vendedor_id', 'tecnico_id', 'centro_custo_id', 'usuario_id',
    'observacoes', 'observacoes_interna', 'desconto_valor', 'desconto_tipo', 'tipo_desconto',
  ];
  const payload: Record<string, any> = { situacao_id: statusId };
  for (const key of keys) {
    if (document?.[key] !== undefined && document?.[key] !== null) payload[key] = document[key];
  }
  const atributos = normalizeDocumentAtributos(document, type);
  if (atributos.length) payload.atributos = atributos;
  if (type === 'venda') payload.tipo = document?.tipo || 'produto';
  if (!payload.data) payload.data = new Date().toISOString().slice(0, 10);
  if (!Array.isArray(payload.produtos)) payload.produtos = [];
  return payload;
}


async function updateDocumentStatus(type: DocumentType, id: string, statusId: string): Promise<any> {
  const path = type === 'os' ? `/api/ordens_servicos/${encodeURIComponent(id)}` : `/api/vendas/${encodeURIComponent(id)}`;
  const latest = (await gcRequest(path))?.data;
  if (!latest) throw new Error('AUXILIARY_DOCUMENT_NOT_FOUND');
  if (normalizeId(latest.situacao_id) === statusId) return latest;
  await gcRequest(path, 'PUT', statusUpdatePayload(latest, statusId, type));
  const confirmed = (await gcRequest(path))?.data;
  if (normalizeId(confirmed?.situacao_id) !== statusId) throw new Error('STATUS_NOT_APPLIED');
  return confirmed;
}

function budgetStatusUpdatePayload(budget: any, statusId: string): Record<string, any> {
  const keys = [
    'cliente_id', 'data', 'valor_total', 'valor_frete', 'condicao_pagamento',
    'produtos', 'servicos', 'equipamentos', 'atributos', 'pagamentos',
    'vendedor_id', 'tecnico_id', 'centro_custo_id', 'usuario_id',
    'observacoes', 'observacoes_interna', 'desconto_valor', 'desconto_tipo',
    'tipo_desconto', 'desconto_porcentagem',
  ];
  const payload: Record<string, any> = { situacao_id: statusId };
  for (const key of keys) {
    if (budget?.[key] !== undefined && budget?.[key] !== null) payload[key] = budget[key];
  }
  if (!payload.data) payload.data = new Date().toISOString().slice(0, 10);
  if (!Array.isArray(payload.produtos)) payload.produtos = [];
  if (!Array.isArray(payload.servicos)) payload.servicos = [];
  return payload;
}

async function recordBudgetStatusEvent(
  operation: any,
  batchId: string,
  auth: AuthContext,
  eventType: 'budget_partial_status_updated' | 'budget_partial_status_update_failed',
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await service.from('partial_writeoff_events').insert({
    operation_id: operation.id,
    batch_id: batchId,
    event_type: eventType,
    payload,
    actor_id: auth.id,
    actor_name: auth.name,
  });
  if (error) console.warn('[partial-writeoff] falha ao registrar evento de situacao do orcamento:', compact(error));
}

/**
 * Depois de o documento auxiliar existir e estar vinculado ao lote, move o
 * orcamento original para BAIXA PARCIAL REALIZADA. O PUT reenvia as linhas e
 * os campos financeiros para o GestaoClick nao zerar o documento.
 */
async function syncOriginalBudgetPartialStatus(
  operation: any,
  batchId: string,
  auth: AuthContext,
): Promise<boolean> {
  const budgetId = normalizeId(operation?.budget_id);
  if (!budgetId) return false;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const latest = await fetchBudget(budgetId);
      if (normalizeId(latest.situacao_id) === PARTIAL_WRITEOFF_BUDGET_STATUS_ID) return true;

      await gcRequest(
        `/api/orcamentos/${encodeURIComponent(budgetId)}`,
        'PUT',
        budgetStatusUpdatePayload(latest, PARTIAL_WRITEOFF_BUDGET_STATUS_ID),
      );
      const confirmed = await fetchBudget(budgetId);
      if (normalizeId(confirmed.situacao_id) !== PARTIAL_WRITEOFF_BUDGET_STATUS_ID) {
        throw new Error('BUDGET_STATUS_NOT_APPLIED');
      }
      await recordBudgetStatusEvent(operation, batchId, auth, 'budget_partial_status_updated', {
        budget_id: budgetId,
        budget_code: operation.budget_code,
        situacao_id: PARTIAL_WRITEOFF_BUDGET_STATUS_ID,
      });
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }

  const message = compact(lastError) || 'Falha desconhecida ao atualizar a situacao do orcamento';
  console.error('[partial-writeoff] documento auxiliar criado, mas situacao do orcamento nao atualizada:', message);
  await recordBudgetStatusEvent(operation, batchId, auth, 'budget_partial_status_update_failed', {
    budget_id: budgetId,
    budget_code: operation.budget_code,
    situacao_id: PARTIAL_WRITEOFF_BUDGET_STATUS_ID,
    error: message,
  });
  return false;
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

async function handleOpenOperation(body: any, auth: AuthContext) {
  const budget = await fetchBudget(String(body.budget_id || ''));
  const items = operationItemsFromBudget(budget);
  if (!items.length) throw new Error('BUDGET_HAS_NO_STOCK_ITEMS');
  const type = documentTypeForBudget(budget);
  const { data, error } = await service.rpc('partial_writeoff_open_operation', {
    p_budget: budget,
    p_document_type: type,
    p_items: items,
    p_created_by: auth.id,
    p_created_by_name: auth.name,
  });
  if (error) throw error;
  return getOperationGraph(String(data));
}

async function handlePrepareBatch(body: any, auth: AuthContext) {
  const operationId = String(body.operation_id || '');
  const requested: Array<{ item_id: string; quantity: number }> = Array.isArray(body.items) ? body.items : [];
  if (!operationId || !requested.length) throw new Error('EMPTY_BATCH');
  const operation = await getOperationGraph(operationId);
  const selected = requested.map((request) => {
    const item = operation.items.find((candidate: any) => candidate.id === request.item_id);
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
  const { data: reservation, error: reserveError } = await service.rpc('partial_writeoff_reserve_batch', {
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

  const { data: batch, error: batchError } = await service
    .from('partial_writeoff_batches')
    .select('*')
    .eq('id', batchId)
    .single();
  if (batchError) throw batchError;
  if (batch.status === 'awaiting_checkout') {
    await syncOriginalBudgetPartialStatus(operation, batchId, auth);
    return getOperationGraph(operationId);
  }
  if (existingReservation && batch.status === 'creating') {
    // A chamada anterior pode ter criado o documento no GestãoClick e perdido
    // apenas a resposta. Recuperamos pelo marcador antes de permitir qualquer
    // nova tentativa, eliminando a possibilidade de documento duplicado.
    let recovered: any | null = null;
    try {
      recovered = await findAuxiliaryByMarker(operation.document_type, batch.marker);
    } catch {
      throw new Error('BATCH_CREATION_IN_PROGRESS');
    }
    if (!recovered?.id) throw new Error('BATCH_CREATION_IN_PROGRESS');
    const { error: attachRecoveredError } = await service.rpc('partial_writeoff_attach_auxiliary', {
      p_batch_id: batchId,
      p_document_id: String(recovered.id),
      p_document_code: String(recovered.codigo || ''),
      p_gc_response: recovered,
    });
    if (attachRecoveredError) throw attachRecoveredError;
    await syncOriginalBudgetPartialStatus(operation, batchId, auth);
    return getOperationGraph(operationId);
  }
  if (existingReservation) throw new Error(`BATCH_NOT_REUSABLE:${batch.status}`);

  const settings = await getSettings();
  const waitingStatus = settings[`${operation.document_type}_waiting_status_id`];
  if (!waitingStatus) throw new Error('PARTIAL_STATUS_NOT_CONFIGURED');
  const payload = await auxiliaryPayload(operation, selected, waitingStatus, batch.marker, auth.profile.gc_usuario_id);
  const path = operation.document_type === 'os' ? '/api/ordens_servicos' : '/api/vendas';

  let document: any = null;
  try {
    const response = await gcRequest(path, 'POST', payload);
    document = response?.data || null;
    if (!document?.id) throw new Error('GESTAOCLICK_RETURNED_NO_DOCUMENT_ID');
  } catch (createError) {
    // Em erro de rede a resposta pode ter se perdido depois do POST. Só
    // liberamos a reserva quando o GC recusou explicitamente a criação.
    try {
      document = await findAuxiliaryByMarker(operation.document_type, batch.marker);
    } catch { /* ambiguity is handled below */ }
    if (!document?.id) {
      const message = compact(createError) || 'Falha ambígua ao criar documento auxiliar';
      const explicitRejection = message.startsWith(`GestãoClick POST ${path}`);
      if (explicitRejection) {
        await service.rpc('partial_writeoff_release_batch', { p_batch_id: batchId, p_error_message: message });
      } else {
        await markBatchReconciliation(batchId, operationId, `Criação ambígua no GestãoClick: ${message}`);
      }
      throw createError;
    }
  }

  const { error: attachError } = await service.rpc('partial_writeoff_attach_auxiliary', {
    p_batch_id: batchId,
    p_document_id: String(document.id),
    p_document_code: String(document.codigo || ''),
    p_gc_response: document,
  });
  if (attachError) {
    const message = `Documento auxiliar #${document.codigo || document.id} criado, mas não vinculado: ${compact(attachError)}`;
    try {
      const cancelStatus = settings[`${operation.document_type}_cancel_status_id`];
      if (!cancelStatus) throw new Error('PARTIAL_CANCEL_STATUS_NOT_CONFIGURED');
      await updateDocumentStatus(operation.document_type, String(document.id), cancelStatus);
      await service.rpc('partial_writeoff_release_batch', { p_batch_id: batchId, p_error_message: message });
    } catch (cancelError) {
      await markBatchReconciliation(
        batchId,
        operationId,
        `${message}. Cancelamento automático falhou: ${compact(cancelError)}`,
        document,
      );
    }
    throw attachError;
  }
  await syncOriginalBudgetPartialStatus(operation, batchId, auth);
  // Tarefa Auvo da entrega parcial (mesma receita da geração de OS).
  // Falha aqui NÃO invalida a baixa: o lote fica registrado com o aviso.
  const batchWithDocument = {
    ...batch,
    auxiliary_document_id: String(document.id),
    auxiliary_document_code: String(document.codigo || ''),
  };
  try {
    if (!auth.profile.auvo_user_id) throw new Error('Usuário sem "auvo_user_id" configurado no perfil');
    const taskId = await createPartialAuvoTask(
      operation,
      batchWithDocument,
      selected,
      String(auth.profile.auvo_user_id),
      body.auvo_customer_id ? String(body.auvo_customer_id) : undefined,
    );
    try {
      await attachAuvoTaskToAuxiliary(operation.document_type, String(document.id), taskId, operation.budget_code);
    } catch (linkError) {
      console.warn('[partial-writeoff] tarefa criada mas não vinculada ao GC:', compact(linkError));
    }
    const { error: batchUpdateError } = await service.from('partial_writeoff_batches')
      .update({ auvo_task_id: taskId, auvo_task_error: null })
      .eq('id', batchId);
    if (batchUpdateError) console.error('[partial-writeoff] erro ao gravar task_id no banco:', batchUpdateError);
    
    await service.from('partial_writeoff_events').insert({
      operation_id: operationId,
      batch_id: batchId,
      event_type: 'auvo_task_created',
      payload: { auvo_task_id: taskId, document_code: String(document.codigo || '') },
      actor_id: auth.id,
      actor_name: auth.name,
    });
  } catch (taskError) {
    const message = compact(taskError).slice(0, 500) || 'Falha desconhecida ao criar tarefa no Auvo';
    console.error('[partial-writeoff] falha ao criar tarefa Auvo:', message);
    await service.from('partial_writeoff_batches').update({ auvo_task_error: message }).eq('id', batchId);
    await service.from('partial_writeoff_events').insert({
      operation_id: operationId,
      batch_id: batchId,
      event_type: 'auvo_task_failed',
      payload: { error: message },
      actor_id: auth.id,
      actor_name: auth.name,
    });
  }

  return getOperationGraph(operationId);

}

async function handleConfirmBatch(body: any, auth: AuthContext) {
  const batchId = String(body.batch_id || '');
  const { data: batch, error: batchError } = await service
    .from('partial_writeoff_batches')
    .select('*')
    .eq('id', batchId)
    .single();
  if (batchError || !batch) throw new Error('BATCH_NOT_FOUND');
  if (batch.status === 'confirmed') return getOperationGraph(batch.operation_id);
  if (batch.status !== 'awaiting_checkout') throw new Error(`BATCH_NOT_CONFIRMABLE:${batch.status}`);
  const operation = await getOperationGraph(batch.operation_id);
  await syncOriginalBudgetPartialStatus(operation, batchId, auth);

  const { data: batchItems, error: itemsError } = await service
    .from('partial_writeoff_batch_items')
    .select('quantity, partial_writeoff_items(*)')
    .eq('batch_id', batchId);
  if (itemsError) throw itemsError;
  const expectedLines = (batchItems || []).map((entry: any) => selectedLine(entry.partial_writeoff_items.line_snapshot, numberValue(entry.quantity)));
  const type = batch.auxiliary_document_type as DocumentType;
  const path = type === 'os'
    ? `/api/ordens_servicos/${encodeURIComponent(batch.auxiliary_document_id)}`
    : `/api/vendas/${encodeURIComponent(batch.auxiliary_document_id)}`;
  const currentDocument = (await gcRequest(path))?.data;
  if (!sameQuantities(quantityMap(expectedLines), quantityMap(currentDocument?.produtos || []))) {
    throw new Error('AUXILIARY_ITEMS_CHANGED');
  }

  const { data: claim, error: claimError } = await service.rpc('partial_writeoff_claim_confirmation', { p_batch_id: batchId });
  if (claimError) throw claimError;
  if (claim === 'confirmed') return getOperationGraph(batch.operation_id);

  const settings = await getSettings();
  const stockStatus = settings[`${type}_stock_status_id`];
  try {
    await updateDocumentStatus(type, String(batch.auxiliary_document_id), stockStatus);
    const { error: finishError } = await service.rpc('partial_writeoff_finish_confirmation', {
      p_batch_id: batchId,
      p_success: true,
      p_error_message: null,
      p_actor_id: auth.id,
      p_actor_name: auth.name,
    });
    if (finishError) throw finishError;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let applied = false;
    try {
      const latest = (await gcRequest(path))?.data;
      applied = normalizeId(latest?.situacao_id) === stockStatus;
    } catch { /* keep false */ }
    const { error: finishError } = await service.rpc('partial_writeoff_finish_confirmation', {
      p_batch_id: batchId,
      p_success: applied,
      p_error_message: applied ? null : message,
      p_actor_id: auth.id,
      p_actor_name: auth.name,
    });
    if (finishError || !applied) throw new Error(applied ? String(finishError?.message || message) : message);
  }
  return getOperationGraph(batch.operation_id);
}

async function compensateAuxiliaries(batches: any[], settings: Record<string, string>): Promise<boolean> {
  let ok = true;
  for (const batch of batches) {
    try {
      await updateDocumentStatus(batch.auxiliary_document_type, batch.auxiliary_document_id, settings[`${batch.auxiliary_document_type}_stock_status_id`]);
      await service.from('partial_writeoff_batches').update({ status: 'confirmed', error_message: null }).eq('id', batch.id);
    } catch (error) {
      ok = false;
      await service.from('partial_writeoff_batches').update({
        status: 'reconciliation_required',
        error_message: compact(error).slice(0, 1000),
      }).eq('id', batch.id);
    }
  }
  return ok;
}

async function handleConsolidate(body: any, auth: AuthContext) {
  const operationId = String(body.operation_id || '');
  const operation = await getOperationGraph(operationId);
  if (operation.status === 'completed') return operation;
  if (operation.document_type === 'os' && !auth.profile.default_os_conclusion_status) {
    throw new Error('CONFIGURE_OS_CONCLUSION_STATUS');
  }
  if (!auth.profile.auvo_user_id) throw new Error('CONFIGURE_AUVO_USER_ID');

  const { error: claimError } = await service.rpc('partial_writeoff_claim_consolidation', { p_operation_id: operationId });
  if (claimError) throw claimError;
  const settings = await getSettings();
  const confirmedBatches = operation.batches.filter((batch: any) => batch.status === 'confirmed');

  const cancelled: any[] = [];
  try {
    for (const batch of confirmedBatches) {
      cancelled.push(batch);
      await service.from('partial_writeoff_batches').update({ status: 'cancelling' }).eq('id', batch.id);
      await updateDocumentStatus(batch.auxiliary_document_type, batch.auxiliary_document_id, settings[`${batch.auxiliary_document_type}_cancel_status_id`]);
      await service.from('partial_writeoff_batches').update({ status: 'cancelled', error_message: null }).eq('id', batch.id);
    }
  } catch (error) {
    const compensated = await compensateAuxiliaries(cancelled, settings);
    const message = `Falha ao compensar auxiliares antes da consolidação: ${compact(error)}`;
    if (compensated) {
      await service.from('partial_writeoff_operations').update({ status: 'ready_to_consolidate', reconciliation_reason: null }).eq('id', operationId);
    } else {
      await service.rpc('partial_writeoff_finish_consolidation', {
        p_operation_id: operationId, p_success: false, p_error_message: message,
        p_actor_id: auth.id, p_actor_name: auth.name,
      });
    }
    throw new Error(message);
  }

  // Rastreio: todas as entregas parciais (documento auxiliar + tarefa Auvo)
  // são enviadas ao gerador para ficarem amarradas à OS/Venda final.
  const partialAuxiliaries = operation.batches
    .filter((batch: any) => batch.auxiliary_document_id)
    .map((batch: any) => ({
      sequence: batch.sequence,
      document_type: batch.auxiliary_document_type,
      document_id: String(batch.auxiliary_document_id || ''),
      document_code: String(batch.auxiliary_document_code || ''),
      auvo_task_id: batch.auvo_task_id ? String(batch.auvo_task_id) : null,
      confirmed_at: batch.confirmed_at || null,
    }));

  let generated: any;
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-os`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orcamento: operation.budget_snapshot,
        auvo_user_id: auth.profile.auvo_user_id,
        gc_usuario_id: auth.profile.gc_usuario_id || undefined,
        auvo_customer_id: body.auvo_customer_id || undefined,
        manual_equipamento: body.manual_equipamento || undefined,
        partial_auxiliaries: partialAuxiliaries,
      }),
    });

    generated = await response.json();
    if (!response.ok || generated?.error) throw new Error(generated?.error || `generate-os ${response.status}`);

    if (operation.document_type === 'os') {
      await updateDocumentStatus('os', String(generated.os_id), String(auth.profile.default_os_conclusion_status));
    }
  } catch (error) {
    const compensated = generated?.os_id ? false : await compensateAuxiliaries(cancelled, settings);
    const message = generated?.os_id
      ? `Documento definitivo #${generated.os_codigo || generated.os_id} foi criado, mas não foi possível finalizá-lo: ${compact(error)}`
      : `Falha ao criar documento definitivo: ${compact(error)}`;
    if (compensated) {
      await service.from('partial_writeoff_operations').update({ status: 'ready_to_consolidate', reconciliation_reason: null }).eq('id', operationId);
    } else {
      await service.rpc('partial_writeoff_finish_consolidation', {
        p_operation_id: operationId, p_success: false,
        p_document_id: generated?.os_id ? String(generated.os_id) : null,
        p_document_code: generated?.os_codigo ? String(generated.os_codigo) : null,
        p_auvo_task_id: generated?.auvo_task_id ? String(generated.auvo_task_id) : null,
        p_error_message: message, p_actor_id: auth.id, p_actor_name: auth.name,
      });
    }
    throw new Error(message);
  }

  await service.from('os_generation_logs').insert({
    orcamento_codigo: operation.budget_code,
    orcamento_id: operation.budget_id,
    nome_cliente: operation.client_name,
    os_id: String(generated.os_id || ''),
    os_codigo: String(generated.os_codigo || ''),
    auvo_task_id: String(generated.auvo_task_id || ''),
    operator_id: auth.id,
    operator_name: auth.name,
    valor_total: numberValue(operation.budget_snapshot?.valor_total),
    warnings: generated.warnings || null,
    partial_auxiliaries: partialAuxiliaries.length ? partialAuxiliaries : null,
    success: true,

  });

  const { error: finishError } = await service.rpc('partial_writeoff_finish_consolidation', {
    p_operation_id: operationId,
    p_success: true,
    p_document_id: String(generated.os_id || ''),
    p_document_code: String(generated.os_codigo || ''),
    p_auvo_task_id: String(generated.auvo_task_id || ''),
    p_error_message: null,
    p_actor_id: auth.id,
    p_actor_name: auth.name,
  });
  if (finishError) throw finishError;
  return getOperationGraph(operationId);
}

/**
 * Cria (ou recria) a tarefa Auvo de um lote já vinculado a um documento auxiliar.
 * Usado pelo fluxo de baixa parcial logo após criar a OS/Venda auxiliar e também
 * como "tentar novamente" quando a criação da tarefa falhou.
 */
async function handleCreateBatchTask(body: any, auth: AuthContext) {
  const batchId = String(body.batch_id || '');
  if (!batchId) throw new Error('BATCH_ID_REQUIRED');

  const { data: batch, error: batchError } = await service
    .from('partial_writeoff_batches')
    .select('*')
    .eq('id', batchId)
    .single();
  if (batchError || !batch) throw new Error('BATCH_NOT_FOUND');
  if (!batch.auxiliary_document_id) throw new Error('BATCH_WITHOUT_DOCUMENT');
  if (batch.auvo_task_id) return batch;
  if (!auth.profile.auvo_user_id) throw new Error('CONFIGURE_AUVO_USER_ID');

  const operation = await getOperationGraph(String(batch.operation_id));
  const { data: batchItems, error: itemsError } = await service
    .from('partial_writeoff_batch_items')
    .select('quantity, partial_writeoff_items(*)')
    .eq('batch_id', batchId);
  if (itemsError) throw itemsError;
  const selected = (batchItems || []).map((entry: any) => ({
    item: entry.partial_writeoff_items,
    quantity: numberValue(entry.quantity),
  }));

  try {
    const taskId = await createPartialAuvoTask(
      operation,
      batch,
      selected,
      String(auth.profile.auvo_user_id),
      body.auvo_customer_id ? String(body.auvo_customer_id) : undefined,
    );
    try {
      await attachAuvoTaskToAuxiliary(
        batch.auxiliary_document_type as DocumentType,
        String(batch.auxiliary_document_id),
        taskId,
        String(operation.budget_code || ''),
      );
    } catch (linkError) {
      console.warn('[partial-writeoff] tarefa criada mas não vinculada ao GC:', compact(linkError));
    }
    const { data: updated } = await service
      .from('partial_writeoff_batches')
      .update({ auvo_task_id: taskId, auvo_task_error: null })
      .eq('id', batchId)
      .select('*')
      .single();
    await service.from('partial_writeoff_events').insert({
      operation_id: batch.operation_id,
      batch_id: batchId,
      event_type: 'auvo_task_created',
      payload: { auvo_task_id: taskId, document_code: String(batch.auxiliary_document_code || '') },
      actor_id: auth.id,
      actor_name: auth.name,
    });
    return updated || { ...batch, auvo_task_id: taskId, auvo_task_error: null };
  } catch (taskError) {
    const message = compact(taskError).slice(0, 500) || 'Falha desconhecida ao criar tarefa no Auvo';
    console.error('[partial-writeoff] falha ao criar tarefa Auvo:', message);
    await service.from('partial_writeoff_batches').update({ auvo_task_error: message }).eq('id', batchId);
    await service.from('partial_writeoff_events').insert({
      operation_id: batch.operation_id,
      batch_id: batchId,
      event_type: 'auvo_task_failed',
      payload: { error: message },
      actor_id: auth.id,
      actor_name: auth.name,
    });
    throw new Error(message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const auth = await authenticate(req);
    const body = await req.json();
    const action = String(body?.action || '');

    if (action === 'search_budgets') {
      const budgets = await searchBudgets(String(body.term || ''));
      const ids = budgets.map((budget) => String(budget.id));
      const { data: operations } = ids.length
        ? await service.from('partial_writeoff_operations').select('id, budget_id, status').in('budget_id', ids).not('status', 'in', '(completed,cancelled)')
        : { data: [] as any[] };
      const active = new Map((operations || []).map((operation: any) => [operation.budget_id, operation]));
      return json({ budgets: budgets.map((budget) => ({ ...budget, partial_operation: active.get(String(budget.id)) || null })) });
    }
    if (action === 'open_operation') return json({ operation: await handleOpenOperation(body, auth) });
    if (action === 'get_operation') return json({ operation: await getOperationGraph(String(body.operation_id || '')) });
    if (action === 'list_operations') return json({ operations: await listOperationGraphs() });
    if (action === 'prepare_batch') return json({ operation: await handlePrepareBatch(body, auth) });
    if (action === 'confirm_batch') return json({ operation: await handleConfirmBatch(body, auth) });
    if (action === 'consolidate') return json({ operation: await handleConsolidate(body, auth) });
    if (action === 'create_batch_task') return json({ batch: await handleCreateBatchTask(body, auth) });
    return json({ error: 'UNKNOWN_ACTION' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[partial-writeoff]', message);
    const status = message === 'AUTH_REQUIRED' ? 401 : 400;
    return json({ error: message }, status);
  }
});
