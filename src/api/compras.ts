import {
  GCSituacao, GCMeta, GCOrcamento, GCProdutoDetalhe, GCFornecedor,
  GCOrdemCompra, GCSituacaoCompra,
  ComprasResult, OSIndex,
} from './types';
import {
  MOCK_STATUS_ORCAMENTO, MOCK_ORCAMENTOS, MOCK_PRODUTOS_DETALHE, MOCK_FORNECEDORES,
  MOCK_STATUS_COMPRA, MOCK_ORDENS_COMPRA,
} from './mockData';
import { scopeSituationCatalog } from './situationScopes';
import { supabase } from '@/integrations/supabase/client';
import { getActivePartialDemand } from './partialWriteoff';
import { scanPurchases } from '../../supabase/functions/_shared/purchaseScan';
import { readPartialPurchaseOperations } from '../../supabase/functions/_shared/partialPurchaseOperations';
import { pendingOsLines } from './osStockCommitments';

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

function isUsingMock(): boolean {
  return !SUPABASE_PROJECT_ID;
}

async function apiRequest<T>(path: string, options?: { method?: string; body?: string }): Promise<T> {
  const method = options?.method || 'GET';
  const { data, error } = await supabase.functions.invoke('gc-proxy', {
    body: { path, method, payload: options?.body ? JSON.parse(options.body) : undefined },
  });
  if (error) throw new Error(error.message || 'Erro de conexão com o servidor');
  const response = data as any;
  const proxyMeta = response?._proxy;
  const gcOk = proxyMeta?.ok;
  const gcHttpStatus = proxyMeta?.gc_http_status;
  const gcBodyStatus = response?.status;
  const gcBodyCode = response?.code;
  if (gcOk === false || gcBodyStatus === 'error' || (gcBodyCode && gcBodyCode >= 400)) {
    const gcMsg = response?.data?.mensagem || response?.data?.erro || response?.error || '';
    const statusCode = gcHttpStatus || gcBodyCode || 0;
    if (statusCode === 429) throw new Error('RATE_LIMIT');
    if (statusCode === 401 || statusCode === 403) throw new Error('AUTH_ERROR');
    throw new Error(gcMsg || `Erro ${statusCode} no GestãoClick`);
  }
  return response as T;
}

const mockDelay = () => new Promise(r => setTimeout(r, 300));

function parseDecimal(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;

  // pt-BR: 1.234,56 -> 1234.56
  if (raw.includes(',') && raw.includes('.')) {
    return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
  }

  // pt-BR: 123,45 -> 123.45
  if (raw.includes(',')) {
    return parseFloat(raw.replace(',', '.')) || 0;
  }

  // en-US / plain: 1234.56
  return parseFloat(raw) || 0;
}

// --- REVERSE OS INDEX ---
// Scans all OS records and maps orçamento codes found in OS atributos → OS info
// Cached in memory with 5min TTL

export interface OSReservedDemand {
  /** product key (pid or pid::vid) -> total qty reserved by pending OSs */
  [key: string]: { qty: number; orcamentos: Array<{ os_codigo: string; nome_cliente: string; qtd: number }> };
}

let osIndexCache: { index: OSIndex; builtAt: number; totalVinculos: number; reservedDemand: OSReservedDemand } | null = null;
const OS_INDEX_TTL = 5 * 60 * 1000; // 5 minutes

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function unwrapOSRecord(rawItem: any): any {
  return rawItem?.OrdemServico ?? rawItem?.ordem_servico ?? rawItem?.ordemServico ?? rawItem;
}

function resolveOSCode(osRecord: any): string {
  const candidates = [
    osRecord?.codigo,
    osRecord?.numero,
    osRecord?.os_codigo,
    osRecord?.numero_os,
    osRecord?.id,
  ];

  for (const value of candidates) {
    const normalized = normalizeId(value);
    if (normalized) return normalized;
  }

  return '';
}

export async function buildOSIndex(
  onProgress?: (step: string, checked: number, total: number) => void,
  forceRebuild = true,
): Promise<{ index: OSIndex; totalVinculos: number; builtAt: number; reservedDemand: OSReservedDemand }> {
  // Return cache if still valid
  if (!forceRebuild && osIndexCache && (Date.now() - osIndexCache.builtAt < OS_INDEX_TTL)) {
    return osIndexCache;
  }

  const index: OSIndex = {};
  const reservedDemand: OSReservedDemand = {};
  const { auxiliaryDocumentIds } = await getActivePartialDemand();
  let page = 1;
  let totalPages = 1;
  let vinculos = 0;

  onProgress?.('Indexando OS… página 1', 0, 1);

  while (page <= totalPages) {
    const res = await apiRequest<{ data: any[]; meta: GCMeta }>(`/api/ordens_servicos?limite=100&pagina=${page}`);
    totalPages = res.meta.total_paginas;

    for (const item of res.data || []) {
      const os = unwrapOSRecord(item);
      const osCodigo = resolveOSCode(os);
      const osId = normalizeId(os?.id);
      if (osId && auxiliaryDocumentIds.has(`os:${osId}`)) continue;
      const osRef = osCodigo || osId || '—';
      const nomeSituacao = String(os?.nome_situacao ?? '');
      const nomeCliente = String(os?.nome_cliente ?? '');

      // Collect budget-to-OS links from atributos
      for (const wrapper of os?.atributos || []) {
        const atributo = wrapper?.atributo;
        if (!atributo) continue;

        const desc = normalizeForMatch(String(atributo.descricao ?? ''));
        if (!desc) continue;

        const isOrcRef = desc.includes('ORCAMENTO') || desc.includes('NUMERO ORC');
        if (!isOrcRef) continue;

        const conteudo = String(atributo.conteudo ?? '').trim();
        if (!conteudo || !/^\d+$/.test(conteudo)) continue;

        index[conteudo] = { os_codigo: osRef, os_id: osId, nome_situacao: nomeSituacao, nome_cliente: nomeCliente };
        vinculos++;
      }

      for (const line of pendingOsLines(os)) {
        const key = line.variationId ? `${line.productId}::${line.variationId}` : line.productId;
        if (!reservedDemand[key]) reservedDemand[key] = { qty: 0, orcamentos: [] };
        reservedDemand[key].qty += line.quantity;
        reservedDemand[key].orcamentos.push({ os_codigo: line.code, nome_cliente: line.client, qtd: line.quantity });
      }
    }

    onProgress?.(`Indexando OS… página ${page} de ${totalPages} (${vinculos} vínculos)`, page, totalPages);
    page++;
    if (page <= totalPages && !isUsingMock()) await new Promise(r => setTimeout(r, 350));
  }

  const reservedKeys = Object.keys(reservedDemand).length;
  osIndexCache = { index, builtAt: Date.now(), totalVinculos: vinculos, reservedDemand };
  console.log(`[COMPRAS] OS Index built: ${vinculos} vínculos, ${reservedKeys} produtos reservados por OS pendentes`);
  return osIndexCache;
}

export function getOSIndexStatus(): { totalVinculos: number; builtAt: number; isExpired: boolean } | null {
  if (!osIndexCache) return null;
  return {
    totalVinculos: osIndexCache.totalVinculos,
    builtAt: osIndexCache.builtAt,
    isExpired: Date.now() - osIndexCache.builtAt >= OS_INDEX_TTL,
  };
}

export function clearOSIndexCache() {
  osIndexCache = null;
}


function normalizeId(value: string | number | null | undefined): string {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const lowered = raw.toLowerCase();
  if (lowered === '0' || lowered === 'null' || lowered === 'undefined') return '';
  return raw;
}

function makeProdutoKey(produtoId: string | number | null | undefined, variacaoId: string | number | null | undefined): string {
  const pid = normalizeId(produtoId);
  const vid = normalizeId(variacaoId);
  return vid ? `${pid}::${vid}` : pid;
}

// --- STATUS ORCAMENTOS ---
export async function getStatusOrcamentos(): Promise<GCSituacao[]> {
  if (isUsingMock()) { await mockDelay(); return [...MOCK_STATUS_ORCAMENTO]; }
  const res = await apiRequest<{ data: GCSituacao[] }>('/api/situacoes_orcamentos');
  return scopeSituationCatalog(res.data, 'orcamento');
}

// --- LIST ORCAMENTOS ---
export async function listOrcamentos(situacaoId?: string, pagina = 1, nomeCliente?: string, kind?: 'produto' | 'servico'): Promise<{ data: GCOrcamento[]; meta: GCMeta }> {
  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_ORCAMENTOS];
    if (kind) data = data.filter(o => (o.budget_kind || 'servico') === kind).map(o => ({ ...o, budget_kind: kind }));
    if (situacaoId) data = data.filter(o => o.situacao_id === situacaoId);
    if (nomeCliente) {
      const q = nomeCliente.toLowerCase();
      data = data.filter(o => o.nome_cliente.toLowerCase().includes(q));
    }
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }
  const collection = kind === 'produto' ? 'orcamentos_produtos' : kind === 'servico' ? 'orcamentos_servicos' : 'orcamentos';
  let path = `/api/${collection}?pagina=${pagina}`;
  if (situacaoId) path += `&situacao_id=${situacaoId}`;
  if (nomeCliente) path += `&nome=${encodeURIComponent(nomeCliente)}`;
  const response = await apiRequest<{ data: GCOrcamento[]; meta: GCMeta }>(path);
  return kind ? { ...response, data: (response.data || []).map(o => ({ ...o, budget_kind: kind })) } : response;
}

// --- PRODUTO DETALHE ---
export async function getProdutoDetalhe(produtoId: string): Promise<GCProdutoDetalhe | null> {
  if (isUsingMock()) { await mockDelay(); return MOCK_PRODUTOS_DETALHE[produtoId] ?? null; }
  try {
    const res = await apiRequest<{ data: any }>(`/api/produtos/${produtoId}`);
    const raw = res?.data?.Produto ?? res?.data?.produto ?? res?.data;
    if (!raw || typeof raw !== 'object') return null;

    return {
      ...raw,
      nome_grupo: String(
        raw?.nome_grupo ??
        raw?.grupo_nome ??
        raw?.grupo?.nome ??
        raw?.categoria?.nome ??
        ''
      ).trim() || undefined,
    } as GCProdutoDetalhe;
  } catch {
    return null;
  }
}

// --- FORNECEDOR ---
export async function getFornecedor(fornecedorId: string): Promise<GCFornecedor | null> {
  if (isUsingMock()) { await mockDelay(); return MOCK_FORNECEDORES[fornecedorId] ?? null; }
  try {
    const res = await apiRequest<{ data: GCFornecedor }>(`/api/fornecedores/${fornecedorId}`);
    return res.data;
  } catch { return null; }
}

let statusComprasFallbackCache: GCSituacaoCompra[] | null = null;

function unwrapCompraRecord(row: any): any {
  return row?.Compra ?? row?.compra ?? row;
}

async function deriveStatusComprasFromPedidos(): Promise<GCSituacaoCompra[]> {
  if (statusComprasFallbackCache) return statusComprasFallbackCache;

  const byId = new Map<string, GCSituacaoCompra>();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const res = await apiRequest<{ data: any[]; meta: GCMeta }>(`/api/compras?limite=100&pagina=${page}`);
    totalPages = Math.max(1, Number(res.meta?.total_paginas || 1));

    for (const row of res.data || []) {
      const compra = unwrapCompraRecord(row);
      const id = normalizeId(compra?.situacao_id);
      const nome = String(compra?.nome_situacao ?? '').trim();
      if (!id || !nome || byId.has(id)) continue;
      byId.set(id, { id, nome, padrao: '0', tipo_lancamento: '' });
    }

    page++;
    if (page <= totalPages && !isUsingMock()) await new Promise(r => setTimeout(r, 250));
  }

  statusComprasFallbackCache = [...byId.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return statusComprasFallbackCache;
}

// --- STATUS COMPRAS ---
export async function getStatusCompras(): Promise<GCSituacaoCompra[]> {
  if (isUsingMock()) { await mockDelay(); return [...MOCK_STATUS_COMPRA]; }
  try {
    // GC pagina esse endpoint: percorre todas as páginas para não perder situações
    const byId = new Map<string, GCSituacaoCompra>();
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const res = await apiRequest<{ data: any[]; meta?: GCMeta }>(
        `/api/situacoes_compras?limite=100&pagina=${page}`,
      );
      totalPages = Math.max(1, Number(res.meta?.total_paginas || 1));

      for (const row of res.data || []) {
        const s = row?.Situacao ?? row?.situacao ?? row;
        const id = normalizeId(s?.id);
        const nome = String(s?.nome ?? '').trim();
        if (!id || !nome || byId.has(id)) continue;
        byId.set(id, {
          id,
          nome,
          padrao: String(s?.padrao ?? '0'),
          tipo_lancamento: String(s?.tipo_lancamento ?? ''),
        });
      }

      page++;
      if (page <= totalPages && !isUsingMock()) await new Promise(r => setTimeout(r, 250));
    }

    if (byId.size === 0) return deriveStatusComprasFromPedidos();
    return [...byId.values()];
  } catch (error) {
    console.warn('[COMPRAS] Falha no endpoint de situações; derivando pelos pedidos de compra.', error);
    return deriveStatusComprasFromPedidos();
  }
}


// --- LIST ORDENS COMPRA ---
export async function listOrdensCompra(situacaoId?: string, pagina = 1, extraQuery = ''): Promise<{ data: GCOrdemCompra[]; meta: GCMeta }> {
  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_ORDENS_COMPRA];
    if (situacaoId) data = data.filter(c => c.situacao_id === situacaoId);
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }

  let path = `/api/compras?limite=100&pagina=${pagina}`;
  if (situacaoId) path += `&situacao_id=${situacaoId}`;
  if (extraQuery) path += `&${extraQuery.replace(/^&/, '')}`;

  const raw = await apiRequest<{ data: any[]; meta: GCMeta }>(path);

  const data: GCOrdemCompra[] = (raw.data || []).map((row: any) => {
    const compra = unwrapCompraRecord(row);
    // "DATA DA CHEGADA DAS PEÇAS" vindo dos campos extras
    let previsaoChegada = '';
    for (const w of compra?.campos_extras || []) {
      const e = w?.extras ?? w;
      const desc = String(e?.descricao ?? '').toUpperCase();
      if (desc.includes('CHEGADA') && desc.includes('PE')) {
        const v = String(e?.conteudo ?? '').trim();
        if (v) { previsaoChegada = v; break; }
      }
    }
    return {
      id: String(compra?.id ?? ''),
      codigo: String(compra?.codigo ?? ''),
      fornecedor_id: String(compra?.fornecedor_id ?? ''),
      nome_fornecedor: String(compra?.nome_fornecedor ?? ''),
      data_emissao: String(compra?.data_emissao ?? ''),
      situacao_id: String(compra?.situacao_id ?? ''),
      nome_situacao: String(compra?.nome_situacao ?? ''),
      previsao_chegada: previsaoChegada,
      valor_total: String(compra?.valor_total ?? '0'),

      produtos: (compra?.produtos || []).map((p: any) => {
        const produto = p?.produto ?? p;
        return {
          produto: {
            id: String(produto?.id ?? ''),
            produto_id: String(produto?.produto_id ?? produto?.id_produto ?? ''),
            variacao_id: String(produto?.variacao_id ?? produto?.estoque_id ?? ''),
            nome_produto: String(produto?.nome_produto ?? produto?.nome ?? produto?.descricao ?? ''),
            codigo_produto: String(produto?.codigo_produto ?? produto?.codigo_interno ?? produto?.codigo ?? ''),
            codigo_barras: String(produto?.codigo_barras ?? produto?.codigo_barra ?? ''),
            codigo_barra: String(produto?.codigo_barra ?? produto?.codigo_barras ?? ''),
            quantidade: produto?.quantidade ?? '0',
            valor_custo: String(produto?.valor_custo ?? produto?.valor_unitario ?? produto?.valor ?? '0'),
          },
        };
      }),
    };
  });

  return { data, meta: raw.meta };
}

// --- MAIN ENGINE: compartilhado com a varredura automática ---
export async function buildListaCompras(
  situacaoOrcIds: string[],
  situacaoCompraIds: string[],
  onProgress?: (step: string, checked: number, total: number) => void,
): Promise<ComprasResult> {
  return scanPurchases({
    gc: path => apiRequest(path),
    partials: () => readPartialPurchaseOperations(supabase),
    progress: onProgress,
  }, situacaoOrcIds, situacaoCompraIds);
}
