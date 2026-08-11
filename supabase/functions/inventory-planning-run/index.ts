// ============================================================================
// inventory-planning-run
// Motor de planejamento de compras do Pick Pack (backend-first).
// GestãoClick = fonte de dados brutos. O cálculo de necessidade roda aqui e o
// resultado é persistido em inventory_planning_runs / inventory_purchase_suggestions.
// Chave de análise EXCLUSIVAMENTE por produto_id (nunca item_key/variacao_id).
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GC_API_URL = 'https://api.gestaoclick.com';
const GC_RATE_LIMIT_MS = 350;
const GC_API_USER_ID = '1320473';

// ============================================================================
// POLÍTICA DE REPOSIÇÃO (espelha src/pages/InventoryAnalysisPage.tsx)
// ============================================================================
const POLICY = {
  analysisMonths: 12,
  recentMonths: 3,
  defaultLeadTimeDays: 21,
  minLeadTimeDays: 7,
  maxLeadTimeDays: 90,
  zScores: { critical: 2.05, A: 1.65, B: 1.28, C: 1.04 } as Record<string, number>,
  lowCostThresholds: { veryLow: 30, low: 80, medium: 200, moderate: 500 },
  minShelfByCost: { veryLow: 6, low: 4, medium: 2, moderate: 1 },
  maxCoverageDaysByCost: { veryLow: 90, low: 75, medium: 60, moderate: 45, high: 30 },
  staleDemandDays: 365,
  stalePurchaseOrderDays: 90,
  pendingBudgetDemandFactor: 0.7,
  approvedBudgetDemandFactor: 1.0,
  minRecurringSources: 2,
  minRecurringQty: 2,
};

const CRITICAL_KEYWORDS = [
  'placa', 'controlador', 'compressor', 'contator', 'rele', 'relé', 'termostato',
  'sensor', 'resistencia', 'resistência', 'motor', 'bomba', 'ventilador', 'micro',
  'chave', 'rolamento', 'retentor', 'correia', 'mangueira', 'vedacao', 'vedação',
  'valvula', 'válvula',
];

function inferCriticality(nome: string): boolean {
  const name = (nome || '').toLowerCase();
  return CRITICAL_KEYWORDS.some((k) => name.includes(k));
}

function getCoverageDaysByCost(unitCost: number): number {
  const t = POLICY.lowCostThresholds;
  const c = POLICY.maxCoverageDaysByCost;
  if (unitCost > 0 && unitCost <= t.veryLow) return c.veryLow;
  if (unitCost <= t.low) return c.low;
  if (unitCost <= t.medium) return c.medium;
  if (unitCost <= t.moderate) return c.moderate;
  return c.high;
}

function getOperationalMinimum(unitCost: number, isRecurring: boolean, isCritical: boolean): number {
  if (!isRecurring && !isCritical) return 0;
  const t = POLICY.lowCostThresholds;
  const m = POLICY.minShelfByCost;
  if (unitCost > 0 && unitCost <= t.veryLow) return m.veryLow;
  if (unitCost <= t.low) return m.low;
  if (unitCost <= t.medium) return m.medium;
  if (unitCost <= t.moderate && isCritical) return m.moderate;
  return isCritical ? 1 : 0;
}

function getMaxShelfQtyByCost(unitCost: number, forecastMonthly: number): number {
  const coverageDays = getCoverageDaysByCost(unitCost);
  return Math.ceil((forecastMonthly / 30) * coverageDays) + getOperationalMinimum(unitCost, true, false);
}

function stdDev(series: number[]): number {
  const n = series.length;
  if (n === 0) return 0;
  const mean = series.reduce((s, v) => s + v, 0) / n;
  const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseDecimal(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  if (raw.includes(',') && raw.includes('.')) return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
  if (raw.includes(',')) return parseFloat(raw.replace(',', '.')) || 0;
  return parseFloat(raw) || 0;
}

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ----------------------------------------------------------------------------
// GC fetch helpers
// ----------------------------------------------------------------------------
async function gcFetch(path: string, gcAccess: string, gcSecret: string): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const targetUrl = new URL(path, GC_API_URL);
    if (!targetUrl.searchParams.has('usuario_id')) {
      targetUrl.searchParams.set('usuario_id', GC_API_USER_ID);
    }

    const res = await fetch(targetUrl, {
      headers: {
        'access-token': gcAccess,
        'secret-access-token': gcSecret,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
    if (res.status === 429) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GC API ${res.status} em ${path}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }
  throw new Error(`GC API rate limited (429) repetidamente em ${path}`);
}

interface StockProductInfo {
  estoque: number;
}

async function fetchAllStock(gcAccess: string, gcSecret: string): Promise<Map<string, number>> {
  const stockMap = new Map<string, number>();
  let page = 1;
  let totalPages = 1;
  do {
    await sleep(GC_RATE_LIMIT_MS);
    const data = await gcFetch(`/api/produtos?pagina=${page}&order=ASC`, gcAccess, gcSecret);
    const products = data?.data || [];
    totalPages = data?.meta?.total_paginas || 1;
    for (const p of products) {
      const id = String(p.id);
      const estoque = parseFloat(String(p.estoque || '0'));
      stockMap.set(id, isNaN(estoque) ? 0 : estoque);
    }
    page++;
  } while (page <= totalPages);
  return stockMap;
}

interface PCEntry { qtd: number; }
interface OrcEntry { qtd: number; }

async function fetchOpenPurchases(situacaoIds: string[], gcAccess: string, gcSecret: string): Promise<Map<string, PCEntry>> {
  const map = new Map<string, PCEntry>();
  for (const sid of situacaoIds) {
    let page = 1;
    let totalPages = 1;
    do {
      await sleep(GC_RATE_LIMIT_MS);
      const data = await gcFetch(`/api/compras?limite=100&pagina=${page}&situacao_id=${sid}`, gcAccess, gcSecret);
      const rows = data?.data || [];
      totalPages = data?.meta?.total_paginas || 1;
      for (const row of rows) {
        const compra = row?.Compra ?? row?.compra ?? row;
        if (String(compra?.situacao_id ?? '') !== String(sid)) continue;
        for (const p of compra?.produtos || []) {
          const produto = p?.produto ?? p;
          const pid = String(produto?.produto_id ?? produto?.id_produto ?? '').trim();
          if (!pid) continue;
          const qty = parseDecimal(produto?.quantidade);
          if (qty <= 0) continue;
          if (!map.has(pid)) map.set(pid, { qtd: 0 });
          map.get(pid)!.qtd += qty;
        }
      }
      page++;
    } while (page <= totalPages);
  }
  return map;
}

async function fetchPendingBudgets(
  situacaoIds: string[],
  gcAccess: string,
  gcSecret: string,
): Promise<Map<string, OrcEntry>> {
  const map = new Map<string, OrcEntry>();
  const seenBudgetIds = new Set<string>();
  for (const sid of situacaoIds) {
    for (const type of ['produto', 'servico'] as const) {
      let page = 1;
      while (true) {
        await sleep(GC_RATE_LIMIT_MS);
        const data = await gcFetch(
          `/api/orcamentos?limite=100&pagina=${page}&situacao_id=${sid}&tipo=${type}`,
          gcAccess,
          gcSecret,
        );
        const rows = data?.data || [];
        for (const row of rows) {
          const orc = row?.Orcamento ?? row?.orcamento ?? row;
          if (String(orc?.situacao_id ?? '') !== String(sid)) continue;
          const budgetId = String(orc?.id ?? '').trim();
          if (!budgetId || seenBudgetIds.has(budgetId)) continue;
          seenBudgetIds.add(budgetId);

          // ignora convertidos (financeiro/estoque)
          const fin = String(orc?.situacao_financeiro ?? '').toLowerCase();
          const est = String(orc?.situacao_estoque ?? '').toLowerCase();
          if (['1', 'true', 'sim', 'yes'].includes(fin) || ['1', 'true', 'sim', 'yes'].includes(est)) continue;
          for (const p of orc?.produtos || []) {
            const produto = p?.produto ?? p;
            const pid = String(produto?.produto_id ?? '').trim();
            if (!pid) continue;
            const qty = parseDecimal(produto?.quantidade);
            if (qty <= 0) continue;
            if (!map.has(pid)) map.set(pid, { qtd: 0 });
            map.get(pid)!.qtd += qty;
          }
        }

        // Orçamentos usam `proxima_pagina`; `total_paginas` pode ser nulo.
        // Sem esta leitura a sincronização de tipo=servico parava na página 1.
        const explicitNextPage = Number(data?.meta?.proxima_pagina);
        const totalPages = Number(data?.meta?.total_paginas);
        if (Number.isFinite(explicitNextPage) && explicitNextPage > page) {
          page = explicitNextPage;
        } else if (Number.isFinite(totalPages) && totalPages > page) {
          page += 1;
        } else {
          break;
        }
      }
    }
  }
  return map;
}

// ----------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const gcAccess = Deno.env.get('GC_ACCESS_TOKEN')!;
  const gcSecret = Deno.env.get('GC_SECRET_TOKEN')!;
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  if (!gcAccess || !gcSecret) return jsonResp({ error: 'GC credentials not configured' }, 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  // cria run
  const { data: runRow, error: runErr } = await supabase
    .from('inventory_planning_runs')
    .insert({ status: 'running' })
    .select()
    .single();
  if (runErr || !runRow) return jsonResp({ error: 'Falha ao criar run: ' + (runErr?.message || '') }, 500);
  const runId = runRow.id;

  try {
    // ----- config -----
    const { data: cfgRows } = await supabase
      .from('inventory_policy_config')
      .select('lookback_days, abc_thresholds, purchase_crossref_situacao_ids, budget_crossref_situacao_ids')
      .order('created_at', { ascending: false })
      .limit(1);
    const cfg = (cfgRows?.[0] as any) || {};
    const thresholds = cfg.abc_thresholds || { A: 0.8, B: 0.95 };
    const lookbackDays = cfg.lookback_days || 180;
    const purchaseSituacaoIds: string[] = cfg.purchase_crossref_situacao_ids || [];
    const budgetSituacaoIds: string[] = cfg.budget_crossref_situacao_ids || [];
    const effectiveLookback = Math.max(lookbackDays, POLICY.analysisMonths * 31);

    // ----- consumo (12 meses) -----
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - effectiveLookback);
    const cutoffStr = cutoff.toISOString();

    interface ConsRow {
      produto_id: string;
      total_qty: number;
      total_value: number;
      event_count: number;
      source_count: number;
      client_count: number;
      first_date: string;
      last_date: string;
      monthly_qty: Record<string, number>;
      _sources: Set<string>;
      _clients: Set<string>;
    }
    const consMap = new Map<string, ConsRow>();
    {
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('inventory_consumption_events')
          .select('produto_id, qty, valor_custo, occurred_at, source_id, cliente_nome')
          .gte('occurred_at', cutoffStr)
          .range(from, from + PAGE - 1);
        if (error) throw new Error('Erro lendo consumo: ' + error.message);
        const rows = data || [];
        for (const r of rows as any[]) {
          const key = r.produto_id;
          if (!key || String(key).trim() === '') continue;
          const qty = parseFloat(r.qty) || 0;
          const val = (parseFloat(r.valor_custo) || 0) * qty;
          const sourceId = r.source_id || '';
          const cliente = r.cliente_nome || '';
          const clientKey = (cliente || sourceId).toLowerCase().trim();
          const monthKey = (r.occurred_at || '').slice(0, 7);
          const ex = consMap.get(key);
          if (ex) {
            ex.total_qty += qty;
            ex.total_value += val;
            ex.event_count += 1;
            ex._sources.add(sourceId);
            ex._clients.add(clientKey);
            ex.source_count = ex._sources.size;
            ex.client_count = ex._clients.size;
            if (r.occurred_at < ex.first_date) ex.first_date = r.occurred_at;
            if (r.occurred_at > ex.last_date) ex.last_date = r.occurred_at;
            ex.monthly_qty[monthKey] = (ex.monthly_qty[monthKey] || 0) + qty;
          } else {
            consMap.set(key, {
              produto_id: key,
              total_qty: qty,
              total_value: val,
              event_count: 1,
              source_count: 1,
              client_count: 1,
              first_date: r.occurred_at,
              last_date: r.occurred_at,
              monthly_qty: { [monthKey]: qty },
              _sources: new Set([sourceId]),
              _clients: new Set([clientKey]),
            });
          }
        }
        if (rows.length < PAGE) break;
        from += PAGE;
      }
    }
    const consRows = [...consMap.values()].sort((a, b) => b.total_value - a.total_value);

    // ----- product info (products_index) -----
    interface ProdInfo {
      nome: string;
      codigo_interno: string | null;
      fornecedor_id: string | null;
      grupo: string | null;
      valor_custo: number | null;
    }
    const prodMap = new Map<string, ProdInfo>();
    {
      const ids = consRows.map((r) => r.produto_id);
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { data } = await supabase
          .from('products_index')
          .select('produto_id, nome, codigo_interno, fornecedor_id, payload_min_json')
          .in('produto_id', slice);
        for (const p of (data || []) as any[]) {
          const payload = p.payload_min_json || {};
          prodMap.set(p.produto_id, {
            nome: p.nome,
            codigo_interno: p.codigo_interno,
            fornecedor_id: p.fornecedor_id || null,
            grupo: payload.nome_grupo || null,
            valor_custo: payload.valor_custo ? parseFloat(payload.valor_custo) : null,
          });
        }
      }
    }

    // ----- lead times -----
    const ltMap = new Map<string, { avg: number; nome: string }>();
    {
      const { data } = await supabase
        .from('supplier_lead_times')
        .select('fornecedor_id, fornecedor_nome, avg_lead_time_days, sample_count')
        .gte('sample_count', 3);
      for (const lt of (data || []) as any[]) {
        ltMap.set(lt.fornecedor_id, { avg: Number(lt.avg_lead_time_days), nome: lt.fornecedor_nome });
      }
    }

    // ----- overrides -----
    const overrideMap = new Map<string, any>();
    {
      const { data } = await supabase.from('inventory_policy_overrides').select('*');
      for (const o of (data || []) as any[]) overrideMap.set(o.produto_id, o);
    }

    // ----- dados GC (estoque, PCs, orçamentos) -----
    const stockMap = await fetchAllStock(gcAccess, gcSecret);
    const pcMap = purchaseSituacaoIds.length ? await fetchOpenPurchases(purchaseSituacaoIds, gcAccess, gcSecret) : new Map<string, PCEntry>();
    const orcMap = budgetSituacaoIds.length ? await fetchPendingBudgets(budgetSituacaoIds, gcAccess, gcSecret) : new Map<string, OrcEntry>();

    // ----- motor -----
    const now = new Date();
    const monthKeys: string[] = [];
    for (let i = 0; i < POLICY.analysisMonths; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const totalValue = consRows.reduce((s, r) => s + r.total_value, 0);
    let cumulative = 0;
    const suggestions: any[] = [];

    for (const r of consRows) {
      cumulative += r.total_value;
      const pct = totalValue > 0 ? cumulative / totalValue : 0;
      const abcClass = pct <= thresholds.A ? 'A' : pct <= thresholds.B ? 'B' : 'C';

      const info = prodMap.get(r.produto_id);
      const override = overrideMap.get(r.produto_id);
      if (override?.do_not_stock) continue;

      const nome = info?.nome || `Produto ${r.produto_id}`;
      const unitCost = info?.valor_custo ?? (r.total_qty > 0 ? r.total_value / r.total_qty : 0);
      let isCritical = inferCriticality(nome);
      if (override?.criticality === 'critical') isCritical = true;
      if (override?.criticality === 'normal') isCritical = false;

      const monthlySeries = monthKeys.map((k) => r.monthly_qty?.[k] || 0);
      const recentSeries = monthlySeries.slice(0, POLICY.recentMonths);
      const historicalMonthlyAvg = monthlySeries.reduce((s, v) => s + v, 0) / monthlySeries.length;
      const recentMonthlyAvg = recentSeries.length ? recentSeries.reduce((s, v) => s + v, 0) / recentSeries.length : 0;
      const recentWeightedAvg = (recentSeries[0] || 0) * 0.5 + (recentSeries[1] || 0) * 0.3 + (recentSeries[2] || 0) * 0.2;

      const monthlyStdDev = stdDev(monthlySeries);
      const cv = historicalMonthlyAvg > 0 ? monthlyStdDev / historicalMonthlyAvg : 0;
      const nonZeroMonths = monthlySeries.filter((v) => v > 0).length;
      const adi = nonZeroMonths > 0 ? POLICY.analysisMonths / nonZeroMonths : 0;

      const xyzClass = cv <= 0.5 ? 'X' : cv <= 1.0 ? 'Y' : 'Z';
      const cv2 = cv * cv;
      let demandPattern: string;
      if (nonZeroMonths === 0) demandPattern = 'sem_demanda';
      else if (adi <= 1.32 && cv2 <= 0.49) demandPattern = 'regular';
      else if (adi > 1.32 && cv2 <= 0.49) demandPattern = 'intermitente';
      else if (adi <= 1.32 && cv2 > 0.49) demandPattern = 'erratica';
      else demandPattern = 'lumpy';

      const isRecurring =
        r.source_count >= POLICY.minRecurringSources ||
        r.event_count >= POLICY.minRecurringSources ||
        r.total_qty >= POLICY.minRecurringQty ||
        nonZeroMonths >= 2;

      const baseForecastMonthly = Math.max(historicalMonthlyAvg, recentWeightedAvg);
      let forecastMonthly: number;
      if (demandPattern === 'intermitente') forecastMonthly = Math.max(historicalMonthlyAvg, recentWeightedAvg * 0.7);
      else if (demandPattern === 'lumpy') forecastMonthly = historicalMonthlyAvg;
      else if (demandPattern === 'sem_demanda') forecastMonthly = 0;
      else forecastMonthly = baseForecastMonthly;

      const fornecedorId = override?.preferred_supplier_id || info?.fornecedor_id || null;
      const supplierLT = fornecedorId ? ltMap.get(fornecedorId) : null;
      let leadTimeDays = override?.lead_time_override_days
        ? Number(override.lead_time_override_days)
        : supplierLT ? supplierLT.avg : POLICY.defaultLeadTimeDays;
      leadTimeDays = Math.min(POLICY.maxLeadTimeDays, Math.max(POLICY.minLeadTimeDays, leadTimeDays));
      const fornecedorNome = supplierLT?.nome || null;
      const usedDefaultLT = !supplierLT && !override?.lead_time_override_days;

      const avgDailyDemand = forecastMonthly / 30;
      const stdDailyDemand = monthlyStdDev / 30;

      const z = isCritical ? POLICY.zScores.critical : POLICY.zScores[abcClass];
      let safetyStock = Math.ceil(z * stdDailyDemand * Math.sqrt(leadTimeDays));
      if (!Number.isFinite(safetyStock) || safetyStock < 0) safetyStock = 0;
      if (demandPattern === 'intermitente' || demandPattern === 'lumpy') {
        safetyStock = Math.min(safetyStock, getMaxShelfQtyByCost(unitCost, forecastMonthly));
      }

      let operationalMinimum = getOperationalMinimum(unitCost, isRecurring, isCritical);
      if (override?.min_qty_override != null) operationalMinimum = Math.max(operationalMinimum, Number(override.min_qty_override));

      const orcEntry = orcMap.get(r.produto_id);
      const orcQty = orcEntry?.qtd || 0;
      const budgetDemandQty = orcQty * POLICY.pendingBudgetDemandFactor;

      const pcEntry = pcMap.get(r.produto_id);
      const pcQty = pcEntry?.qtd || 0;
      const effectivePcQty = pcQty;

      const estoque = stockMap.has(r.produto_id) ? stockMap.get(r.produto_id)! : null;
      const stockKnown = estoque !== null && estoque !== undefined;
      const estoqueBase = stockKnown ? estoque! : 0;
      const projectedAvailable = stockKnown ? estoqueBase + effectivePcQty - budgetDemandQty : null;

      const demandDuringLeadTime = avgDailyDemand * leadTimeDays;
      let reorderPoint = Math.ceil(demandDuringLeadTime + safetyStock);
      reorderPoint = Math.max(reorderPoint, operationalMinimum);

      const coverageDays = getCoverageDaysByCost(unitCost);
      let maxStock = Math.ceil(avgDailyDemand * (leadTimeDays + coverageDays) + safetyStock);
      maxStock = Math.max(maxStock, operationalMinimum);
      if (override?.max_qty_override != null) maxStock = Number(override.max_qty_override);
      if (unitCost > POLICY.lowCostThresholds.moderate && demandPattern === 'lumpy' && !isCritical && budgetDemandQty <= 0 && override?.max_qty_override == null) {
        maxStock = 0;
      }

      const projForCompare = projectedAvailable ?? estoqueBase;
      const shouldReorder =
        projForCompare <= reorderPoint ||
        budgetDemandQty > estoqueBase ||
        (estoqueBase <= 0 && operationalMinimum > 0);

      let qtyToBuy = shouldReorder ? maxStock - projForCompare : 0;
      qtyToBuy = Math.max(0, Math.ceil(qtyToBuy));
      if (budgetDemandQty > 0) {
        qtyToBuy = Math.max(qtyToBuy, Math.ceil(budgetDemandQty - estoqueBase - effectivePcQty));
        qtyToBuy = Math.max(0, qtyToBuy);
      }

      // bloqueios anti-ruído
      const lastMs = r.last_date ? new Date(r.last_date).getTime() : 0;
      const daysSinceLast = lastMs ? (now.getTime() - lastMs) / 86400000 : Infinity;
      const staleDemand = daysSinceLast > POLICY.staleDemandDays;
      const oneOffDemand = r.source_count <= 1 && r.event_count <= 1 && nonZeroMonths <= 1;
      if (staleDemand && oneOffDemand && budgetDemandQty <= 0 && !isCritical) qtyToBuy = 0;
      if (oneOffDemand && budgetDemandQty <= 0 && !isCritical && !isRecurring && operationalMinimum === 0) qtyToBuy = 0;

      const qtyLiquida = Math.max(0, qtyToBuy - effectivePcQty);
      if (qtyLiquida <= 0) continue; // só persiste sugestões com necessidade líquida

      // motivos / alertas
      const motivos: string[] = [];
      const alertas: string[] = [];
      if (stockKnown && projForCompare <= reorderPoint) motivos.push('Estoque projetado abaixo do ponto de ressuprimento');
      if (stockKnown && estoqueBase <= 0) motivos.push('Estoque atual zerado');
      if (operationalMinimum > 0 && estoqueBase < operationalMinimum) motivos.push('Peça barata recorrente abaixo do mínimo operacional');
      if (budgetDemandQty > 0) motivos.push('Orçamento pendente gerou demanda prevista');
      if (safetyStock > 0 && leadTimeDays >= 21) motivos.push('Lead time do fornecedor exige estoque de segurança');
      if (recentWeightedAvg > historicalMonthlyAvg) motivos.push('Demanda recente maior que média histórica');
      if (demandPattern === 'intermitente') motivos.push('Demanda intermitente tratada com mínimo operacional');
      if (pcQty > 0 && effectivePcQty < reorderPoint) motivos.push('Pedido de compra em aberto insuficiente');
      if (motivos.length === 0) motivos.push('Necessidade de reposição calculada');
      if (!stockKnown) alertas.push('Estoque atual não carregado');
      if (!fornecedorId) alertas.push('Produto sem fornecedor');
      if (usedDefaultLT) alertas.push('Sem lead time do fornecedor, usado padrão');
      if (oneOffDemand) alertas.push('Demanda baseada em apenas um evento');
      if (staleDemand) alertas.push('Produto com demanda antiga');

      const riskScore =
        (projForCompare <= 0 ? 100 : 0) +
        (projForCompare <= reorderPoint ? 50 : 0) +
        (budgetDemandQty > estoqueBase ? 40 : 0) +
        (isCritical ? 30 : 0) +
        (leadTimeDays >= 30 ? 20 : 0) +
        (isRecurring ? 10 : 0);

      suggestions.push({
        run_id: runId,
        produto_id: r.produto_id,
        nome,
        codigo_interno: info?.codigo_interno || null,
        grupo: info?.grupo || null,
        fornecedor_id: fornecedorId,
        fornecedor_nome: fornecedorNome,
        valor_custo: info?.valor_custo ?? null,
        estoque_atual: estoque,
        stock_known: stockKnown,
        consumo_12m: r.total_qty,
        consumo_3m: recentSeries.reduce((s, v) => s + v, 0),
        event_count: r.event_count,
        source_count: r.source_count,
        client_count: r.client_count,
        media_historica_mensal: historicalMonthlyAvg,
        media_recente_mensal: recentMonthlyAvg,
        demanda_prevista_mensal: forecastMonthly,
        monthly_std_dev: monthlyStdDev,
        cv,
        adi,
        abc_class: abcClass,
        xyz_class: xyzClass,
        demand_pattern: demandPattern,
        is_critical: isCritical,
        lead_time_days: leadTimeDays,
        safety_stock: safetyStock,
        operational_minimum: operationalMinimum,
        reorder_point: reorderPoint,
        max_stock: maxStock,
        orcamento_qty: orcQty,
        orcamento_ponderado_qty: budgetDemandQty,
        pc_aberta_qty: pcQty,
        saldo_projetado: projectedAvailable,
        qty_sugerida: qtyLiquida,
        risk_score: riskScore,
        motivos,
        alertas,
      });
    }

    // ordena por risco e persiste
    suggestions.sort((a, b) => b.risk_score - a.risk_score);
    const CHUNK = 500;
    for (let i = 0; i < suggestions.length; i += CHUNK) {
      const { error: insErr } = await supabase.from('inventory_purchase_suggestions').insert(suggestions.slice(i, i + CHUNK));
      if (insErr) throw new Error('Erro inserindo sugestões: ' + insErr.message);
    }

    const totalEstimated = suggestions.reduce((s, x) => s + (x.qty_sugerida || 0) * (x.valor_custo || 0), 0);

    await supabase
      .from('inventory_planning_runs')
      .update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        lookback_days: effectiveLookback,
        products_analyzed: consRows.length,
        suggestions_count: suggestions.length,
        total_estimated_value: totalEstimated,
      })
      .eq('id', runId);

    return jsonResp({
      run_id: runId,
      products_analyzed: consRows.length,
      suggestions_count: suggestions.length,
      total_estimated_value: totalEstimated,
    });
  } catch (err) {
    console.error('inventory-planning-run error:', err);
    await supabase
      .from('inventory_planning_runs')
      .update({ status: 'error', finished_at: new Date().toISOString(), notes: err instanceof Error ? err.message : 'Erro', errors_count: 1 })
      .eq('id', runId);
    return jsonResp({ error: err instanceof Error ? err.message : 'Unknown error', run_id: runId }, 500);
  }
});
