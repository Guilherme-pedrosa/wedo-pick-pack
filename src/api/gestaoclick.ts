import { changeDocumentStatus } from './gcStatusUpdate';
import { documentStockLines } from '../../supabase/functions/_shared/osStockCommitments';
import { isCancelledStatus, isExecutedStatus } from './partialExecution';
import { GCOrdemServico, GCVenda, GCSituacao, GCMeta, GCProdutoItem, GCOrdemCompra } from './types';
import { listOrdensCompra } from './compras';
import { MOCK_OS, MOCK_VENDAS, MOCK_STATUS_OS, MOCK_STATUS_VENDA } from './mockData';
import { scopeSituationCatalog, scopeSituationIds } from './situationScopes';
import { supabase } from '@/integrations/supabase/client';

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

export function isUsingMock(): boolean {
  return !SUPABASE_PROJECT_ID;
}

const GC_PROXY_TIMEOUT_MS = 20000;
const GC_GET_MAX_ATTEMPTS = 3;

async function apiRequest<T>(path: string, options?: { method?: string; body?: string }): Promise<T> {
  const method = options?.method || 'GET';
  const isGet = method === 'GET';
  const maxAttempts = isGet ? GC_GET_MAX_ATTEMPTS : 1;
  const payload = options?.body ? JSON.parse(options.body) : undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          // End this browser request before starting another attempt. A race
          // alone leaves the old fetch running and duplicates traffic to GC.
          controller.abort();
          reject(new Error('REQUEST_TIMEOUT'));
        }, GC_PROXY_TIMEOUT_MS);
      });

      const invokePromise = supabase.functions.invoke('gc-proxy', {
        body: { path, method, payload },
        signal: controller.signal,
      });

      const { data, error } = await Promise.race([invokePromise, timeoutPromise]);
      clearTimeout(timeout);

      if (error) {
        const msg = error.message || 'Erro de conexão com o servidor';
        if (error.name === 'FunctionsFetchError' || /Failed to fetch|Failed to send/i.test(msg)) throw new Error('NETWORK_ERROR');
        throw new Error(msg);
      }

      const response = data as any;

      // Check proxy metadata for GC API errors
      const proxyMeta = response?._proxy;
      const gcOk = proxyMeta?.ok;
      const gcHttpStatus = proxyMeta?.gc_http_status;

      // Also check GC's own status field in body
      const gcBodyStatus = response?.status; // "success" or "error"
      const gcBodyCode = response?.code; // numeric status from GC

      if (gcOk === false || gcBodyStatus === 'error' || (gcBodyCode && gcBodyCode >= 400)) {
        const gcMsg = response?.data?.mensagem || response?.data?.erro || response?.error || '';
        const statusCode = gcHttpStatus || gcBodyCode || 0;

        if (statusCode === 429) {
          if (attempt < maxAttempts - 1) {
            const waitMs = 900 * (attempt + 1) + Math.floor(Math.random() * 200);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
          throw new Error('RATE_LIMIT');
        }

        if (statusCode === 401 || statusCode === 403) throw new Error('AUTH_ERROR');
        throw new Error(gcMsg || `Erro ${statusCode} no GestãoClick`);
      }

      return response as T;
    } catch (err) {
      const message = controller.signal.aborted ? 'REQUEST_TIMEOUT' : err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      const retryable = isGet && (message === 'REQUEST_TIMEOUT' || message === 'NETWORK_ERROR' || message === 'RATE_LIMIT');

      if (retryable && attempt < maxAttempts - 1) {
        const waitMs = 900 * (attempt + 1) + Math.floor(Math.random() * 200);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (message === 'REQUEST_TIMEOUT') throw new Error('TIMEOUT');
      throw err instanceof Error ? err : new Error('Erro de conexão com o servidor');
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('Erro de conexão com o servidor');
}

const mockDelay = () => new Promise(r => setTimeout(r, 300));

// --- LIST ---
export async function listOS(situacaoId?: string, pagina = 1, pesquisa?: string, limite = 100): Promise<{ data: GCOrdemServico[]; meta: GCMeta }> {
  const term = pesquisa?.trim();

  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_OS];
    if (situacaoId) data = data.filter(o => o.situacao_id === situacaoId);
    if (term) {
      const q = term.toLowerCase();
      data = data.filter(o =>
        o.codigo.toLowerCase().includes(q) ||
        o.nome_cliente.toLowerCase().includes(q)
      );
    }
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }

  const params = new URLSearchParams({ pagina: String(pagina), limite: String(limite) });
  if (situacaoId) params.set('situacao_id', situacaoId);

  // Mantém a fila com os códigos mais novos no topo (ex.: OS 9090)
  params.set('ordenacao', 'codigo');
  params.set('direcao', 'desc');

  if (term) {
    if (/^\d+$/.test(term)) {
      params.set('codigo', term);
      params.set('limite', String(limite));
    }
    // Text search (client name) is handled client-side — GC 'nome' param
    // searches OS title, not client name, so we skip it here.
  }

  return apiRequest<{ data: GCOrdemServico[]; meta: GCMeta }>(`/api/ordens_servicos?${params.toString()}`);
}

/** Fetch OS for multiple situacao_ids in parallel, merging & deduplicating results */
export async function listOSMultiStatus(situacaoIds: string[], pesquisa?: string): Promise<{ data: GCOrdemServico[]; meta: GCMeta }> {
  const scopedIds = isUsingMock()
    ? [...new Set(situacaoIds)]
    : scopeSituationIds(situacaoIds, 'os');
  if (situacaoIds.length === 0) return listOS(undefined, 1, pesquisa);
  if (scopedIds.length === 0) {
    return { data: [], meta: { pagina_atual: 1, total_paginas: 1, total_registros: 0 } };
  }
  if (scopedIds.length === 1) return listOS(scopedIds[0], 1, pesquisa);

  const results = await Promise.all(
    scopedIds.map(sid => listOS(sid, 1, pesquisa).catch(() => ({ data: [] as GCOrdemServico[], meta: { pagina_atual: 1, total_paginas: 1, total_registros: 0 } })))
  );

  const seen = new Set<string>();
  const merged: GCOrdemServico[] = [];
  for (const r of results) {
    for (const o of r.data) {
      if (!seen.has(o.id)) { seen.add(o.id); merged.push(o); }
    }
  }
  return { data: merged, meta: { pagina_atual: 1, total_paginas: 1, total_registros: merged.length } };
}

export async function listVendas(situacaoId?: string, pagina = 1, pesquisa?: string): Promise<{ data: GCVenda[]; meta: GCMeta }> {
  const term = pesquisa?.trim();

  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_VENDAS];
    if (situacaoId) data = data.filter(v => v.situacao_id === situacaoId);
    if (term) {
      const q = term.toLowerCase();
      data = data.filter(v =>
        v.codigo.toLowerCase().includes(q) ||
        v.nome_cliente.toLowerCase().includes(q)
      );
    }
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }

  const params = new URLSearchParams({ pagina: String(pagina) });
  if (situacaoId) params.set('situacao_id', situacaoId);

  params.set('ordenacao', 'codigo');
  params.set('direcao', 'desc');

  if (term) {
    if (/^\d+$/.test(term)) {
      params.set('codigo', term);
      params.set('limite', '100');
    }
    // Text search (client name) is handled client-side
  }

  return apiRequest<{ data: GCVenda[]; meta: GCMeta }>(`/api/vendas?${params.toString()}`);
}

/** Fetch Vendas for multiple situacao_ids in parallel, merging & deduplicating results */
export async function listVendasMultiStatus(situacaoIds: string[], pesquisa?: string): Promise<{ data: GCVenda[]; meta: GCMeta }> {
  const scopedIds = isUsingMock()
    ? [...new Set(situacaoIds)]
    : scopeSituationIds(situacaoIds, 'venda');
  if (situacaoIds.length === 0) return listVendas(undefined, 1, pesquisa);
  if (scopedIds.length === 0) {
    return { data: [], meta: { pagina_atual: 1, total_paginas: 1, total_registros: 0 } };
  }
  if (scopedIds.length === 1) return listVendas(scopedIds[0], 1, pesquisa);

  const results = await Promise.all(
    scopedIds.map(sid => listVendas(sid, 1, pesquisa).catch(() => ({ data: [] as GCVenda[], meta: { pagina_atual: 1, total_paginas: 1, total_registros: 0 } })))
  );

  const seen = new Set<string>();
  const merged: GCVenda[] = [];
  for (const r of results) {
    for (const o of r.data) {
      if (!seen.has(o.id)) { seen.add(o.id); merged.push(o); }
    }
  }
  return { data: merged, meta: { pagina_atual: 1, total_paginas: 1, total_registros: merged.length } };
}

// --- GET SINGLE ---
export async function getOS(id: string): Promise<GCOrdemServico> {
  if (isUsingMock()) {
    await mockDelay();
    const found = MOCK_OS.find(o => o.id === id);
    if (!found) throw new Error('NOT_FOUND');
    return { ...found };
  }
  const res = await apiRequest<{ data: GCOrdemServico }>(`/api/ordens_servicos/${id}`);
  return res.data;
}

export async function getVenda(id: string): Promise<GCVenda> {
  if (isUsingMock()) {
    await mockDelay();
    const found = MOCK_VENDAS.find(v => v.id === id);
    if (!found) throw new Error('NOT_FOUND');
    return { ...found };
  }
  const res = await apiRequest<{ data: GCVenda }>(`/api/vendas/${id}`);
  return res.data;
}

// --- STATUSES ---
export async function getStatusOS(): Promise<GCSituacao[]> {
  if (isUsingMock()) {
    await mockDelay();
    return [...MOCK_STATUS_OS];
  }
  const res = await apiRequest<{ data: GCSituacao[] }>('/api/situacoes_ordens_servicos');
  return scopeSituationCatalog(res.data, 'os');
}

export async function getStatusVendas(): Promise<GCSituacao[]> {
  if (isUsingMock()) {
    await mockDelay();
    return [...MOCK_STATUS_VENDA];
  }
  const res = await apiRequest<{ data: GCSituacao[] }>('/api/situacoes_vendas');
  return scopeSituationCatalog(res.data, 'venda');
}

// --- UPDATE STATUS ---
export async function updateOSStatus(id: string, rawOrder: GCOrdemServico, newStatusId: string, operatorName?: string, _gcUsuarioId?: string, customNote?: string): Promise<GCOrdemServico> {
  if (isUsingMock()) { await mockDelay(); return { ...rawOrder, situacao_id: newStatusId, nome_situacao: MOCK_STATUS_OS.find(s => s.id === newStatusId)?.nome || newStatusId }; }
  return changeDocumentStatus(apiRequest, 'os', id, rawOrder, newStatusId, operatorName, customNote);
}

export async function updateVendaStatus(id: string, rawOrder: GCVenda, newStatusId: string, operatorName?: string, _gcUsuarioId?: string, customNote?: string): Promise<GCVenda> {
  if (isUsingMock()) { await mockDelay(); return { ...rawOrder, situacao_id: newStatusId, nome_situacao: MOCK_STATUS_VENDA.find(s => s.id === newStatusId)?.nome || newStatusId }; }
  return changeDocumentStatus(apiRequest, 'venda', id, rawOrder, newStatusId, operatorName, customNote);
}

export interface ProductStockInfo {
  produto_id: string;
  estoque: number;
  valor_custo: number;
}

export interface StockConflictPO {
  codigo: string;
  nome_fornecedor: string;
  qtd: number;
  situacao: string;
}

export interface StockConflict {
  variacao_id?: string;
  nome_produto: string;
  produto_id: string;
  estoque: number;
  demanda_total: number;
  pedidos: Array<{ codigo: string; nome_cliente: string; qtd: number }>;
  pedidos_compra: StockConflictPO[];
}

export interface BelowCostWarning {
  produto_id: string;
  nome_produto: string;
  valor_custo: number;
  custo_com_imposto: number;
  valor_venda: number;
  pedidos: Array<{ codigo: string; nome_cliente: string; qtd: number }>;
}

export interface StockScanResult {
  fullStockOrders: Set<string>;
  conflicts: StockConflict[];
  belowCostWarnings: BelowCostWarning[];
}

export function parseProductStockResponse(
  response: unknown,
  produtoId: string,
  variacaoId?: string,
): ProductStockInfo | null {
  const envelope = response as {
    data?: {
      Produto?: Record<string, unknown>;
      produto?: Record<string, unknown>;
      [key: string]: unknown;
    };
  };
  const rawData = envelope?.data;
  const data = (rawData?.Produto || rawData?.produto || rawData) as {
    id?: string | number;
    estoque?: string | number;
    valor_custo?: string | number;
    variacoes?: Array<{
      id?: string | number;
      variacao_id?: string | number;
      variacao_api_id?: string | number;
      estoque?: string | number;
      variacao?: {
        id?: string | number;
        variacao_id?: string | number;
        variacao_api_id?: string | number;
        estoque?: string | number;
      };
    }>;
  } | undefined;
  if (!data || (data.id != null && String(data.id) !== produtoId)) return null;

  let estoqueRaw: string | number | undefined = data.estoque;
  const variacoes = data.variacoes ?? [];
  const requestedVariationId = String(variacaoId ?? '').trim();
  if (requestedVariationId && !variacoes.length) return null;
  if (variacoes.length > 0) {
    const matchingVariation = requestedVariationId
      ? variacoes.find(entry => {
          const variation = entry.variacao || entry;
          return [variation?.id, variation?.variacao_id, variation?.variacao_api_id]
            .some(id => String(id ?? '').trim() === requestedVariationId);
        })
      : undefined;
    if (requestedVariationId && !matchingVariation) return null;
    const selectedVariation = matchingVariation ?? (variacoes.length === 1 ? variacoes[0] : undefined);
    const selectedVariationData = selectedVariation?.variacao || selectedVariation;
    if (selectedVariationData) estoqueRaw = selectedVariationData.estoque;
  }

  if (estoqueRaw == null || String(estoqueRaw).trim() === '') return null;
  const estoque = Number(String(estoqueRaw).replace(',', '.'));
  if (!Number.isFinite(estoque)) return null;
  const valorCusto = Number(String(data.valor_custo ?? 0).replace(',', '.'));
  return {
    produto_id: String(data.id ?? produtoId),
    estoque,
    valor_custo: Number.isFinite(valorCusto) ? valorCusto : 0,
  };
}

export async function getProductStock(
  produtoId: string,
  variacaoId?: string,
  options?: { forceFresh?: boolean },
): Promise<ProductStockInfo | null> {
  // apiRequest already owns the retry budget. Retrying it here turned three
  // failed GETs into nine and could hold a single product for three minutes.
  try {
    const res = await apiRequest<{
      data: {
        id: string;
        estoque: string | number;
        valor_custo?: string | number;
        variacoes?: Array<{ variacao: { id: string | number; estoque: string | number } }>;
      };
    }>(`/api/produtos/${produtoId}${options?.forceFresh ? `?cache_bust=${Date.now()}` : ''}`);

    const parsed = parseProductStockResponse(res, produtoId, variacaoId);
    if (!parsed) throw new Error('EMPTY_RESPONSE');
    return parsed;
  } catch (err) {
    console.warn(`[STOCK] Failed to fetch stock for product ${produtoId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Check stock for a list of orders. Returns Set of order IDs that have full stock + conflicts. */
export async function checkStockForOrders(
  orders: Array<GCOrdemServico | GCVenda>,
  onProgress?: (checked: number, total: number) => void,
): Promise<StockScanResult> {
  const stockKey = (p: any) => `${p.produto_id}::${String(p.possui_variacao) === '0' ? '' : p.variacao_id || ''}`;
  const selected = orders.filter(order => !isCancelledStatus(order.nome_situacao) && !isExecutedStatus(order.nome_situacao));
  const productOrderMap = new Map<string, { orderId: string; orderCodigo: string; orderCliente: string; qty: number; nome: string }[]>();
  const productByKey = new Map<string, { productId: string; variationId: string }>();

  for (const order of selected) {
    if (String(order.situacao_estoque) === '1') continue;
    for (const line of documentStockLines(order)) {
      const pid = `${line.productId}::${line.variationId}`;
      const qty = line.quantity;
      productByKey.set(pid, line);
      if (!productOrderMap.has(pid)) productOrderMap.set(pid, []);
      const previous = productOrderMap.get(pid)!.find(entry => entry.orderId === order.id);
      if (previous) { previous.qty += qty; continue; }
      productOrderMap.get(pid)!.push({
        orderId: order.id,
        orderCodigo: order.codigo,
        orderCliente: order.nome_cliente,
        qty,
        nome: order.produtos.find(p => p.produto.produto_id === line.productId)?.produto.nome_produto || line.productId,
      });
    }
  }

  const uniqueIds = [...productOrderMap.keys()];
  const stockMap = new Map<string, number>();
  const costMap = new Map<string, number>();
  const total = uniqueIds.length;
  let checked = 0;

  // Fetch 3 at a time (rate limit)
  for (let i = 0; i < uniqueIds.length; i += 3) {
    const batch = uniqueIds.slice(i, i + 3);
    const results = await Promise.all(batch.map(id => {
      const product = productByKey.get(id)!;
      return getProductStock(product.productId, product.variationId || undefined, { forceFresh: true });
    }));
    batch.forEach((id, idx) => {
      const r = results[idx];
      if (!r) throw new Error('A varredura não conseguiu confirmar todos os saldos. Nenhum pedido será marcado como disponível com dados incompletos.');
      if (r) {
        stockMap.set(id, r.estoque);
        costMap.set(id, r.valor_custo);
      }
    });
    checked += batch.length;
    onProgress?.(checked, total);
    if (i + 3 < uniqueIds.length) {
      await new Promise(r => setTimeout(r, 1100)); // respect rate limit
    }
  }

  // Determine which orders have full stock
  const fullStockOrders = new Set<string>();
  for (const order of selected) {
    const allInStock = [...productOrderMap].every(([k, entries]) => {
      const entry = entries.find(e => e.orderId === order.id);
      return !entry || (stockMap.get(k) ?? 0) >= entry.qty;
    });
    if (allInStock) fullStockOrders.add(order.id);
  }

  // Detect conflicts: products where total demand across orders > stock
  const conflicts: StockConflict[] = [];
  const conflictPids = new Set<string>();
  for (const [pid, entries] of productOrderMap) {
    const stock = stockMap.get(pid) ?? 0;
    const totalDemand = entries.reduce((s, e) => s + e.qty, 0);
    if (totalDemand > stock && entries.length > 1) {
      conflictPids.add(pid);
      conflicts.push({
        produto_id: productByKey.get(pid)!.productId,
        variacao_id: productByKey.get(pid)!.variationId,
        nome_produto: entries[0].nome,
        estoque: stock,
        demanda_total: totalDemand,
        pedidos: entries.map(e => ({ codigo: e.orderCodigo, nome_cliente: e.orderCliente, qtd: e.qty })),
        pedidos_compra: [],
      });
    }
  }

  // If there are conflicts, fetch purchase orders to check coverage
  if (conflicts.length > 0) {
    try {
      onProgress?.(checked, total); // signal we're checking POs
      const poMap = new Map<string, StockConflictPO[]>();
      let page = 1;
      while (true) {
        const res = await listOrdensCompra(undefined, page);
        for (const po of res.data) {
          if (String((po as any).situacao_estoque) === '1' || /CANCEL|RECEBID|CONCLUID/.test(String(po.nome_situacao).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase())) continue;
          for (const p of po.produtos || []) {
            const pid = stockKey(p.produto);
            if (conflictPids.has(pid)) {
              const qty = typeof p.produto.quantidade === 'number' ? p.produto.quantidade : parseFloat(String(p.produto.quantidade)) || 0;
              if (!poMap.has(pid)) poMap.set(pid, []);
              poMap.get(pid)!.push({
                codigo: po.codigo,
                nome_fornecedor: po.nome_fornecedor,
                qtd: qty,
                situacao: po.nome_situacao,
              });
            }
          }
        }
        if (page >= res.meta.total_paginas) break;
        page++;
      }
      // Attach PO data to conflicts
      for (const c of conflicts) {
        c.pedidos_compra = poMap.get(`${c.produto_id}::${c.variacao_id || ''}`) || [];
      }
    } catch (e) {
      console.warn('[STOCK SCAN] Failed to fetch purchase orders for conflicts:', e);
    }
  }

  // Detect below-cost warnings: items where valor_venda < valor_custo + 16% tax
  // Exclude consignment clients (e.g. Ecolab) — their pricing follows different rules
  const CONSIGNMENT_CLIENT_PATTERNS = ['ecolab'];
  const TAX_RATE = 0.16;
  const belowCostWarnings: BelowCostWarning[] = [];
  const belowCostMap = new Map<string, BelowCostWarning>();

  for (const order of orders) {
    // Skip consignment clients
    const clientLower = order.nome_cliente.toLowerCase();
    if (CONSIGNMENT_CLIENT_PATTERNS.some(p => clientLower.includes(p))) continue;

    for (const p of order.produtos || []) {
      const pid = p.produto.produto_id;
      const custo = costMap.get(stockKey(p.produto)) ?? 0;
      if (custo <= 0) continue;

      const valorVendaRaw = String(p.produto.valor_venda ?? '');
      let valorVenda = 0;
      if (valorVendaRaw.includes(',') && valorVendaRaw.includes('.')) {
        valorVenda = parseFloat(valorVendaRaw.replace(/\./g, '').replace(',', '.')) || 0;
      } else if (valorVendaRaw.includes(',')) {
        valorVenda = parseFloat(valorVendaRaw.replace(',', '.')) || 0;
      } else {
        valorVenda = parseFloat(valorVendaRaw) || 0;
      }

      const custoComImposto = custo * (1 + TAX_RATE);
      const qty = typeof p.produto.quantidade === 'number' ? p.produto.quantidade : parseFloat(String(p.produto.quantidade)) || 0;

      if (valorVenda > 0 && valorVenda < custoComImposto) {
        const existing = belowCostMap.get(pid);
        if (existing) {
          if (!existing.pedidos.some(pe => pe.codigo === order.codigo)) {
            existing.pedidos.push({ codigo: order.codigo, nome_cliente: order.nome_cliente, qtd: qty });
          }
        } else {
          const warning: BelowCostWarning = {
            produto_id: pid,
            nome_produto: p.produto.nome_produto,
            valor_custo: custo,
            custo_com_imposto: custoComImposto,
            valor_venda: valorVenda,
            pedidos: [{ codigo: order.codigo, nome_cliente: order.nome_cliente, qtd: qty }],
          };
          belowCostMap.set(pid, warning);
          belowCostWarnings.push(warning);
        }
      }
    }
  }

  return { fullStockOrders, conflicts, belowCostWarnings };
}

// --- PRODUCT DETAILS (for barcode enrichment) ---
interface GCProductExtraField {
  id: string;
  atributo_id: string;
  descricao: string;
  conteudo: string;
  tipo?: string;
}

interface GCProductDetail {
  id: string;
  codigo_barra: string;
  codigo_interno: string;
  nome: string;
  variacoes?: Array<{ variacao: { id: string; codigo: string } }>;
  campos_extras?: GCProductExtraField[];
  atributos?: Array<{ atributo: GCProductExtraField }>;
}

function productLookupId(value: unknown): string {
  const id = String(value ?? '').trim();
  return ['', '0', 'null', 'undefined'].includes(id.toLowerCase()) ? '' : id;
}

async function getProductDetail(produtoId: string, forceFresh = false): Promise<GCProductDetail | null> {
  const requestedId = productLookupId(produtoId);
  // A missing product ID must never turn a detail lookup into a catalog GET.
  if (!requestedId) return null;
  try {
    const res = await apiRequest<{ data: GCProductDetail & { Produto?: GCProductDetail; produto?: GCProductDetail } }>(`/api/produtos/${encodeURIComponent(requestedId)}${forceFresh ? `?cache_bust=${Date.now()}` : ''}`);
    const detail = res.data?.Produto || res.data?.produto || res.data;
    return detail && !Array.isArray(detail) && String(detail.id) === requestedId ? detail : null;
  } catch {
    return null;
  }
}

export async function enrichOrderProducts(
  produtos: Array<{ produto: GCProdutoItem }>,
  options?: {
    checkStock?: boolean;
    onStockWarning?: (message: string) => void;
    onProgress?: (products: Array<{ produto: GCProdutoItem }>) => void;
  },
): Promise<Array<{ produto: GCProdutoItem }>> {
  if (isUsingMock() || !produtos?.length) return produtos;

  // Deduplicate produto_ids
  const uniqueIds = [...new Set(produtos.map(p => productLookupId(p.produto.produto_id)).filter(Boolean))];
  
  // Fetch product details in batches of 3 (respect API rate limit of 3 req/s)
  const detailMap = new Map<string, GCProductDetail>();
  for (let i = 0; i < uniqueIds.length; i += 3) {
    const batch = uniqueIds.slice(i, i + 3);
    await Promise.all(batch.map(async id => {
      const detail = await getProductDetail(id, options?.checkStock);
      if (!detail) return;
      detailMap.set(id, detail);
      // Make each code/location usable as soon as it arrives. A slower product
      // must not hold back the products already loaded in this same batch.
      options?.onProgress?.(withLoadedDetails());
    }));
    if (i + 3 < uniqueIds.length) {
      await new Promise(r => setTimeout(r, 1100)); // respect rate limit
    }
  }

  if (options?.checkStock) {
    const requested = new Map<string, { product: GCProdutoItem; variation?: string; quantity: number }>();
    for (const { produto } of produtos) {
      if (String((produto as any).movimenta_estoque ?? '1') === '0') continue;
      const variation = String((produto as any).possui_variacao ?? '') === '0' ? undefined : produto.variacao_id || undefined;
      const key = `${produto.produto_id}::${variation || ''}`;
      requested.set(key, { product: produto, variation, quantity: Number(produto.quantidade) + (requested.get(key)?.quantity || 0) });
    }
    for (const { product, variation, quantity } of requested.values()) {
      const detail = detailMap.get(productLookupId(product.produto_id));
      const stock = detail ? parseProductStockResponse({ data: detail }, product.produto_id, variation) : null;
      if (!stock) options.onStockWarning?.(`Saldo não consultado: ${product.nome_produto}.`);
      else if (quantity > stock.estoque) options.onStockWarning?.(`Estoque físico insuficiente: ${product.nome_produto} — solicitado ${quantity}, saldo GC ${stock.estoque}.`);
    }
  }

  return withLoadedDetails();

  function withLoadedDetails() {
    return produtos.map(({ produto }) => {
      const detail = detailMap.get(productLookupId(produto.produto_id));
      if (!detail) return { produto };

      // Find variation code if applicable
      let codigoBarras = detail.codigo_barra || '';
      const codigoProduto = detail.codigo_interno || '';

      if (produto.variacao_id && detail.variacoes) {
        const variacao = detail.variacoes.map((v: any) => v.variacao || v).find(v => String(v.id) === produto.variacao_id);
        if (variacao?.codigo) {
          if (!codigoBarras) codigoBarras = '';
        }
      }

      // Extract location fields from atributos (API returns atributos with nested atributo objects)
      let localizacao_fisica = '';
      let localizacao_rational = '';
    
      // Try atributos first (actual API format)
      if (detail.atributos && Array.isArray(detail.atributos)) {
        for (const item of detail.atributos) {
          const campo: GCProductExtraField = 'atributo' in item ? item.atributo : item as any;
          const desc = (campo.descricao || '').toLowerCase().trim();
          if (desc.includes('localização física') || desc.includes('localizacao fisica')) {
            localizacao_fisica = campo.conteudo || '';
          } else if (desc.includes('localização rational') || desc.includes('localizacao rational')) {
            localizacao_rational = campo.conteudo || '';
          }
        }
      }
      // Fallback to campos_extras if present
      if (!localizacao_fisica && !localizacao_rational && detail.campos_extras && Array.isArray(detail.campos_extras)) {
        for (const campo of detail.campos_extras) {
          const desc = (campo.descricao || '').toLowerCase().trim();
          if (desc.includes('localização física') || desc.includes('localizacao fisica')) {
            localizacao_fisica = campo.conteudo || '';
          } else if (desc.includes('localização rational') || desc.includes('localizacao rational')) {
            localizacao_rational = campo.conteudo || '';
          }
        }
      }

      return {
        produto: {
          ...produto,
          codigo_produto: codigoProduto,
          codigo_barras: codigoBarras,
          localizacao_fisica: localizacao_fisica || undefined,
          localizacao_rational: localizacao_rational || undefined,
        },
      };
    });
  }
}

/** Fetch GC internal product codes (codigo_interno) for a list of product ids, respecting rate limits. */
export async function getProductInternalCodes(produtoIds: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(produtoIds.filter(Boolean).map(String))];
  const map: Record<string, string> = {};
  for (let i = 0; i < unique.length; i += 3) {
    const batch = unique.slice(i, i + 3);
    const results = await Promise.all(batch.map(async (id) => {
      const detail = await getProductDetail(id);
      return [id, String(detail?.codigo_interno || '').trim()] as const;
    }));
    for (const [id, code] of results) if (code) map[id] = code;
    if (i + 3 < unique.length) await new Promise(r => setTimeout(r, 1100));
  }
  return map;
}

export interface GCClienteDetail {
  id: string;
  codigo: string;
  nome: string;
  razaoSocial: string;
  cnpj: string;
  cnpjDigits: string;
}

/**
 * A API do Gestão Click não devolve o código sequencial do cadastro do cliente,
 * mas aceita filtrar por ele (`/api/clientes?codigo=N`). Como os códigos são
 * atribuídos em ordem de cadastro (ids crescentes), resolvemos o código por
 * busca binária sobre o intervalo de códigos, comparando o id retornado.
 */
const clienteCodigoCache = new Map<string, string>();

export async function findClienteCodigo(clienteId: string, maxCodigo = 5000): Promise<string> {
  const target = Number(String(clienteId || '').trim());
  if (!Number.isFinite(target) || target <= 0 || isUsingMock()) return '';
  const cacheKey = String(target);
  const cached = clienteCodigoCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const probe = async (codigo: number): Promise<any | null> => {
    try {
      const res = await apiRequest<{ data: any[] }>(`/api/clientes?codigo=${codigo}`);
      const rows = Array.isArray(res?.data) ? res.data : [];
      return rows[0] || null;
    } catch {
      return null;
    }
  };

  let lo = 1;
  let hi = maxCodigo;
  let found = '';
  let requests = 0;

  while (lo <= hi && requests < 40) {
    const mid = Math.floor((lo + hi) / 2);
    let cursor = mid;
    let rec: any = null;
    // códigos podem ter lacunas (cadastros excluídos): avança até achar um válido
    while (cursor <= hi && !rec && requests < 40) {
      rec = await probe(cursor);
      requests++;
      if (!rec) cursor++;
    }
    if (!rec) { hi = mid - 1; continue; }

    const id = Number(rec.id);
    if (id === target) { found = String(cursor); break; }
    if (id < target) lo = cursor + 1;
    else hi = mid - 1;
  }

  clienteCodigoCache.set(cacheKey, found);
  return found;
}

/** Fetch a GestãoClick client record (code, name, CNPJ) by id. */
export async function getClienteDetail(clienteId: string): Promise<GCClienteDetail | null> {
  const id = String(clienteId || '').trim();
  if (!id || isUsingMock()) return null;
  try {
    const res = await apiRequest<{ data: any }>(`/api/clientes/${id}`);
    const c = res?.data;
    if (!c) return null;
    const cnpj = String(c.cnpj || c.cpf || c.cpf_cnpj || '').trim();
    let codigo = String(c.codigo ?? c.codigo_interno ?? '').trim();
    if (!codigo) codigo = await findClienteCodigo(id);
    return {
      id: String(c.id ?? id),
      codigo,
      nome: String(c.nome ?? c.razao_social ?? ''),
      razaoSocial: String(c.razao_social ?? c.nome ?? ''),
      cnpj,
      cnpjDigits: cnpj.replace(/\D+/g, ''),
    };
  } catch {
    return null;
  }
}

