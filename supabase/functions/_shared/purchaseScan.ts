import type { ComprasResult, ItemCompra, OrcamentoConvertidoWarning } from '../../../src/api/types.ts';
import type { PartialWriteoffOperation } from '../../../src/api/partialWriteoff.ts';
import { pendingOsLines, excluded } from './osStockCommitments.ts';
import { normalizedStatus, type GcRecord } from './partialExecution.ts';
import { currentPartialDemand } from './currentPartialDemand.ts';
import { assertBudgetUnchanged } from './budgetIntegrity.ts';

export const PURCHASE_SCAN_VERSION = 3;
export const BUDGET_STATUS_NAMES = ['APROVADO - AGUARDANDO COMPRA', 'COMPRADO - AGUARDANDO CHEGADA', 'COMPRADO - AG CHEGADA PARA ESTOQUE'];
export const PURCHASE_STATUS_NAMES = ['Em Cotação', 'Aguardando Aprovação', 'Aprovada - AG COMPRA', 'COMPRADO - AG CHEGADA', 'SOLICITADO - GARANTIA', 'COMPRADO - AG CHEGADA PARA ESTOQUE'];
const id = (v: unknown) => ['0', 'null', 'undefined'].includes(String(v)) ? '' : String(v ?? '').trim();
const number = (v: unknown) => Number(String(v ?? '').includes(',') ? String(v).replace(/\./g, '').replace(',', '.') : v);
const qty = (v: number) => Number(v.toFixed(6));
const unwrap = (v: GcRecord) => v.Orcamento || v.Compra || v.compra || v.OrdemServico || v.ordem_servico || v.ordemServico || v;
const product = (v: GcRecord) => v.produto || v;
const converted = (v: unknown) => number(v) > 0 || ['TRUE', 'SIM', 'YES'].includes(normalizedStatus(v));
const active = (ops: PartialWriteoffOperation[]) => ops.filter(o => !['completed', 'cancelled'].includes(o.status));
const fingerprint = (ops: PartialWriteoffOperation[]) => JSON.stringify(active(ops).map(o => [o.id, o.version, o.status,
  o.items.map(i => [i.id, i.original_quantity, i.withdrawn_quantity, i.reserved_quantity]).sort()]).sort());

export interface PurchaseScanPorts {
  gc(path: string): Promise<GcRecord>;
  partials(): Promise<PartialWriteoffOperation[]>;
  progress?(step: string, checked: number, total: number): void;
}

class CatalogChanged extends Error {}

export async function purchaseCatalog(gc: PurchaseScanPorts['gc'], path: string, progress?: PurchaseScanPorts['progress']): Promise<GcRecord[]> {
  // O GC é usado durante a varredura. Recomeça somente o catálogo que mudou,
  // sem aceitar páginas de momentos diferentes nem reexecutar consultas já validadas.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rows: GcRecord[] = [], seen = new Set<string>();
      let pages = 1, count: number | undefined;
      const request = (page: number) => gc(`${path}${path.includes('?') ? '&' : '?'}limite=100&pagina=${page}`);
      const consume = (res: GcRecord, page: number) => {
        const total = Number(res.meta?.total_paginas), records = Number(res.meta?.total_registros);
        if (!Array.isArray(res.data) || !Number.isInteger(total) || total < 0 || !Number.isInteger(records) || records < 0 || Number(res.meta?.pagina_atual) !== page) {
          throw new Error(`Consulta incompleta de ${path}. Atualize a lista novamente.`);
        }
        if (page > 1 && (pages !== total || count !== records)) throw new CatalogChanged(`O catálogo ${path} mudou durante a leitura.`);
        pages = total; count = records;
        for (const raw of res.data) {
          const row = unwrap(raw), rowId = id(row.id);
          if (!rowId || seen.has(rowId)) throw new CatalogChanged(`Paginação inconsistente de ${path}.`);
          seen.add(rowId); rows.push(row);
        }
        progress?.(`Conferindo ${path.includes('ordens_servicos') ? 'OS' : path.includes('orcamentos') ? 'orçamentos' : 'pedidos de compra'}… página ${page} de ${pages}`, page, pages);
      };
      consume(await request(1), 1);
      // Três leituras independentes por vez reduzem a janela em que o catálogo pode mudar.
      for (let page = 2; page <= pages; page += 3) {
        const pageNumbers = Array.from({ length: Math.min(3, pages - page + 1) }, (_, i) => page + i);
        const responses = await Promise.all(pageNumbers.map(request));
        responses.forEach((res, i) => consume(res, pageNumbers[i]));
      }
      if (rows.length !== count) throw new CatalogChanged(`Registros ausentes em ${path}. A lista anterior foi preservada.`);
      return rows;
    } catch (error) {
      if (!(error instanceof CatalogChanged) || attempt === 2) throw error;
      progress?.('O GC mudou durante a consulta. Repetindo a conferência desse catálogo…', 0, 1);
    }
  }
  throw new Error('Não foi possível concluir a consulta do GC.');
}

/** Mesmo motor no navegador e na rotina automática. Nunca modifica documentos ou quantidades. */
export async function scanPurchases(ports: PurchaseScanPorts, budgetStatuses: string[], purchaseStatuses: string[]): Promise<ComprasResult> {
  const operations = active(await ports.partials());
  const partialIds = new Set(operations.map(o => o.budget_id));
  const auxiliary = new Set(operations.flatMap(o => o.batches.map(b => `${b.auxiliary_document_type}:${b.auxiliary_document_id}`)));
  const budgets = await purchaseCatalog(ports.gc, '/api/orcamentos', ports.progress);
  const orders = await purchaseCatalog(ports.gc, '/api/compras', ports.progress);
  const serviceOrders = await purchaseCatalog(ports.gc, '/api/ordens_servicos', ports.progress);
  const selectedBudgets = new Set(budgetStatuses), selectedPurchases = new Set(purchaseStatuses);
  const warnings: string[] = [];
  const convertedBudgets: OrcamentoConvertidoWarning[] = [];
  const osIndex = new Map<string, GcRecord>();
  const commitments: ReturnType<typeof pendingOsLines> = [];
  for (let os of serviceOrders) {
    if (auxiliary.has(`os:${id(os.id)}`)) continue;
    if (!excluded(os) && ((!Array.isArray(os.produtos) && number(os.valor_produtos) !== 0) || os.situacao_estoque == null)) {
      const response = await ports.gc(`/api/ordens_servicos/${id(os.id)}`);
      if (id(response.data?.id) !== id(os.id)) throw new Error('Detalhe de OS divergente.');
      os = response.data;
    }
    if (!/CANCEL|EXCLUID/.test(normalizedStatus(os.nome_situacao))) {
      for (const wrapper of os.atributos || []) {
        const a = wrapper.atributo || wrapper;
        if (/ORCAMENTO|NUMERO ORC/.test(normalizedStatus(a.descricao)) && /^\d+$/.test(String(a.conteudo).trim())) osIndex.set(String(a.conteudo).trim(), os);
      }
    }
    commitments.push(...pendingOsLines(os));
  }

  type Demand = { raw: GcRecord; quantity: number; reference: ItemCompra['orcamentos'][number] };
  const demands: Demand[] = [];
  let documentCount = 0;
  for (const budget of budgets) {
    // Uma baixa ativa entra pelos seus saldos oficiais, mesmo fora dos filtros e com OS auxiliar.
    if (partialIds.has(id(budget.id)) || !selectedBudgets.has(id(budget.situacao_id))) continue;
    const os = osIndex.get(String(budget.codigo));
    const byFlags = converted(budget.situacao_financeiro) || converted(budget.situacao_estoque);
    if (byFlags || os) {
      convertedBudgets.push({ orcamento_id: id(budget.id), codigo: String(budget.codigo), nome_cliente: String(budget.nome_cliente || ''),
        situacao_financeiro: String(budget.situacao_financeiro || ''), situacao_estoque: String(budget.situacao_estoque || ''),
        reason: byFlags ? 'flag' : 'os_index', link_number: os ? String(os.codigo) : null, link_id: os ? id(os.id) : null,
        link_situacao: os ? String(os.nome_situacao) : null,
        warning: os ? `Orçamento #${budget.codigo} → já é OS #${os.codigo} [${os.nome_situacao}]` : `Orçamento #${budget.codigo} → convertido (flag financeiro/estoque)` });
      continue;
    }
    if (!Array.isArray(budget.produtos)) throw new Error(`Itens do orçamento #${budget.codigo} não informados.`);
    documentCount++;
    for (const wrapper of budget.produtos) {
      const raw = product(wrapper), quantity = number(raw.quantidade);
      if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Quantidade inválida no orçamento #${budget.codigo}.`);
      if (quantity > 0 && id(raw.produto_id)) demands.push({ raw, quantity, reference: { id: id(budget.id), codigo: String(budget.codigo), qtd: quantity, nome_cliente: String(budget.nome_cliente || '') } });
    }
  }
  let partialCount = 0;
  const sourceReads: Array<{ path: string; source: GcRecord }> = [];
  const localReservations: Array<{ raw: GcRecord; quantity: number; code: string; client: string }> = [];
  for (const op of operations) {
    if (!op.items.length) throw new Error(`Saldo da baixa #${op.budget_code} não informado.`);
    const sale = op.budget_id.startsWith('venda:') || op.budget_snapshot?._partial_source_kind === 'venda';
    const sourceId = String(op.budget_snapshot?._partial_source_id || op.budget_id.replace(/^venda:/, ''));
    const path = `/api/${sale ? 'vendas' : 'orcamentos'}/${encodeURIComponent(sourceId)}`;
    const source = (await ports.gc(path)).data;
    if (!source || id(source.id) !== sourceId || (source.cliente_id != null && id(source.cliente_id) !== op.client_id)) throw new Error(`Origem da baixa #${op.budget_code} não confirmada no GC.`);
    sourceReads.push({ path, source });
    let hasDemand = false;
    for (const current of currentPartialDemand(op, source)) {
      const { raw, reserved } = current;
      if (current.changed) warnings.push(`Origem #${op.budget_code} atualizada no GC: compras considera ${current.requested} solicitado(s), ${current.withdrawn} retirado(s) e ${reserved} reservado(s) de ${raw.nome_produto || raw.produto_id}. Atualize a referência da baixa antes de abrir outro lote.`);
      // Reserva local não é compra nova; protege o estoque destinado a outro lote.
      if (reserved > 0) localReservations.push({ raw, quantity: reserved, code: `Baixa ${op.budget_code}`, client: op.client_name });
      const quantity = current.pending;
      if (quantity <= 0) continue;
      hasDemand = true;
      demands.push({ raw, quantity, reference: { id: op.budget_id, codigo: op.budget_code, qtd: quantity, nome_cliente: op.client_name,
        source_kind: op.budget_id.startsWith('venda:') ? 'venda' : 'orcamento', partial_operation_id: op.id } });
    }
    if (hasDemand) { documentCount++; partialCount++; }
  }

  const productIds = [...new Set([...demands.map(d => id(d.raw.produto_id)), ...commitments.map(c => c.productId), ...localReservations.map(r => id(r.raw.produto_id))])];
  const details = new Map<string, GcRecord>();
  for (let i = 0; i < productIds.length; i++) {
    const pid = productIds[i];
    ports.progress?.('Conferindo estoque e compras das peças necessárias…', i + 1, productIds.length);
    const response = await ports.gc(`/api/produtos/${pid}?cache_bust=${Date.now()}`);
    const detail = response.data?.Produto || response.data?.produto || response.data;
    if (!detail || id(detail.id) !== pid || detail.estoque == null || !Number.isFinite(number(detail.estoque))) throw new Error(`Estoque do produto ${pid} não confirmado. A lista anterior foi preservada.`);
    details.set(pid, detail);
  }
  const variation = (raw: GcRecord) => String(details.get(id(raw.produto_id))?.possui_variacao ?? raw.possui_variacao) === '0' ? '' : id(raw.variacao_id ?? raw.estoque_id);
  const key = (raw: GcRecord) => `${id(raw.produto_id)}::${variation(raw)}`;
  const items = new Map<string, ItemCompra>();
  const ensure = (raw: GcRecord) => {
    const k = key(raw);
    if (items.has(k)) return items.get(k)!;
    const detail = details.get(id(raw.produto_id))!;
    const vid = variation(raw);
    let stock = number(detail.estoque);
    if (vid) {
      const v = (detail.variacoes || []).map((w: GcRecord) => w.variacao || w).find((v: GcRecord) => [v.id, v.variacao_id, v.variacao_api_id].some(n => id(n) === vid));
      if (!v || v.estoque == null || !Number.isFinite(number(v.estoque))) throw new Error(`Estoque da variação ${vid} do produto ${detail.nome} não confirmado.`);
      stock = number(v.estoque);
    } else if (String(detail.possui_variacao) === '1') {
      stock = 0;
      warnings.push(`${detail.nome}: demanda sem variação definida; confira a variação antes de comprar. Nenhum estoque de outra variação foi usado como cobertura.`);
    }
    const result: ItemCompra = { produto_id: id(raw.produto_id), variacao_id: vid, nome_produto: String(detail.nome || raw.nome_produto || ''),
      codigo_produto: String(detail.codigo_interno || raw.codigo_produto || ''), sigla_unidade: String(raw.sigla_unidade || 'UN'),
      grupo: String(detail.nome_grupo || detail.grupo_nome || detail.grupo?.nome || '').trim() || undefined,
      estoque_atual: stock, estoque_reservado_os: 0, estoque_disponivel: 0, qtd_necessaria: 0, qtd_a_comprar: 0, qtd_ja_em_compra: 0,
      qtd_efetiva_a_comprar: 0, ultimo_preco: number(detail.valor_custo) || 0, estimativa: 0, movimenta_estoque: String(detail.movimenta_estoque) !== '0',
      orcamentos: [], ordens_compra: [], os_reservas: [] };
    items.set(k, result); return result;
  };
  for (const d of demands) {
    const item = ensure(d.raw); item.qtd_necessaria += d.quantity;
    const ref = item.orcamentos.find(r => r.id === d.reference.id);
    if (ref) ref.qtd += d.quantity; else item.orcamentos.push({ ...d.reference });
  }
  for (const c of commitments) {
    const item = ensure({ produto_id: c.productId, variacao_id: c.variationId });
    item.estoque_reservado_os += c.quantity;
    item.os_reservas!.push({ os_codigo: c.code, nome_cliente: c.client, qtd: c.quantity });
  }
  for (const r of localReservations) {
    const item = ensure(r.raw); item.estoque_reservado_os += r.quantity;
    item.os_reservas!.push({ os_codigo: r.code, nome_cliente: r.client, qtd: r.quantity });
  }
  for (const order of orders) {
    const open = selectedPurchases.has(id(order.situacao_id)) && !converted(order.situacao_estoque)
      && !/CANCEL|EXCLUID|RECEBID|FINALIZAD|CONCLUID/.test(normalizedStatus(order.nome_situacao));
    if (!Array.isArray(order.produtos)) {
      if (open && number(order.valor_produtos ?? order.valor_total) !== 0) throw new Error(`Itens do pedido #${order.codigo} não informados.`);
      continue;
    }
    for (const wrapper of order.produtos) {
      const raw = product(wrapper), item = items.get(key(raw));
      if (!item) continue; // Nunca usar um pedido de outra variação como cobertura.
      if (!item.fornecedor_nome) { item.fornecedor_id = id(order.fornecedor_id); item.fornecedor_nome = String(order.nome_fornecedor || ''); }
      if (!open) continue;
      const ordered = number(raw.quantidade), received = number(raw.quantidade_recebida ?? 0);
      if (![ordered, received].every(n => Number.isFinite(n) && n >= 0) || received > ordered) throw new Error(`Quantidade inválida no pedido #${order.codigo}.`);
      const quantity = qty(ordered - received);
      if (!quantity) continue;
      item.qtd_ja_em_compra += quantity;
      const previous = item.ordens_compra.find(p => p.id === id(order.id));
      if (previous) previous.qtd += quantity;
      else item.ordens_compra.push({ id: id(order.id), codigo: String(order.codigo), qtd: quantity, nome_fornecedor: String(order.nome_fornecedor || ''),
        situacao: String(order.nome_situacao || ''), data_emissao: String(order.data_emissao || '') });
    }
  }
  for (const item of items.values()) {
    item.qtd_necessaria = qty(item.qtd_necessaria); item.estoque_reservado_os = qty(item.estoque_reservado_os); item.qtd_ja_em_compra = qty(item.qtd_ja_em_compra);
    item.estoque_disponivel = qty(Math.max(0, item.estoque_atual - item.estoque_reservado_os));
    // Inclui também o déficit das OS quando já comprometem mais que o estoque físico.
    item.qtd_a_comprar = qty(Math.max(0, item.qtd_necessaria + item.estoque_reservado_os - Math.max(0, item.estoque_atual)));
    item.qtd_efetiva_a_comprar = qty(Math.max(0, item.qtd_a_comprar - item.qtd_ja_em_compra));
    item.estimativa = item.qtd_efetiva_a_comprar * item.ultimo_preco;
  }
  if (fingerprint(operations) !== fingerprint(await ports.partials())) throw new Error('Uma baixa mudou durante a varredura. Atualize a lista para conferir o novo saldo.');
  for (const read of sourceReads) assertBudgetUnchanged(read.source, (await ports.gc(read.path)).data || {});
  const all = [...items.values()];
  const itensList = all.filter(i => i.qtd_efetiva_a_comprar > 0), itensOkList = all.filter(i => i.qtd_a_comprar === 0);
  const itensCobertosporPedido = all.filter(i => i.qtd_a_comprar > 0 && i.qtd_efetiva_a_comprar === 0);
  return { itensList, itensOkList, itensCobertosporPedido, orcamentosConvertidos: convertedBudgets, totalOrcamentos: documentCount,
    totalProdutosSemEstoque: itensList.length, totalProdutosOk: itensOkList.length, totalItensCobertosporPedido: itensCobertosporPedido.length,
    estimativaTotal: itensList.reduce((n, i) => n + i.estimativa, 0), scannedAt: new Date().toISOString(),
    purchaseScanVersion: PURCHASE_SCAN_VERSION, partialOperationsIncluded: partialCount, warnings };
}
