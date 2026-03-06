import { GCOrcamento, GCProdutoDetalhe } from './types';
import { getStatusOrcamentos, listOrcamentos, getProdutoDetalhe } from './compras';

export interface OrcamentoReadiness {
  orcamento: GCOrcamento;
  itens: Array<{
    produto_id: string;
    variacao_id: string;
    nome_produto: string;
    codigo_produto: string;
    qtd_necessaria: number;
    estoque_atual: number;
    pronto: boolean;
  }>;
  totalItens: number;
  itensProntos: number;
  pronto: boolean; // all items in stock
}

export interface RastreadorResult {
  orcamentosProntos: OrcamentoReadiness[];
  orcamentosPendentes: OrcamentoReadiness[];
  totalOrcamentos: number;
  totalProntos: number;
  scannedAt: string;
}

function normalizeId(value: string | number | null | undefined): string {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw || raw === '0' || raw.toLowerCase() === 'null') return '';
  return raw;
}

function parseDecimal(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  if (raw.includes(',') && raw.includes('.')) return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
  if (raw.includes(',')) return parseFloat(raw.replace(',', '.')) || 0;
  return parseFloat(raw) || 0;
}

export { getStatusOrcamentos };

export async function rastrearOrcamentos(
  situacaoIds: string[],
  onProgress?: (step: string, checked: number, total: number) => void,
): Promise<RastreadorResult> {
  // Phase 1: Fetch budgets
  onProgress?.('Buscando orçamentos…', 0, 1);
  const allOrcamentos: GCOrcamento[] = [];
  const situacaoSet = new Set(situacaoIds);

  for (const sid of situacaoIds) {
    let page = 1;
    while (true) {
      const res = await listOrcamentos(sid, page);
      const filtered = res.data.filter(o => situacaoSet.has(String(o.situacao_id)));
      allOrcamentos.push(...filtered);
      if (page >= res.meta.total_paginas) break;
      page++;
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // Deduplicate
  const uniqueOrcamentos = [...new Map(allOrcamentos.map(o => [o.id, o])).values()];

  // Phase 2: Collect unique product IDs
  const uniqueProductIds = new Set<string>();
  for (const orc of uniqueOrcamentos) {
    for (const p of orc.produtos || []) {
      const pid = normalizeId(p.produto.produto_id);
      if (pid) uniqueProductIds.add(pid);
    }
  }

  // Phase 3: Fetch stock for each product
  const productIds = [...uniqueProductIds];
  const detailCache = new Map<string, GCProdutoDetalhe | null>();
  const total = productIds.length;

  for (let i = 0; i < productIds.length; i += 2) {
    const batch = productIds.slice(i, i + 2);
    onProgress?.('Verificando estoque…', i, total);
    await Promise.all(batch.map(async pid => {
      if (!detailCache.has(pid)) {
        detailCache.set(pid, await getProdutoDetalhe(pid));
      }
    }));
    if (i + 2 < productIds.length) await new Promise(r => setTimeout(r, 500));
  }
  onProgress?.('Analisando resultados…', total, total);

  // Phase 4: Evaluate each budget
  const prontos: OrcamentoReadiness[] = [];
  const pendentes: OrcamentoReadiness[] = [];

  for (const orc of uniqueOrcamentos) {
    const itens: OrcamentoReadiness['itens'] = [];

    for (const p of orc.produtos || []) {
      const pid = normalizeId(p.produto.produto_id);
      const vid = normalizeId(p.produto.variacao_id);
      const qtd = parseDecimal(p.produto.quantidade);
      if (!pid) continue;

      const detail = detailCache.get(pid);
      let estoque = 0;
      if (detail) {
        if (vid && detail.variacoes?.length) {
          const v = detail.variacoes.find(v => String(v.variacao.id) === vid);
          estoque = v ? parseDecimal(v.variacao.estoque) : parseDecimal(detail.estoque);
        } else {
          estoque = parseDecimal(detail.estoque);
        }
      }

      itens.push({
        produto_id: pid,
        variacao_id: vid,
        nome_produto: p.produto.nome_produto,
        codigo_produto: p.produto.codigo_produto,
        qtd_necessaria: qtd,
        estoque_atual: estoque,
        pronto: estoque >= qtd,
      });
    }

    const allReady = itens.length > 0 && itens.every(i => i.pronto);
    const entry: OrcamentoReadiness = {
      orcamento: orc,
      itens,
      totalItens: itens.length,
      itensProntos: itens.filter(i => i.pronto).length,
      pronto: allReady,
    };

    if (allReady) prontos.push(entry);
    else pendentes.push(entry);
  }

  return {
    orcamentosProntos: prontos,
    orcamentosPendentes: pendentes,
    totalOrcamentos: uniqueOrcamentos.length,
    totalProntos: prontos.length,
    scannedAt: new Date().toISOString(),
  };
}
