import { GCOrcamento, GCProdutoDetalhe, OrcamentoConvertidoWarning } from './types';
import { getStatusOrcamentos, listOrcamentos, getProdutoDetalhe, buildOSIndex, OSReservedDemand } from './compras';

export interface OrcamentoReadiness {
  orcamento: GCOrcamento;
  itens: Array<{
    produto_id: string;
    variacao_id: string;
    nome_produto: string;
    codigo_produto: string;
    qtd_necessaria: number;
    estoque_total: number;      // stock total (real)
    estoque_disponivel: number;  // stock remaining after prior budgets consumed it
    pronto: boolean;
  }>;
  totalItens: number;
  itensProntos: number;
  pronto: boolean;
}

export interface ConflictInfo {
  produto_key: string;
  nome_produto: string;
  estoque_total: number;
  demanda_total: number;
  orcamentos_envolvidos: Array<{ id: string; codigo: string; nome_cliente: string; qtd: number }>;
}

export interface OSReservedInfo {
  produto_key: string;
  nome_produto: string;
  qtd_reservada: number;
  os_envolvidas: Array<{ os_codigo: string; nome_cliente: string; qtd: number }>;
}

export interface RastreadorResult {
  orcamentosProntos: OrcamentoReadiness[];
  orcamentosPendentes: OrcamentoReadiness[];
  orcamentosBloqueados: OrcamentoConvertidoWarning[];
  conflitos: ConflictInfo[];
  osReservadas: OSReservedInfo[];
  totalOrcamentos: number;
  totalProntos: number;
  totalBloqueados: number;
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
  nomeCliente?: string,
  onProgress?: (step: string, checked: number, total: number) => void,
): Promise<RastreadorResult> {
  // Phase 1: Fetch budgets
  onProgress?.('Buscando orçamentos…', 0, 1);
  const allOrcamentos: GCOrcamento[] = [];
  const situacaoSet = new Set(situacaoIds);

  for (const sid of situacaoIds) {
    let page = 1;
    while (true) {
      const res = await listOrcamentos(sid, page, nomeCliente);
      const filtered = res.data.filter(o => situacaoSet.has(String(o.situacao_id)));
      allOrcamentos.push(...filtered);
      if (page >= res.meta.total_paginas) break;
      page++;
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // Deduplicate
  const deduped = [...new Map(allOrcamentos.map(o => [o.id, o])).values()];

  // Client-side fallback filter (in case API ignores nome param)
  const filteredOrcamentos = nomeCliente
    ? deduped.filter(o => o.nome_cliente.toLowerCase().includes(nomeCliente.toLowerCase()))
    : deduped;

  // Phase 1b: Build OS index and filter out converted budgets
  onProgress?.('Construindo índice de OS…', 0, 1);
  const { index: osIndex, reservedDemand } = await buildOSIndex(
    (step, checked, total) => onProgress?.(step, checked, total),
  );

  const bloqueados: OrcamentoConvertidoWarning[] = [];
  const uniqueOrcamentos: GCOrcamento[] = [];

  for (const o of filteredOrcamentos) {
    const flagFin = String(o.situacao_financeiro ?? '');
    const flagEst = String(o.situacao_estoque ?? '');
    const byFlags = ['1', 'true', 'sim'].includes(flagFin.toLowerCase()) ||
                    ['1', 'true', 'sim'].includes(flagEst.toLowerCase());
    const osMatch = osIndex[String(o.codigo)];

    if (byFlags || osMatch) {
      const reason = byFlags ? 'flag' as const : 'os_index' as const;
      let warning = '';
      if (osMatch) {
        warning = `Orçamento #${o.codigo} → já é OS #${osMatch.os_codigo} [${osMatch.nome_situacao}]`;
      } else {
        warning = `Orçamento #${o.codigo} → convertido (flag financeiro/estoque)`;
      }
      bloqueados.push({
        orcamento_id: o.id,
        codigo: o.codigo,
        nome_cliente: o.nome_cliente,
        situacao_financeiro: flagFin,
        situacao_estoque: flagEst,
        reason,
        link_number: osMatch?.os_codigo ?? null,
        link_id: osMatch?.os_id ?? null,
        link_situacao: osMatch?.nome_situacao ?? null,
        warning,
      });
      console.warn(`[RASTREADOR] ${warning}`);
    } else {
      uniqueOrcamentos.push(o);
    }
  }

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

  // Phase 4: Build real stock map (key -> stock quantity)
  function makeKey(pid: string, vid: string) { return vid ? `${pid}::${vid}` : pid; }

  const stockMap = new Map<string, number>(); // key -> real stock
  for (const orc of uniqueOrcamentos) {
    for (const p of orc.produtos || []) {
      const pid = normalizeId(p.produto.produto_id);
      const vid = normalizeId(p.produto.variacao_id);
      if (!pid) continue;
      const key = makeKey(pid, vid);
      if (stockMap.has(key)) continue;

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
      stockMap.set(key, estoque);
    }
  }

  // Phase 5: Compute total demand per product across all budgets (for conflict detection)
  const demandMap = new Map<string, { total: number; nome: string; orcamentos: Array<{ id: string; codigo: string; nome_cliente: string; qtd: number }> }>();
  for (const orc of uniqueOrcamentos) {
    for (const p of orc.produtos || []) {
      const pid = normalizeId(p.produto.produto_id);
      const vid = normalizeId(p.produto.variacao_id);
      if (!pid) continue;
      const key = makeKey(pid, vid);
      const qtd = parseDecimal(p.produto.quantidade);
      if (!demandMap.has(key)) demandMap.set(key, { total: 0, nome: p.produto.nome_produto, orcamentos: [] });
      const entry = demandMap.get(key)!;
      entry.total += qtd;
      entry.orcamentos.push({ id: orc.id, codigo: orc.codigo, nome_cliente: orc.nome_cliente, qtd });
    }
  }

  // Detect conflicts: products where total demand > stock AND multiple budgets need it
  const conflitos: ConflictInfo[] = [];
  for (const [key, demand] of demandMap) {
    const stock = stockMap.get(key) ?? 0;
    if (demand.total > stock && demand.orcamentos.length > 1) {
      conflitos.push({
        produto_key: key,
        nome_produto: demand.nome,
        estoque_total: stock,
        demanda_total: demand.total,
        orcamentos_envolvidos: demand.orcamentos,
      });
    }
  }

  // Phase 6: Smart allocation - prioritize budgets that can be 100% fulfilled
  // Sort budgets by "readiness score": budgets where all items have stock get priority
  // Among those, prefer budgets with fewer missing items (closer to 100%)

  // Pre-compute readiness score for each budget
  const scoredOrcamentos = uniqueOrcamentos.map(orc => {
    let totalItems = 0;
    let itemsWithStock = 0;
    const itemsNeeded: Array<{ key: string; qtd: number }> = [];

    for (const p of orc.produtos || []) {
      const pid = normalizeId(p.produto.produto_id);
      const vid = normalizeId(p.produto.variacao_id);
      if (!pid) continue;
      const key = makeKey(pid, vid);
      const qtd = parseDecimal(p.produto.quantidade);
      const stock = stockMap.get(key) ?? 0;
      totalItems++;
      if (stock >= qtd) itemsWithStock++;
      itemsNeeded.push({ key, qtd });
    }

    // Score: ratio of items that have enough total stock (ignoring allocation)
    const readinessRatio = totalItems > 0 ? itemsWithStock / totalItems : 0;

    return { orc, readinessRatio, totalItems, itemsWithStock, itemsNeeded };
  });

  // Sort: highest readiness first (100% ready budgets first), then by fewer total items (simpler orders first)
  scoredOrcamentos.sort((a, b) => {
    if (b.readinessRatio !== a.readinessRatio) return b.readinessRatio - a.readinessRatio;
    return a.totalItems - b.totalItems;
  });

  // Allocate stock cumulatively in priority order
  const remainingStock = new Map(stockMap);
  const prontos: OrcamentoReadiness[] = [];
  const pendentes: OrcamentoReadiness[] = [];

  for (const { orc, itemsNeeded } of scoredOrcamentos) {
    const itens: OrcamentoReadiness['itens'] = [];

    // Check if ALL items can be fulfilled with remaining stock
    let canFulfill = true;
    for (const { key, qtd } of itemsNeeded) {
      const available = remainingStock.get(key) ?? 0;
      if (available < qtd) canFulfill = false;
    }

    // Build item details
    for (const p of orc.produtos || []) {
      const pid = normalizeId(p.produto.produto_id);
      const vid = normalizeId(p.produto.variacao_id);
      if (!pid) continue;
      const key = makeKey(pid, vid);
      const qtd = parseDecimal(p.produto.quantidade);
      const available = remainingStock.get(key) ?? 0;
      const stockTotal = stockMap.get(key) ?? 0;

      itens.push({
        produto_id: pid,
        variacao_id: vid,
        nome_produto: p.produto.nome_produto,
        codigo_produto: p.produto.codigo_produto,
        qtd_necessaria: qtd,
        estoque_total: stockTotal,
        estoque_disponivel: available,
        pronto: available >= qtd,
      });
    }

    // If budget can be fully fulfilled, consume stock
    if (canFulfill && itens.length > 0) {
      for (const { key, qtd } of itemsNeeded) {
        remainingStock.set(key, (remainingStock.get(key) ?? 0) - qtd);
      }
    }

    const entry: OrcamentoReadiness = {
      orcamento: orc,
      itens,
      totalItens: itens.length,
      itensProntos: itens.filter(i => i.pronto).length,
      pronto: canFulfill && itens.length > 0,
    };

    if (entry.pronto) prontos.push(entry);
    else pendentes.push(entry);
  }

  return {
    orcamentosProntos: prontos,
    orcamentosPendentes: pendentes,
    orcamentosBloqueados: bloqueados,
    conflitos,
    totalOrcamentos: uniqueOrcamentos.length,
    totalProntos: prontos.length,
    totalBloqueados: bloqueados.length,
    scannedAt: new Date().toISOString(),
  };
}
