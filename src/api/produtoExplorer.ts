import { supabase } from '@/integrations/supabase/client';
import { listOrcamentos, listOrdensCompra, getProdutoDetalhe } from './compras';
import { listOS, listVendas } from './gestaoclick';
import { GCMeta, GCOrcamento, GCOrdemCompra, GCOrdemServico, GCProdutoDetalhe, GCVenda } from './types';
import { getExplorerConfig } from '@/lib/explorerConfig';

// ------------ utils ------------
function normId(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s || s === '0' || s.toLowerCase() === 'null') return '';
  return s;
}

function parseDec(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  if (s.includes(',')) return parseFloat(s.replace(',', '.')) || 0;
  return parseFloat(s) || 0;
}

// ------------ types ------------
export interface ExplorerOSRef {
  id: string;
  codigo: string;
  nome_cliente: string;
  situacao_id: string;
  nome_situacao: string;
  data: string;
  qtd: number;
}
export interface ExplorerOrcRef {
  id: string;
  codigo: string;
  nome_cliente: string;
  situacao_id: string;
  nome_situacao: string;
  data: string;
  qtd: number;
}
export interface ExplorerCompraRef {
  id: string;
  codigo: string;
  nome_fornecedor: string;
  situacao_id: string;
  nome_situacao: string;
  data: string;
  qtd: number;
}
export interface ExplorerVendaRef {
  id: string;
  codigo: string;
  nome_cliente: string;
  situacao_id: string;
  nome_situacao: string;
  data: string;
  qtd: number;
}

export interface ProductExplorerData {
  produto_id: string;
  estoque: number;
  detalhe: GCProdutoDetalhe | null;
  oss: ExplorerOSRef[];
  orcamentos: ExplorerOrcRef[];
  compras: ExplorerCompraRef[];
  vendas: ExplorerVendaRef[];
  qtd_demanda_os: number;
  qtd_demanda_orcamentos: number;
  qtd_demanda_vendas: number;
  qtd_em_compra: number;
  saldo_projetado: number; // estoque + compras - demandas
  health: 'ok' | 'warn' | 'critical';
}

interface ExplorerIndex {
  builtAt: number;
  oss: Map<string, ExplorerOSRef[]>;
  orcamentos: Map<string, ExplorerOrcRef[]>;
  compras: Map<string, ExplorerCompraRef[]>;
  vendas: Map<string, ExplorerVendaRef[]>;
}

const TTL = 5 * 60 * 1000;
let cache: ExplorerIndex | null = null;
let building: Promise<ExplorerIndex> | null = null;

async function paginate<T>(
  fetcher: (page: number) => Promise<{ data: T[]; meta: GCMeta }>,
  onProgress?: (label: string, page: number, total: number) => void,
  label = 'Carregando',
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await fetcher(page);
    out.push(...(res.data || []));
    totalPages = res.meta?.total_paginas ?? 1;
    onProgress?.(label, page, totalPages);
    page++;
    if (page <= totalPages) await new Promise(r => setTimeout(r, 350));
  } while (page <= totalPages);
  return out;
}

export async function buildExplorerIndex(
  onProgress?: (step: string, page: number, total: number) => void,
  force = false,
): Promise<ExplorerIndex> {
  if (!force && cache && Date.now() - cache.builtAt < TTL) return cache;
  if (building) return building;

  building = (async () => {
    const oss = new Map<string, ExplorerOSRef[]>();
    const orcamentos = new Map<string, ExplorerOrcRef[]>();
    const compras = new Map<string, ExplorerCompraRef[]>();
    const vendas = new Map<string, ExplorerVendaRef[]>();

    // OS
    const osList = await paginate<GCOrdemServico>(
      (p) => listOS(undefined, p),
      onProgress,
      'Indexando OS',
    );
    for (const os of osList) {
      const ref = {
        id: String(os.id),
        codigo: String(os.codigo ?? os.id),
        nome_cliente: String(os.nome_cliente ?? ''),
        situacao_id: String((os as any).situacao_id ?? ''),
        nome_situacao: String(os.nome_situacao ?? ''),
        data: String(os.data ?? ''),
      };
      for (const w of os.produtos || []) {
        const pid = normId((w as any)?.produto?.produto_id);
        if (!pid) continue;
        const qtd = parseDec((w as any)?.produto?.quantidade);
        if (!oss.has(pid)) oss.set(pid, []);
        oss.get(pid)!.push({ ...ref, qtd });
      }
    }

    // Orçamentos
    const orcList = await paginate<GCOrcamento>(
      (p) => listOrcamentos(undefined, p),
      onProgress,
      'Indexando Orçamentos',
    );
    for (const o of orcList) {
      const ref = {
        id: String(o.id),
        codigo: String(o.codigo ?? o.id),
        nome_cliente: String(o.nome_cliente ?? ''),
        situacao_id: String((o as any).situacao_id ?? ''),
        nome_situacao: String(o.nome_situacao ?? ''),
        data: String(o.data ?? ''),
      };
      for (const w of o.produtos || []) {
        const pid = normId(w.produto?.produto_id);
        if (!pid) continue;
        const qtd = parseDec(w.produto?.quantidade);
        if (!orcamentos.has(pid)) orcamentos.set(pid, []);
        orcamentos.get(pid)!.push({ ...ref, qtd });
      }
    }

    // Compras
    const compList = await paginate<GCOrdemCompra>(
      (p) => listOrdensCompra(undefined, p),
      onProgress,
      'Indexando Pedidos de Compra',
    );
    for (const c of compList) {
      const ref = {
        id: String(c.id),
        codigo: String(c.codigo ?? c.id),
        nome_fornecedor: String(c.nome_fornecedor ?? ''),
        situacao_id: String((c as any).situacao_id ?? ''),
        nome_situacao: String(c.nome_situacao ?? ''),
        data: String(c.data_emissao ?? ''),
      };
      for (const w of c.produtos || []) {
        const pid = normId(w.produto?.produto_id);
        if (!pid) continue;
        const qtd = parseDec(w.produto?.quantidade);
        if (!compras.has(pid)) compras.set(pid, []);
        compras.get(pid)!.push({ ...ref, qtd });
      }
    }

    // Vendas
    const vendaList = await paginate<GCVenda>(
      (p) => listVendas(undefined, p),
      onProgress,
      'Indexando Vendas',
    );
    for (const v of vendaList) {
      const ref = {
        id: String(v.id),
        codigo: String(v.codigo ?? v.id),
        nome_cliente: String(v.nome_cliente ?? ''),
        situacao_id: String(v.situacao_id ?? ''),
        nome_situacao: String(v.nome_situacao ?? ''),
        data: String(v.data ?? ''),
      };
      for (const w of v.produtos || []) {
        const pid = normId((w as any)?.produto?.produto_id);
        if (!pid) continue;
        const qtd = parseDec((w as any)?.produto?.quantidade);
        if (!vendas.has(pid)) vendas.set(pid, []);
        vendas.get(pid)!.push({ ...ref, qtd });
      }
    }

    cache = { builtAt: Date.now(), oss, orcamentos, compras, vendas };
    return cache;
  })();

  try {
    return await building;
  } finally {
    building = null;
  }
}

export function clearExplorerIndex() {
  cache = null;
}

export function getExplorerStatus(): { builtAt: number; isExpired: boolean } | null {
  if (!cache) return null;
  return { builtAt: cache.builtAt, isExpired: Date.now() - cache.builtAt >= TTL };
}

// Statuses that should NOT count toward open demand / open purchase
const FINISHED_OS = ['FINALIZADA', 'FINALIZADO', 'CANCELADA', 'CANCELADO', 'ENTREGUE'];
const FINISHED_ORC = ['CANCELADO', 'CANCELADA', 'REJEITADO', 'RECUSADO'];
const FINISHED_COMPRA = ['RECEBIDA', 'RECEBIDO', 'CANCELADA', 'CANCELADO', 'FINALIZADA'];

function isOpenOS(s: string) {
  const u = s.toUpperCase();
  return !FINISHED_OS.some(x => u.includes(x));
}
function isOpenOrc(s: string) {
  const u = s.toUpperCase();
  return !FINISHED_ORC.some(x => u.includes(x));
}
function isOpenCompra(s: string) {
  const u = s.toUpperCase();
  return !FINISHED_COMPRA.some(x => u.includes(x));
}

export async function getProductExplorerData(produtoId: string): Promise<ProductExplorerData> {
  const idx = await buildExplorerIndex();
  const detalhe = await getProdutoDetalhe(produtoId);
  const estoque = parseDec(detalhe?.estoque);

  const oss = (idx.oss.get(produtoId) ?? []).slice().sort((a, b) => b.data.localeCompare(a.data));
  const orcamentos = (idx.orcamentos.get(produtoId) ?? []).slice().sort((a, b) => b.data.localeCompare(a.data));
  const compras = (idx.compras.get(produtoId) ?? []).slice().sort((a, b) => b.data.localeCompare(a.data));

  const cfg = getExplorerConfig();
  const osSet = new Set(cfg.osSituacaoIds);
  const orcSet = new Set(cfg.orcSituacaoIds);
  const compraSet = new Set(cfg.compraSituacaoIds);

  const matchOS = (o: ExplorerOSRef) =>
    osSet.size > 0 ? osSet.has(o.situacao_id) : isOpenOS(o.nome_situacao);
  const matchOrc = (o: ExplorerOrcRef) =>
    orcSet.size > 0 ? orcSet.has(o.situacao_id) : isOpenOrc(o.nome_situacao);
  const matchCompra = (c: ExplorerCompraRef) =>
    compraSet.size > 0 ? compraSet.has(c.situacao_id) : isOpenCompra(c.nome_situacao);

  const qtd_demanda_os = oss.filter(matchOS).reduce((s, o) => s + o.qtd, 0);
  const qtd_demanda_orcamentos = orcamentos.filter(matchOrc).reduce((s, o) => s + o.qtd, 0);
  const qtd_em_compra = compras.filter(matchCompra).reduce((s, c) => s + c.qtd, 0);

  const demanda = qtd_demanda_os + qtd_demanda_orcamentos;
  const saldo_projetado = estoque + qtd_em_compra - demanda;

  let health: ProductExplorerData['health'] = 'ok';
  if (saldo_projetado < 0) health = 'critical';
  else if (estoque < demanda) health = 'warn';

  return {
    produto_id: produtoId,
    estoque,
    detalhe,
    oss,
    orcamentos,
    compras,
    qtd_demanda_os,
    qtd_demanda_orcamentos,
    qtd_em_compra,
    saldo_projetado,
    health,
  };
}

// Search using existing edge function over products_index
export interface ProductSearchResult {
  produto_id: string;
  nome: string;
  codigo_interno: string | null;
  codigo_barra: string | null;
}

export async function searchProducts(query: string): Promise<ProductSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase.functions.invoke('search-products-index', {
    body: { query: q, source: 'product_explorer' },
  });
  if (error) throw new Error(error.message);
  const rows = ((data as any)?.data ?? []) as any[];
  return rows.map(r => ({
    produto_id: String(r.produto_id),
    nome: String(r.nome ?? ''),
    codigo_interno: r.codigo_interno ?? null,
    codigo_barra: r.codigo_barra ?? null,
  }));
}
