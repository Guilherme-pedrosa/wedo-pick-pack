import { GCOrcamento, GCProdutoDetalhe, OrcamentoConvertidoWarning, GCOrdemCompra } from './types';
import { getStatusOrcamentos, listOrcamentos, getProdutoDetalhe, buildOSIndex, OSReservedDemand, listOrdensCompra } from './compras';

export interface OrcamentoReadiness {
  orcamento: GCOrcamento;
  itens: Array<{
    produto_id: string;
    variacao_id: string;
    nome_produto: string;
    codigo_produto: string;
    qtd_necessaria: number;
    estoque_total: number;      // real stock from ERP (never reduced)
    estoque_disponivel: number;  // same as estoque_total (real stock)
    pronto: boolean;             // real stock >= needed
    comprometido: boolean;       // true if this item is disputed by other budgets/OSs
    qtd_em_compra?: number;
    ordens_compra?: Array<{ codigo: string; qtd: number; nome_fornecedor: string; situacao: string }>;
  }>;
  totalItens: number;
  itensProntos: number;
  pronto: boolean;
  temComprometido: boolean;      // true if any item is in a conflict
  osLinked?: { os_codigo: string; os_id: string; nome_situacao: string }; // set when budget is already an OS but its OS situation was ignored by the filter
}

export interface ConflictInfo {
  produto_key: string;
  nome_produto: string;
  codigo_produto: string;
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
  dataInicio?: string, // YYYY-MM-DD — only include orçamentos with data >= dataInicio
  situacaoCompraIds?: string[], // if empty/undefined, skip purchase-order coverage analysis
  situacaoOSNomes?: string[], // OS situation NAMES that count as "blocked". If undefined, all OS-linked budgets are blocked (current default). If empty array, no OS-linked budgets are blocked (everything goes back to normal tracking).
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
  let filteredOrcamentos = nomeCliente
    ? deduped.filter(o => o.nome_cliente.toLowerCase().includes(nomeCliente.toLowerCase()))
    : deduped;

  // Date filter (data >= dataInicio). GC dates come as YYYY-MM-DD, so string compare works.
  if (dataInicio) {
    filteredOrcamentos = filteredOrcamentos.filter(o => String(o.data || '') >= dataInicio);
  }

  // Phase 1b: Build OS index and filter out converted budgets
  onProgress?.('Construindo índice de OS…', 0, 1);
  const { index: osIndex, reservedDemand } = await buildOSIndex(
    (step, checked, total) => onProgress?.(step, checked, total),
  );

  const bloqueados: OrcamentoConvertidoWarning[] = [];
  const uniqueOrcamentos: GCOrcamento[] = [];
  // Orçamentos que JÁ SÃO OS, mas cuja situação está sendo ignorada pelo filtro.
  // Voltam ao rastreio normal (visíveis), porém marcados para impedir nova geração de OS.
  const ignoredOSLinks = new Map<string, { os_codigo: string; os_id: string; nome_situacao: string }>();

  // situacaoOSNomes = situações de OS a IGNORAR (não tratar como bloqueio).
  // Se a OS vinculada estiver em uma das situações marcadas, o orçamento volta ao rastreio normal.
  const osIgnoreActive = situacaoOSNomes !== undefined && situacaoOSNomes.length > 0;
  const osIgnoreSet = new Set((situacaoOSNomes || []).map(n => n.trim().toLowerCase()));

  for (const o of filteredOrcamentos) {
    const flagFin = String(o.situacao_financeiro ?? '');
    const flagEst = String(o.situacao_estoque ?? '');
    const byFlags = ['1', 'true', 'sim'].includes(flagFin.toLowerCase()) ||
                    ['1', 'true', 'sim'].includes(flagEst.toLowerCase());
    const osMatch = osIndex[String(o.codigo)];

    // Se o filtro de ignorar está ativo e a situação da OS está na lista, ignora o vínculo (para fins de bloqueio).
    const osMatchIgnored = osMatch && osIgnoreActive && osIgnoreSet.has(String(osMatch.nome_situacao || '').trim().toLowerCase());
    const osMatchPasses = osMatch && !osMatchIgnored;

    if (byFlags || osMatchPasses) {
      const reason = byFlags ? 'flag' as const : 'os_index' as const;
      let warning = '';
      if (osMatchPasses) {
        warning = `Orçamento #${o.codigo} → já é OS #${osMatch!.os_codigo} [${osMatch!.nome_situacao}]`;
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
        link_number: osMatchPasses ? osMatch!.os_codigo : null,
        link_id: osMatchPasses ? osMatch!.os_id : null,
        link_situacao: osMatchPasses ? osMatch!.nome_situacao : null,
        warning,
      });
      console.warn(`[RASTREADOR] ${warning}`);
    } else {
      if (osMatchIgnored) {
        ignoredOSLinks.set(o.id, {
          os_codigo: osMatch!.os_codigo,
          os_id: osMatch!.os_id,
          nome_situacao: osMatch!.nome_situacao,
        });
      }
      uniqueOrcamentos.push(o);
    }
  }

  // Phase 2: Collect unique product IDs (from BOTH unique budgets AND blocked budgets,
  // so we can also show stock/conflict info for blocked ones)
  const orcamentosForStock: GCOrcamento[] = [...uniqueOrcamentos, ...filteredOrcamentos.filter(o => bloqueados.some(b => b.orcamento_id === o.id))];
  const uniqueProductIds = new Set<string>();
  for (const orc of orcamentosForStock) {
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

  // Phase 4: Build real stock/code maps by product key
  function makeKey(pid: string, vid: string) { return vid ? `${pid}::${vid}` : pid; }

  const stockMap = new Map<string, number>(); // key -> real stock from API
  const codeMap = new Map<string, string>();  // key -> best available product code

  for (const orc of orcamentosForStock) {
    for (const p of orc.produtos || []) {
      const pid = normalizeId(p.produto.produto_id);
      const vid = normalizeId(p.produto.variacao_id);
      if (!pid) continue;

      const key = makeKey(pid, vid);
      const detail = detailCache.get(pid);

      const apiCode = String(p.produto.codigo_produto ?? '').trim();
      const variationById = vid && detail?.variacoes?.length
        ? detail.variacoes.find(v => String(v.variacao.id) === vid)
        : undefined;
      const variationCode = String(variationById?.variacao.codigo ?? '').trim();
      const internalCode = String(detail?.codigo_interno ?? '').trim();
      const bestCode = apiCode || variationCode || internalCode;

      if (!codeMap.has(key) && bestCode) codeMap.set(key, bestCode);
      if (stockMap.has(key)) continue;

      let estoque = 0;
      if (detail) {
        if (vid && detail.variacoes?.length) {
          const byId = detail.variacoes.find(v => String(v.variacao.id) === vid);
          const byCode = !byId && bestCode
            ? detail.variacoes.find(v => String(v.variacao.codigo ?? '').trim() === bestCode)
            : undefined;
          const singleVariation = !byId && !byCode && detail.variacoes.length === 1
            ? detail.variacoes[0]
            : undefined;
          const selectedVariation = byId ?? byCode ?? singleVariation;

          if (selectedVariation) {
            estoque = parseDecimal(selectedVariation.variacao.estoque);
          } else {
            estoque = 0;
          }
        } else {
          estoque = parseDecimal(detail.estoque);
        }
      }

      stockMap.set(key, estoque);
    }
  }

  // Available stock = real stock from API (reservations are alerts only, never reduce stock)
  const stockMapOriginal = new Map(stockMap);
  const availableStockMap = new Map(stockMap);

  // Phase 4b: Collect OS reservations as ALERTS ONLY (do NOT subtract from available stock)
  const osReservadas: OSReservedInfo[] = [];
  for (const [key, reserved] of Object.entries(reservedDemand)) {
    osReservadas.push({
      produto_key: key,
      nome_produto: '',
      qtd_reservada: reserved.qty,
      os_envolvidas: reserved.orcamentos,
    });
  }

  // Phase 4c: Fetch purchase orders for the SELECTED statuses (user controls which count
  // as "em compra"). If no statuses selected, skip — coverage analysis is disabled.
  const compraMapByKey = new Map<string, { qtd: number; ordens: Array<{ codigo: string; qtd: number; nome_fornecedor: string; situacao: string }> }>();
  const compraMapByProduto = new Map<string, { qtd: number; ordens: Array<{ codigo: string; qtd: number; nome_fornecedor: string; situacao: string }> }>();
  if (situacaoCompraIds && situacaoCompraIds.length > 0) {
    onProgress?.('Buscando pedidos de compra…', 0, 1);
    try {
      const allOrdens: GCOrdemCompra[] = [];
      for (const sid of situacaoCompraIds) {
        let page = 1;
        while (true) {
          const res = await listOrdensCompra(sid, page);
          allOrdens.push(...res.data);
          if (page >= res.meta.total_paginas) break;
          page++;
          await new Promise(r => setTimeout(r, 400));
        }
      }
      for (const ordem of allOrdens) {
        for (const p of ordem.produtos || []) {
          const pid = normalizeId(p.produto.produto_id);
          if (!pid) continue;
          const vid = normalizeId(p.produto.variacao_id);
          const key = makeKey(pid, vid);
          const qty = parseDecimal(p.produto.quantidade);
          const ref = { codigo: ordem.codigo, qtd: qty, nome_fornecedor: ordem.nome_fornecedor, situacao: ordem.nome_situacao };
          if (!compraMapByKey.has(key)) compraMapByKey.set(key, { qtd: 0, ordens: [] });
          const e1 = compraMapByKey.get(key)!;
          e1.qtd += qty; e1.ordens.push(ref);
          if (!compraMapByProduto.has(pid)) compraMapByProduto.set(pid, { qtd: 0, ordens: [] });
          const e2 = compraMapByProduto.get(pid)!;
          e2.qtd += qty; e2.ordens.push(ref);
        }
      }
    } catch (e) {
      console.warn('[RASTREADOR] Falha ao buscar pedidos de compra para análise de cobertura:', e);
    }
  }

  function getCompraInfo(pid: string, key: string) {
    const entry = compraMapByKey.get(key) ?? compraMapByProduto.get(pid);
    if (!entry) return { qtd_em_compra: 0, ordens_compra: [] as Array<{ codigo: string; qtd: number; nome_fornecedor: string; situacao: string }> };
    const seen = new Set<string>();
    const ordens = entry.ordens.filter(o => { if (seen.has(o.codigo)) return false; seen.add(o.codigo); return true; });
    return { qtd_em_compra: entry.qtd, ordens_compra: ordens };
  }

  // Phase 5: Compute total demand per product across all budgets (for conflict detection)
  const demandMap = new Map<string, { total: number; nome: string; codigo: string; orcamentos: Array<{ id: string; codigo: string; nome_cliente: string; qtd: number }> }>();
  for (const orc of uniqueOrcamentos) {
    for (const p of orc.produtos || []) {
      const pid = normalizeId(p.produto.produto_id);
      const vid = normalizeId(p.produto.variacao_id);
      if (!pid) continue;

      const key = makeKey(pid, vid);
      const qtd = parseDecimal(p.produto.quantidade);
      const code = codeMap.get(key) || String(p.produto.codigo_produto ?? '').trim();

      if (!demandMap.has(key)) {
        demandMap.set(key, { total: 0, nome: p.produto.nome_produto, codigo: code, orcamentos: [] });
      }

      const entry = demandMap.get(key)!;
      if (!entry.codigo && code) entry.codigo = code;
      entry.total += qtd;
      entry.orcamentos.push({ id: orc.id, codigo: orc.codigo, nome_cliente: orc.nome_cliente, qtd });
    }
  }

  // Fill product names in osReservadas from demandMap
  for (const info of osReservadas) {
    const demand = demandMap.get(info.produto_key);
    if (demand) info.nome_produto = demand.nome;
  }

  // Remove entries that don't affect any tracked product (no overlap with budgets)
  const relevantReservadas = osReservadas.filter(r => demandMap.has(r.produto_key));

  // Detect conflicts: products where total demand > available stock (after OS reserved subtraction)
  const conflitos: ConflictInfo[] = [];
  for (const [key, demand] of demandMap) {
    const realStock = stockMapOriginal.get(key) ?? 0;
    const reserved = reservedDemand[key];
    const totalDemand = demand.total + (reserved?.qty ?? 0);

    // Conflict = total demand (all budgets + OS reservations) exceeds real stock
    if (totalDemand > realStock) {
      conflitos.push({
        produto_key: key,
        nome_produto: demand.nome,
        codigo_produto: demand.codigo || codeMap.get(key) || '',
        estoque_total: realStock,
        demanda_total: totalDemand,
        orcamentos_envolvidos: [
          ...demand.orcamentos,
          ...(reserved?.orcamentos.map(os => ({
            id: `os-${os.os_codigo}`,
            codigo: `OS #${os.os_codigo}`,
            nome_cliente: os.nome_cliente,
            qtd: os.qtd,
          })) ?? []),
        ],
      });
    }
  }

  // Phase 6: Build conflict set for quick lookup
  const conflictKeys = new Set(conflitos.map(c => c.produto_key));

  // Evaluate each budget using REAL stock (no allocation deduction)
  const prontos: OrcamentoReadiness[] = [];
  const pendentes: OrcamentoReadiness[] = [];

  for (const orc of uniqueOrcamentos) {
    const itens: OrcamentoReadiness['itens'] = [];

    for (const p of orc.produtos || []) {
      const pid = normalizeId(p.produto.produto_id);
      const vid = normalizeId(p.produto.variacao_id);
      if (!pid) continue;

      const key = makeKey(pid, vid);
      const qtd = parseDecimal(p.produto.quantidade);
      const stockTotal = stockMapOriginal.get(key) ?? 0;

      const compraInfo = getCompraInfo(pid, key);
      itens.push({
        produto_id: pid,
        variacao_id: vid,
        nome_produto: p.produto.nome_produto,
        codigo_produto: codeMap.get(key) || String(p.produto.codigo_produto ?? '').trim(),
        qtd_necessaria: qtd,
        estoque_total: stockTotal,
        estoque_disponivel: stockTotal, // real stock, never reduced
        pronto: stockTotal >= qtd,
        comprometido: conflictKeys.has(key),
        qtd_em_compra: compraInfo.qtd_em_compra,
        ordens_compra: compraInfo.ordens_compra,
      });
    }

    const allReady = itens.length > 0 && itens.every(i => i.pronto);
    const temComprometido = itens.some(i => i.comprometido);

    const entry: OrcamentoReadiness = {
      orcamento: orc,
      itens,
      totalItens: itens.length,
      itensProntos: itens.filter(i => i.pronto).length,
      pronto: allReady,
      temComprometido,
    };

    if (entry.pronto) prontos.push(entry);
    else pendentes.push(entry);
  }

  // Per-item readiness for blocked budgets (already became OS), so the user can still see
  // stock, conflict, and coverage info for them.
  const orcamentoById = new Map(filteredOrcamentos.map(o => [o.id, o]));
  for (const b of bloqueados) {
    const orc = orcamentoById.get(b.orcamento_id);
    if (!orc) continue;
    const itens: NonNullable<typeof b.itens> = [];
    for (const p of orc.produtos || []) {
      const pid = normalizeId(p.produto.produto_id);
      const vid = normalizeId(p.produto.variacao_id);
      if (!pid) continue;
      const key = makeKey(pid, vid);
      const qtd = parseDecimal(p.produto.quantidade);
      const stockTotal = stockMapOriginal.get(key) ?? 0;
      const compraInfo = getCompraInfo(pid, key);
      itens.push({
        produto_id: pid,
        variacao_id: vid,
        nome_produto: p.produto.nome_produto,
        codigo_produto: codeMap.get(key) || String(p.produto.codigo_produto ?? '').trim(),
        qtd_necessaria: qtd,
        estoque_total: stockTotal,
        estoque_disponivel: stockTotal,
        pronto: stockTotal >= qtd,
        comprometido: conflictKeys.has(key),
        qtd_em_compra: compraInfo.qtd_em_compra,
        ordens_compra: compraInfo.ordens_compra,
      });
    }
    b.itens = itens;
    b.totalItens = itens.length;
    b.itensProntos = itens.filter(i => i.pronto).length;
    b.temComprometido = itens.some(i => i.comprometido);
  }

  return {
    orcamentosProntos: prontos,
    orcamentosPendentes: pendentes,
    orcamentosBloqueados: bloqueados,
    conflitos,
    osReservadas: relevantReservadas,
    totalOrcamentos: uniqueOrcamentos.length,
    totalProntos: prontos.length,
    totalBloqueados: bloqueados.length,
    scannedAt: new Date().toISOString(),
  };
}
