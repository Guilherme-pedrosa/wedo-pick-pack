import { supabase } from '@/integrations/supabase/client';
import { buildOSIndex, listOrcamentos, getStatusCompras } from './compras';
import { listVendas } from './gestaoclick';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface PedidoFinanceiro {
  data_vencimento: string;
  nome_forma_pagamento: string;
  nome_plano_conta: string;
  valor: number;
  observacao: string;
}

export interface PedidoItem {
  produto_id: string;
  nome_produto: string;
  quantidade: number;
  valor_custo: number;
  valor_total: number;
}

export interface PedidoCompra {
  id: string;
  codigo: string;
  fornecedor_id: string;
  nome_fornecedor: string;
  data_emissao: string;
  situacao_id: string;
  nome_situacao: string;
  numero_nfe: string;
  valor_produtos: number;
  valor_frete: number;
  valor_impostos: number;
  valor_total: number;
  /** ICMS/imposto a exibir conforme regra (só se houver NF-e amarrada) */
  icms: number;
  observacoes: string;
  produtos: PedidoItem[];
  financeiro: PedidoFinanceiro[];
}

export type VinculoTipo = 'os' | 'venda' | 'orcamento';

export interface VinculoDoc {
  tipo: VinculoTipo;
  codigo: string;
  nome_cliente: string;
  situacao: string;
  equipamento: string;
  qtd: number;
}

/** produto_id -> documentos pendentes que pedem aquela peça */
export type DemandIndex = Record<string, VinculoDoc[]>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDecimal(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  if (raw.includes(',') && raw.includes('.')) {
    return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
  }
  if (raw.includes(',')) return parseFloat(raw.replace(',', '.')) || 0;
  return parseFloat(raw) || 0;
}

function normalizeId(value: unknown): string {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const lowered = raw.toLowerCase();
  if (lowered === '0' || lowered === 'null' || lowered === 'undefined') return '';
  return raw;
}

function normalizeName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

/** Extrai "Valor Aproximado dos Tributos: R$ 7039.88 (...)" das observações */
function parseTributoFromObs(obs: string): number {
  if (!obs) return 0;
  const m = obs.match(/tributos?[^R$]*R\$\s*([\d.,]+)/i);
  if (!m) return 0;
  return parseDecimal(m[1]);
}

function unwrapCompra(row: any): any {
  return row?.Compra ?? row?.compra ?? row;
}

function extractEquipamento(doc: any): string {
  const equips = doc?.equipamentos;
  if (!Array.isArray(equips) || equips.length === 0) return '';
  const nomes = equips
    .map((w: any) => {
      const e = w?.equipamento ?? w;
      const nome = String(e?.equipamento ?? e?.nome ?? '').trim();
      const marca = String(e?.marca ?? '').trim();
      const modelo = String(e?.modelo ?? '').trim();
      return [nome, marca, modelo].filter(Boolean).join(' ');
    })
    .filter(Boolean);
  return nomes.join(' / ');
}

// ---------------------------------------------------------------------------
// Status considerados "finalizados / cancelados" (não devem entrar no vínculo)
// ---------------------------------------------------------------------------

const TERMINAL_STATUS_TOKENS = [
  'CANCEL',
  'FINALIZ',
  'CONCLU',
  'ENTREGUE',
  'FATURAD',
  'EXECUTAD',
  'BAIXAD',
  'RECUSAD',
  'PERDID',
  'DEVOLVID',
];

function isTerminalStatus(situacao: string): boolean {
  const n = normalizeName(situacao);
  return TERMINAL_STATUS_TOKENS.some((t) => n.includes(t));
}

// ---------------------------------------------------------------------------
// Busca dos pedidos de compra
// ---------------------------------------------------------------------------

async function fetchComprasPage(pagina: number, situacaoId?: string) {
  let path = `/api/compras?limite=100&pagina=${pagina}`;
  if (situacaoId) path += `&situacao_id=${situacaoId}`;
  const { data, error } = await supabase.functions.invoke('gc-proxy', {
    body: { path, method: 'GET' },
  });
  if (error) throw new Error(error.message || 'Erro de conexão');
  const resp = data as any;
  if (resp?._proxy?.ok === false) throw new Error('Falha ao consultar GestãoClick');
  return resp as { data: any[]; meta: { total_paginas: number } };
}

function mapPedido(row: any): PedidoCompra {
  const c = unwrapCompra(row);
  const numero_nfe = String(c?.numero_nfe ?? '').trim();
  const valor_impostos = parseDecimal(c?.valor_impostos);
  const observacoes = String(c?.observacoes ?? '');

  // Regra ICMS: só puxa imposto se houver NF-e amarrada.
  let icms = 0;
  if (numero_nfe) {
    icms = valor_impostos > 0 ? valor_impostos : parseTributoFromObs(observacoes);
  }

  const produtos: PedidoItem[] = (c?.produtos || []).map((w: any) => {
    const p = w?.produto ?? w;
    return {
      produto_id: normalizeId(p?.produto_id),
      nome_produto: String(p?.nome_produto ?? ''),
      quantidade: parseDecimal(p?.quantidade),
      valor_custo: parseDecimal(p?.valor_custo),
      valor_total: parseDecimal(p?.valor_total),
    };
  });

  const financeiro: PedidoFinanceiro[] = (c?.pagamentos || []).map((w: any) => {
    const p = w?.pagamento ?? w;
    return {
      data_vencimento: String(p?.data_vencimento ?? ''),
      nome_forma_pagamento: String(p?.nome_forma_pagamento ?? ''),
      nome_plano_conta: String(p?.nome_plano_conta ?? ''),
      valor: parseDecimal(p?.valor),
      observacao: String(p?.observacao ?? ''),
    };
  });

  return {
    id: normalizeId(c?.id),
    codigo: String(c?.codigo ?? ''),
    fornecedor_id: normalizeId(c?.fornecedor_id),
    nome_fornecedor: String(c?.nome_fornecedor ?? ''),
    data_emissao: String(c?.data_emissao ?? ''),
    situacao_id: normalizeId(c?.situacao_id),
    nome_situacao: String(c?.nome_situacao ?? ''),
    numero_nfe,
    valor_produtos: parseDecimal(c?.valor_produtos),
    valor_frete: parseDecimal(c?.valor_frete),
    valor_impostos,
    valor_total: parseDecimal(c?.valor_total),
    icms,
    observacoes,
    produtos,
    financeiro,
  };
}

let comprasCache: { rows: PedidoCompra[]; builtAt: number } | null = null;
const COMPRAS_TTL = 5 * 60 * 1000;

/**
 * Busca todos os pedidos de compra (paginado). Cache de 5 min.
 *
 * IMPORTANTE: o endpoint padrão `/api/compras` do GestãoClick NÃO retorna
 * os pedidos finalizados/cancelados. Por isso varremos UMA situação por vez
 * (situacao_id), garantindo que TODAS as situações venham — inclusive
 * "Finalizado (mercadoria chegou)" e "Cancelada".
 */
export async function fetchAllPedidos(
  onProgress?: (step: string, page: number, total: number) => void,
  forceReload = false,
): Promise<PedidoCompra[]> {
  if (!forceReload && comprasCache && Date.now() - comprasCache.builtAt < COMPRAS_TTL) {
    return comprasCache.rows;
  }

  const situacoes = await getStatusCompras();
  const sitIds = situacoes.map((s) => String(s.id)).filter(Boolean);

  const seen = new Set<string>();
  const rows: PedidoCompra[] = [];

  for (let s = 0; s < sitIds.length; s++) {
    const sid = sitIds[s];
    const nome = situacoes[s]?.nome ?? sid;
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      onProgress?.(`Buscando "${nome}" — página ${page}`, s + 1, sitIds.length);
      const res = await fetchComprasPage(page, sid);
      totalPages = Math.max(1, Number(res.meta?.total_paginas || 1));
      for (const item of res.data || []) {
        const p = mapPedido(item);
        if (!p.id || seen.has(p.id)) continue;
        seen.add(p.id);
        rows.push(p);
      }
      page++;
      if (page <= totalPages) await new Promise((r) => setTimeout(r, 350));
    }
  }

  comprasCache = { rows, builtAt: Date.now() };
  return rows;
}

export function clearPedidosCache() {
  comprasCache = null;
}

// ---------------------------------------------------------------------------
// Persistência no banco (cache incremental)
// ---------------------------------------------------------------------------

/** Hash estável (djb2) do conteúdo do pedido para detectar mudanças. */
function hashPedido(p: PedidoCompra): string {
  const str = JSON.stringify([
    p.codigo, p.fornecedor_id, p.nome_fornecedor, p.data_emissao,
    p.situacao_id, p.nome_situacao, p.numero_nfe, p.valor_produtos,
    p.valor_frete, p.valor_impostos, p.valor_total, p.icms, p.observacoes,
    p.produtos, p.financeiro,
  ]);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function pedidoToRow(p: PedidoCompra) {
  return {
    gc_id: p.id,
    codigo: p.codigo,
    fornecedor_id: p.fornecedor_id,
    nome_fornecedor: p.nome_fornecedor,
    data_emissao: p.data_emissao,
    situacao_id: p.situacao_id,
    nome_situacao: p.nome_situacao,
    numero_nfe: p.numero_nfe,
    valor_total: p.valor_total,
    icms: p.icms,
    payload: p as unknown as Record<string, unknown>,
    content_hash: hashPedido(p),
    updated_at: new Date().toISOString(),
  };
}

/** Carrega os pedidos já persistidos no banco (instantâneo, sem chamar o GC). */
export async function loadPedidosFromDB(): Promise<PedidoCompra[]> {
  const rows: PedidoCompra[] = [];
  const PAGE = 1000;
  let from = 0;
  // Paginação do PostgREST (limite padrão de 1000 linhas)
  for (;;) {
    const { data, error } = await supabase
      .from('pedidos_compra')
      .select('payload')
      .order('data_emissao', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data || [];
    for (const r of batch) {
      if (r.payload) rows.push(r.payload as unknown as PedidoCompra);
    }
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  comprasCache = { rows, builtAt: Date.now() };
  return rows;
}

export interface SyncResult {
  novos: number;
  atualizados: number;
  inalterados: number;
  total: number;
}

/**
 * Sincroniza os pedidos do GestãoClick com o banco.
 * - Insere apenas os pedidos novos.
 * - Atualiza apenas os que tiveram alguma informação alterada (hash diferente).
 *
 * Modo incremental (padrão): como o GC retorna os mais recentes primeiro,
 * a varredura para após algumas páginas sem nenhuma mudança.
 * Modo completo (full=true): varre todas as páginas.
 */
export async function syncPedidos(
  onProgress?: (step: string, page: number, total: number) => void,
  full = false,
): Promise<SyncResult> {
  // 1) Mapa de hashes já existentes no banco
  onProgress?.('Lendo pedidos já salvos…', 0, 1);
  const existing = new Map<string, string>();
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('pedidos_compra')
        .select('gc_id, content_hash')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const batch = data || [];
      for (const r of batch) existing.set(String(r.gc_id), String(r.content_hash));
      if (batch.length < PAGE) break;
      from += PAGE;
    }
  }

  // 2) Varre cada situação separadamente — o endpoint padrão do GC NÃO
  //    retorna pedidos finalizados/cancelados, então precisamos filtrar por
  //    situacao_id para capturar TODAS as situações.
  const situacoes = await getStatusCompras();
  const sitIds = situacoes.map((s) => String(s.id)).filter(Boolean);

  let novos = 0;
  let atualizados = 0;

  for (let s = 0; s < sitIds.length; s++) {
    const sid = sitIds[s];
    const nome = situacoes[s]?.nome ?? sid;
    let page = 1;
    let totalPages = 1;
    let emptyStreak = 0; // páginas consecutivas sem mudança nesta situação

    while (page <= totalPages) {
      onProgress?.(`Sincronizando "${nome}" — página ${page}`, s + 1, sitIds.length);
      const res = await fetchComprasPage(page, sid);
      totalPages = Math.max(1, Number(res.meta?.total_paginas || 1));

      const toUpsert: ReturnType<typeof pedidoToRow>[] = [];
      for (const item of res.data || []) {
        const p = mapPedido(item);
        if (!p.id) continue;
        const row = pedidoToRow(p);
        const prev = existing.get(p.id);
        if (prev === undefined) {
          novos++;
          existing.set(p.id, row.content_hash);
          toUpsert.push(row);
        } else if (prev !== row.content_hash) {
          atualizados++;
          existing.set(p.id, row.content_hash);
          toUpsert.push(row);
        }
      }

      if (toUpsert.length) {
        const { error } = await supabase
          .from('pedidos_compra')
          .upsert(toUpsert as any, { onConflict: 'gc_id' });
        if (error) throw new Error(error.message);
        emptyStreak = 0;
      } else {
        emptyStreak++;
      }

      // Modo incremental: para esta situação após 2 páginas seguidas sem mudança.
      if (!full && emptyStreak >= 2) break;

      page++;
      if (page <= totalPages) await new Promise((r) => setTimeout(r, 300));
    }
  }

  // Invalida o cache em memória para forçar releitura do banco
  comprasCache = null;

  return {
    novos,
    atualizados,
    inalterados: existing.size - atualizados,
    total: existing.size + novos,
  };
}

// ---------------------------------------------------------------------------
// Índice de demanda (vínculos por peça)
// ---------------------------------------------------------------------------

let demandCache: { index: DemandIndex; builtAt: number } | null = null;
const DEMAND_TTL = 5 * 60 * 1000;

function pushVinculo(index: DemandIndex, pid: string, doc: VinculoDoc) {
  if (!pid) return;
  if (!index[pid]) index[pid] = [];
  index[pid].push(doc);
}

/**
 * Constrói o índice de demanda: para cada produto_id, quais OS / vendas /
 * orçamentos pendentes (não executados / não cancelados) pedem aquela peça.
 *
 * Reaproveita o índice de OS existente (buildOSIndex) e varre vendas e
 * orçamentos uma única vez (com cache de 5 min).
 */
export async function buildDemandIndex(
  onProgress?: (step: string, page: number, total: number) => void,
  forceReload = false,
): Promise<DemandIndex> {
  if (!forceReload && demandCache && Date.now() - demandCache.builtAt < DEMAND_TTL) {
    return demandCache.index;
  }

  const index: DemandIndex = {};

  // --- OS: reaproveita índice/cache existente (reservedDemand keyed por produto) ---
  onProgress?.('Indexando OS pendentes…', 0, 1);
  try {
    const { reservedDemand } = await buildOSIndex((step, c, t) => onProgress?.(step, c, t));
    for (const [key, info] of Object.entries(reservedDemand)) {
      const pid = key.split('::')[0];
      for (const o of info.orcamentos) {
        pushVinculo(index, pid, {
          tipo: 'os',
          codigo: o.os_codigo,
          nome_cliente: o.nome_cliente,
          situacao: 'OS pendente',
          equipamento: '',
          qtd: o.qtd,
        });
      }
    }
  } catch (e) {
    console.warn('[RELATORIO] Falha ao indexar OS', e);
  }

  // --- Vendas pendentes (não executadas / não canceladas) ---
  {
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      onProgress?.(`Indexando vendas — página ${page}`, page, totalPages);
      const res = await listVendas(undefined, page);
      totalPages = Math.max(1, Number(res.meta?.total_paginas || 1));
      for (const v of res.data || []) {
        if (isTerminalStatus(v.nome_situacao)) continue;
        const equipamento = extractEquipamento(v as any);
        for (const w of v.produtos || []) {
          const p = (w as any)?.produto ?? w;
          const pid = normalizeId(p?.produto_id);
          if (!pid) continue;
          pushVinculo(index, pid, {
            tipo: 'venda',
            codigo: String(v.codigo ?? ''),
            nome_cliente: String(v.nome_cliente ?? ''),
            situacao: String(v.nome_situacao ?? ''),
            equipamento,
            qtd: parseDecimal(p?.quantidade),
          });
        }
      }
      page++;
      if (page <= totalPages) await new Promise((r) => setTimeout(r, 350));
    }
  }

  // --- Orçamentos pendentes (não convertidos em OS/venda e não cancelados) ---
  {
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      onProgress?.(`Indexando orçamentos — página ${page}`, page, totalPages);
      const res = await listOrcamentos(undefined, page);
      totalPages = Math.max(1, Number(res.meta?.total_paginas || 1));
      for (const o of res.data || []) {
        if (isTerminalStatus(o.nome_situacao)) continue;
        // Pula orçamentos já convertidos (flags de financeiro/estoque)
        const conv =
          /^(?!0$)\d+$|sim|true/i.test(String(o.situacao_financeiro ?? '')) ||
          /^(?!0$)\d+$|sim|true/i.test(String(o.situacao_estoque ?? ''));
        if (conv) continue;
        const equipamento = extractEquipamento(o as any);
        for (const w of o.produtos || []) {
          const p = (w as any)?.produto ?? w;
          const pid = normalizeId(p?.produto_id);
          if (!pid) continue;
          pushVinculo(index, pid, {
            tipo: 'orcamento',
            codigo: String(o.codigo ?? ''),
            nome_cliente: String(o.nome_cliente ?? ''),
            situacao: String(o.nome_situacao ?? ''),
            equipamento,
            qtd: parseDecimal(p?.quantidade),
          });
        }
      }
      page++;
      if (page <= totalPages) await new Promise((r) => setTimeout(r, 350));
    }
  }

  demandCache = { index, builtAt: Date.now() };
  return index;
}

export function clearDemandCache() {
  demandCache = null;
}

/** Anexa os vínculos (por produto_id) a cada item dos pedidos informados. */
export interface PedidoComVinculos extends PedidoCompra {
  itens: Array<PedidoItem & { vinculos: VinculoDoc[] }>;
}

export function attachVinculos(pedidos: PedidoCompra[], index: DemandIndex): PedidoComVinculos[] {
  return pedidos.map((p) => ({
    ...p,
    itens: p.produtos.map((item) => ({
      ...item,
      vinculos: index[item.produto_id] || [],
    })),
  }));
}
