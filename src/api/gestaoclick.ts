import { GCOrdemServico, GCVenda, GCSituacao, GCMeta, GCProdutoItem, GCOrdemCompra } from './types';
import { listOrdensCompra } from './compras';
import { MOCK_OS, MOCK_VENDAS, MOCK_STATUS_OS, MOCK_STATUS_VENDA } from './mockData';
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
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), GC_PROXY_TIMEOUT_MS);
      });

      const invokePromise = supabase.functions.invoke('gc-proxy', {
        body: { path, method, payload },
      });

      const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

      if (error) {
        const msg = error.message || 'Erro de conexão com o servidor';
        if (msg.includes('Failed to fetch')) throw new Error('NETWORK_ERROR');
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
      const message = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      const retryable = isGet && (message === 'REQUEST_TIMEOUT' || message === 'NETWORK_ERROR' || message === 'RATE_LIMIT');

      if (retryable && attempt < maxAttempts - 1) {
        const waitMs = 900 * (attempt + 1) + Math.floor(Math.random() * 200);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (message === 'REQUEST_TIMEOUT') throw new Error('TIMEOUT');
      throw err instanceof Error ? err : new Error('Erro de conexão com o servidor');
    }
  }

  throw new Error('Erro de conexão com o servidor');
}

const mockDelay = () => new Promise(r => setTimeout(r, 300));

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function normalizeStatusId(value: unknown): string {
  return String(value ?? '').trim();
}

async function confirmStatusApplied(tipo: 'os' | 'venda', id: string, expectedStatusId: string): Promise<boolean> {
  const path = tipo === 'os' ? `/api/ordens_servicos/${id}` : `/api/vendas/${id}`;
  const expected = normalizeStatusId(expectedStatusId);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await apiRequest<{ data?: { situacao_id?: string | number } }>(path);
      const current = normalizeStatusId(res?.data?.situacao_id);
      if (current === expected) return true;
    } catch {
      // ignore transient read errors and retry
    }

    if (attempt < 2) await wait(900);
  }

  return false;
}

// --- LIST ---
export async function listOS(situacaoId?: string, pagina = 1, pesquisa?: string): Promise<{ data: GCOrdemServico[]; meta: GCMeta }> {
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

  const params = new URLSearchParams({ pagina: String(pagina) });
  if (situacaoId) params.set('situacao_id', situacaoId);

  // Mantém a fila com os códigos mais novos no topo (ex.: OS 9090)
  params.set('ordenacao', 'codigo');
  params.set('direcao', 'desc');

  if (term) {
    if (/^\d+$/.test(term)) {
      params.set('codigo', term);
    } else {
      params.set('nome', term);
    }
    params.set('limite', '100');
  }

  return apiRequest<{ data: GCOrdemServico[]; meta: GCMeta }>(`/api/ordens_servicos?${params.toString()}`);
}

/** Fetch OS for multiple situacao_ids in parallel, merging & deduplicating results */
export async function listOSMultiStatus(situacaoIds: string[], pesquisa?: string): Promise<{ data: GCOrdemServico[]; meta: GCMeta }> {
  if (situacaoIds.length === 0) return listOS(undefined, 1, pesquisa);
  if (situacaoIds.length === 1) return listOS(situacaoIds[0], 1, pesquisa);

  const results = await Promise.all(
    situacaoIds.map(sid => listOS(sid, 1, pesquisa).catch(() => ({ data: [] as GCOrdemServico[], meta: { pagina_atual: 1, total_paginas: 1, total_registros: 0 } })))
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
    } else {
      params.set('nome', term);
    }
    params.set('limite', '100');
  }

  return apiRequest<{ data: GCVenda[]; meta: GCMeta }>(`/api/vendas?${params.toString()}`);
}

/** Fetch Vendas for multiple situacao_ids in parallel, merging & deduplicating results */
export async function listVendasMultiStatus(situacaoIds: string[], pesquisa?: string): Promise<{ data: GCVenda[]; meta: GCMeta }> {
  if (situacaoIds.length === 0) return listVendas(undefined, 1, pesquisa);
  if (situacaoIds.length === 1) return listVendas(situacaoIds[0], 1, pesquisa);

  const results = await Promise.all(
    situacaoIds.map(sid => listVendas(sid, 1, pesquisa).catch(() => ({ data: [] as GCVenda[], meta: { pagina_atual: 1, total_paginas: 1, total_registros: 0 } })))
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
  return res.data;
}

export async function getStatusVendas(): Promise<GCSituacao[]> {
  if (isUsingMock()) {
    await mockDelay();
    return [...MOCK_STATUS_VENDA];
  }
  const res = await apiRequest<{ data: GCSituacao[] }>('/api/situacoes_vendas');
  return res.data;
}

// --- UPDATE STATUS ---
export async function updateOSStatus(id: string, rawOrder: GCOrdemServico, newStatusId: string, operatorName?: string, gcUsuarioId?: string): Promise<void> {
  if (isUsingMock()) {
    await mockDelay();
    return;
  }
  const obsInterna = rawOrder.observacoes_interna || '';
  const separator = obsInterna.trim() ? '\n' : '';
  const now = new Date().toLocaleString('pt-BR');
  const operatorNote = operatorName
    ? `${separator}[WeDo Checkout] Separação realizada por: ${operatorName} em ${now}`
    : '';

  const obs = rawOrder.observacoes || '';
  const obsSeparator = obs.trim() ? '\n' : '';
  const obsNote = operatorName
    ? `${obsSeparator}[WeDo Checkout] Separação por: ${operatorName} em ${now}`
    : '';

  const payload: Record<string, any> = {
    cliente_id: rawOrder.cliente_id,
    codigo: rawOrder.codigo,
    data: rawOrder.data_entrada || rawOrder.data,
    situacao_id: newStatusId,
    vendedor_id: rawOrder.vendedor_id,
    observacoes: obs + obsNote,
    observacoes_interna: obsInterna + operatorNote,
    valor_total: rawOrder.valor_total,
    valor_frete: rawOrder.valor_frete || '0.00',
    condicao_pagamento: rawOrder.condicao_pagamento || 'a_vista',
    produtos: rawOrder.produtos,
    servicos: rawOrder.servicos || [],
    atributos: rawOrder.atributos || [],
    equipamentos: rawOrder.equipamentos || [],
  };

  // Preserve pagamentos to avoid total vs parcelas mismatch (e.g. when discounts are applied)
  if (rawOrder.pagamentos?.length) payload.pagamentos = rawOrder.pagamentos;

  if (gcUsuarioId) payload.usuario_id = gcUsuarioId;

  const putResponse = await apiRequest<{ data?: { situacao_id?: string | number }; situacao_id?: string | number }>(
    `/api/ordens_servicos/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    }
  );

  const expectedStatus = normalizeStatusId(newStatusId);
  const returnedStatus = normalizeStatusId(putResponse?.data?.situacao_id ?? putResponse?.situacao_id);

  if (returnedStatus && returnedStatus !== expectedStatus) {
    throw new Error('STATUS_NOT_APPLIED');
  }

  const confirmed = await confirmStatusApplied('os', id, expectedStatus);
  if (!confirmed) {
    throw new Error('STATUS_NOT_APPLIED');
  }
}

export async function updateVendaStatus(id: string, rawOrder: GCVenda, newStatusId: string, operatorName?: string, gcUsuarioId?: string): Promise<void> {
  if (isUsingMock()) {
    await mockDelay();
    return;
  }
  const obsInterna = (rawOrder as any).observacoes_interna || '';
  const separator = obsInterna.trim() ? '\n' : '';
  const now = new Date().toLocaleString('pt-BR');
  const operatorNote = operatorName
    ? `${separator}[WeDo Checkout] Separação realizada por: ${operatorName} em ${now}`
    : '';

  const obs = (rawOrder as any).observacoes || '';
  const obsSeparator = obs.trim() ? '\n' : '';
  const obsNote = operatorName
    ? `${obsSeparator}[WeDo Checkout] Separação por: ${operatorName} em ${now}`
    : '';

  const payload: Record<string, any> = {
    tipo: (rawOrder as any).tipo || 'produto',
    cliente_id: rawOrder.cliente_id,
    codigo: rawOrder.codigo,
    data: rawOrder.data,
    situacao_id: newStatusId,
    vendedor_id: rawOrder.vendedor_id,
    observacoes: obs + obsNote,
    observacoes_interna: obsInterna + operatorNote,
    valor_total: rawOrder.valor_total,
    valor_frete: rawOrder.valor_frete || '0.00',
    condicao_pagamento: rawOrder.condicao_pagamento || 'a_vista',
    produtos: rawOrder.produtos,
    servicos: rawOrder.servicos || [],
  };

  // Preserve pagamentos to avoid total vs parcelas mismatch (e.g. when discounts are applied)
  if (rawOrder.pagamentos?.length) payload.pagamentos = rawOrder.pagamentos;

  if (gcUsuarioId) payload.usuario_id = gcUsuarioId;

  const putResponse = await apiRequest<{ data?: { situacao_id?: string | number }; situacao_id?: string | number }>(
    `/api/vendas/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    }
  );

  const expectedStatus = normalizeStatusId(newStatusId);
  const returnedStatus = normalizeStatusId(putResponse?.data?.situacao_id ?? putResponse?.situacao_id);

  if (returnedStatus && returnedStatus !== expectedStatus) {
    throw new Error('STATUS_NOT_APPLIED');
  }

  const confirmed = await confirmStatusApplied('venda', id, expectedStatus);
  if (!confirmed) {
    throw new Error('STATUS_NOT_APPLIED');
  }
}

// --- STOCK CHECK ---
export interface ProductStockInfo {
  produto_id: string;
  estoque: number;
}

export interface StockConflictPO {
  codigo: string;
  nome_fornecedor: string;
  qtd: number;
  situacao: string;
}

export interface StockConflict {
  nome_produto: string;
  produto_id: string;
  estoque: number;
  demanda_total: number;
  pedidos: Array<{ codigo: string; nome_cliente: string; qtd: number }>;
  pedidos_compra: StockConflictPO[];
}

export interface StockScanResult {
  fullStockOrders: Set<string>;
  conflicts: StockConflict[];
}

export async function getProductStock(produtoId: string): Promise<ProductStockInfo | null> {
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 15000));
    const request = apiRequest<{ data: { id: string; estoque: string | number } }>(`/api/produtos/${produtoId}`);
    const res = await Promise.race([request, timeout]);
    const estoque = typeof res.data.estoque === 'number' ? res.data.estoque : parseFloat(res.data.estoque || '0');
    return { produto_id: res.data.id, estoque: isNaN(estoque) ? 0 : estoque };
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
  // Collect all unique produto_ids across all orders
  const productOrderMap = new Map<string, { orderId: string; orderCodigo: string; orderCliente: string; qty: number; nome: string }[]>();
  
  for (const order of orders) {
    for (const p of order.produtos || []) {
      const pid = p.produto.produto_id;
      const qty = typeof p.produto.quantidade === 'number' ? p.produto.quantidade : parseFloat(String(p.produto.quantidade)) || 0;
      if (!productOrderMap.has(pid)) productOrderMap.set(pid, []);
      productOrderMap.get(pid)!.push({
        orderId: order.id,
        orderCodigo: order.codigo,
        orderCliente: order.nome_cliente,
        qty,
        nome: p.produto.nome_produto,
      });
    }
  }

  const uniqueIds = [...productOrderMap.keys()];
  const stockMap = new Map<string, number>();
  const total = uniqueIds.length;
  let checked = 0;

  // Fetch 3 at a time (rate limit)
  for (let i = 0; i < uniqueIds.length; i += 3) {
    const batch = uniqueIds.slice(i, i + 3);
    const results = await Promise.all(batch.map(id => getProductStock(id)));
    for (const r of results) {
      if (r) stockMap.set(r.produto_id, r.estoque);
    }
    checked += batch.length;
    onProgress?.(checked, total);
    if (i + 3 < uniqueIds.length) {
      await new Promise(r => setTimeout(r, 1100)); // respect rate limit
    }
  }

  // Determine which orders have full stock
  const fullStockOrders = new Set<string>();
  for (const order of orders) {
    const allInStock = (order.produtos || []).every(p => {
      const pid = p.produto.produto_id;
      const qty = typeof p.produto.quantidade === 'number' ? p.produto.quantidade : parseFloat(String(p.produto.quantidade)) || 0;
      const available = stockMap.get(pid) ?? 0;
      return available >= qty;
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
        produto_id: pid,
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
          for (const p of po.produtos || []) {
            const pid = p.produto.produto_id;
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
        c.pedidos_compra = poMap.get(c.produto_id) || [];
      }
    } catch (e) {
      console.warn('[STOCK SCAN] Failed to fetch purchase orders for conflicts:', e);
    }
  }

  return { fullStockOrders, conflicts };
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

async function getProductDetail(produtoId: string): Promise<GCProductDetail | null> {
  try {
    const res = await apiRequest<{ data: GCProductDetail }>(`/api/produtos/${produtoId}`);
    return res.data;
  } catch {
    return null;
  }
}

export async function enrichOrderProducts(
  produtos: Array<{ produto: GCProdutoItem }>
): Promise<Array<{ produto: GCProdutoItem }>> {
  if (isUsingMock() || !produtos?.length) return produtos;

  // Deduplicate produto_ids
  const uniqueIds = [...new Set(produtos.map(p => p.produto.produto_id))];
  
  // Fetch product details in batches of 3 (respect API rate limit of 3 req/s)
  const detailMap = new Map<string, GCProductDetail>();
  for (let i = 0; i < uniqueIds.length; i += 3) {
    const batch = uniqueIds.slice(i, i + 3);
    const results = await Promise.all(batch.map(id => getProductDetail(id)));
    results.forEach(d => { if (d) detailMap.set(d.id, d); });
    if (i + 3 < uniqueIds.length) {
      await new Promise(r => setTimeout(r, 1100)); // respect rate limit
    }
  }

  return produtos.map(({ produto }) => {
    const detail = detailMap.get(produto.produto_id);
    if (!detail) return { produto };

    // Find variation code if applicable
    let codigoBarras = detail.codigo_barra || '';
    const codigoProduto = detail.codigo_interno || '';

    if (produto.variacao_id && detail.variacoes) {
      const variacao = detail.variacoes.find(v => v.variacao.id === produto.variacao_id);
      if (variacao?.variacao.codigo) {
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
