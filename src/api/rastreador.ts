import { GCOrcamento, GCProdutoDetalhe, OrcamentoConvertidoWarning } from './types';
import { getStatusOrcamentos, listOrcamentos, getProdutoDetalhe, listOrdensCompra, getStatusCompras } from './compras';

export interface PurchaseOrderRef {
  id: string;
  codigo: string;
  qtd: number;
  nome_fornecedor: string;
  situacao: string;
  data_previsao?: string;
}

export interface OrcamentoReadinessItem {
  produto_id: string;
  variacao_id: string;
  nome_produto: string;
  codigo_produto: string;
  qtd_necessaria: number;
  estoque_total: number;
  estoque_disponivel: number;
  pronto: boolean;
  qtd_em_compra: number;
  coberto_por_compra: boolean;
  ordens_compra: PurchaseOrderRef[];
}

export interface OrcamentoReadiness {
  orcamento: GCOrcamento;
  itens: OrcamentoReadinessItem[];
  totalItens: number;
  itensProntos: number;
  itensCobertosCompra: number;
  pronto: boolean;
}

export interface ConflictInfo {
  produto_key: string;
  nome_produto: string;
  estoque_total: number;
  demanda_total: number;
  orcamentos_envolvidos: Array<{ id: string; codigo: string; nome_cliente: string; qtd: number }>;
}

export interface RastreadorResult {
  orcamentosProntos: OrcamentoReadiness[];
  orcamentosPendentes: OrcamentoReadiness[];
  conflitos: ConflictInfo[];
  orcamentosConvertidos: OrcamentoConvertidoWarning[];
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

function makeKey(pid: string, vid: string) { return vid ? `${pid}::${vid}` : pid; }

export { getStatusOrcamentos };

export async function rastrearOrcamentos(
  situacaoIds: string[],
  situacaoCompraIds: string[],
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

  // Phase 1b: Detect converted budgets
  const orcamentosConvertidos: OrcamentoConvertidoWarning[] = uniqueOrcamentos
    .filter(o => o.situacao_financeiro === '1' && o.situacao_estoque === '1')
    .map(o => ({
      orcamento_id: o.id,
      codigo: o.codigo,
      nome_cliente: o.nome_cliente,
      situacao_financeiro: o.situacao_financeiro!,
      situacao_estoque: o.situacao_estoque!,
    }));

  // Phase 2: Fetch purchase orders
  onProgress?.('Buscando pedidos de compra…', 0, 1);
  const allOrdensCompra: import('./types').GCOrdemCompra[] = [];
  for (const sid of situacaoCompraIds) {
    let page = 1;
    while (true) {
      const res = await listOrdensCompra(sid, page);
      allOrdensCompra.push(...res.data);
      if (page >= res.meta.total_paginas) break;
      page++;
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // Build purchase order map: product key -> { qtd, ordens }
  const compraMap = new Map<string, { qtd: number; ordens: PurchaseOrderRef[] }>();
  const compraMapByProduto = new Map<string, { qtd: number; ordens: PurchaseOrderRef[] }>();
  for (const ordem of allOrdensCompra) {
    for (const p of ordem.produtos || []) {
      const produtoId = normalizeId(p.produto.produto_id);
      if (!produtoId) continue;
      const vid = normalizeId(p.produto.variacao_id);
      const key = makeKey(produtoId, vid);
      const qty = parseDecimal(p.produto.quantidade);
      const ref: PurchaseOrderRef = {
        id: ordem.id, codigo: ordem.codigo, qtd: qty,
        nome_fornecedor: ordem.nome_fornecedor, situacao: ordem.nome_situacao,
        data_previsao: ordem.data_previsao,
      };

      if (!compraMap.has(key)) compraMap.set(key, { qtd: 0, ordens: [] });
      const entry = compraMap.get(key)!;
      entry.qtd += qty;
      entry.ordens.push(ref);

      if (!compraMapByProduto.has(produtoId)) compraMapByProduto.set(produtoId, { qtd: 0, ordens: [] });
      const byProd = compraMapByProduto.get(produtoId)!;
      byProd.qtd += qty;
      byProd.ordens.push(ref);
    }
  }

  // Phase 3: Collect unique product IDs
  const uniqueProductIds = new Set<string>();
  for (const orc of uniqueOrcamentos) {
    for (const p of orc.produtos || []) {
      const pid = normalizeId(p.produto.produto_id);
      if (pid) uniqueProductIds.add(pid);
    }
  }

  // Phase 4: Fetch stock for each product
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

  // Phase 5: Build real stock map
  const stockMap = new Map<string, number>();
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

  // Phase 6: Compute total demand per product (for conflict detection)
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

  // Detect conflicts
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

  // Phase 7: Smart allocation with purchase order awareness
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

    const readinessRatio = totalItems > 0 ? itemsWithStock / totalItems : 0;
    return { orc, readinessRatio, totalItems, itemsWithStock, itemsNeeded };
  });

  scoredOrcamentos.sort((a, b) => {
    if (b.readinessRatio !== a.readinessRatio) return b.readinessRatio - a.readinessRatio;
    return a.totalItems - b.totalItems;
  });

  // Allocate stock cumulatively
  const remainingStock = new Map(stockMap);
  const prontos: OrcamentoReadiness[] = [];
  const pendentes: OrcamentoReadiness[] = [];

  for (const { orc, itemsNeeded } of scoredOrcamentos) {
    const itens: OrcamentoReadinessItem[] = [];

    let canFulfill = true;
    for (const { key, qtd } of itemsNeeded) {
      const available = remainingStock.get(key) ?? 0;
      if (available < qtd) canFulfill = false;
    }

    for (const p of orc.produtos || []) {
      const pid = normalizeId(p.produto.produto_id);
      const vid = normalizeId(p.produto.variacao_id);
      if (!pid) continue;
      const key = makeKey(pid, vid);
      const qtd = parseDecimal(p.produto.quantidade);
      const available = remainingStock.get(key) ?? 0;
      const stockTotal = stockMap.get(key) ?? 0;

      // Purchase order lookup
      const compraEntry = compraMap.get(key) ?? compraMapByProduto.get(pid);
      const qtdEmCompra = compraEntry?.qtd ?? 0;
      const ordensCompra = compraEntry?.ordens ?? [];
      const deficit = Math.max(0, qtd - available);
      const cobertoPorCompra = !canFulfill && deficit > 0 && qtdEmCompra >= deficit;

      itens.push({
        produto_id: pid,
        variacao_id: vid,
        nome_produto: p.produto.nome_produto,
        codigo_produto: p.produto.codigo_produto,
        qtd_necessaria: qtd,
        estoque_total: stockTotal,
        estoque_disponivel: available,
        pronto: available >= qtd,
        qtd_em_compra: qtdEmCompra,
        coberto_por_compra: cobertoPorCompra,
        ordens_compra: ordensCompra,
      });
    }

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
      itensCobertosCompra: itens.filter(i => i.coberto_por_compra).length,
      pronto: canFulfill && itens.length > 0,
    };

    if (entry.pronto) prontos.push(entry);
    else pendentes.push(entry);
  }

  return {
    orcamentosProntos: prontos,
    orcamentosPendentes: pendentes,
    conflitos,
    orcamentosConvertidos,
    totalOrcamentos: uniqueOrcamentos.length,
    totalProntos: prontos.length,
    scannedAt: new Date().toISOString(),
  };
}
