import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { listOrdensCompra, listOrcamentos, getStatusOrcamentos } from '@/api/compras';
import { getOS, getVenda } from '@/api/gestaoclick';
import { GCOrcamento } from '@/api/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw, Download, AlertTriangle, TrendingUp, Package, PackageCheck, ShoppingCart, Clock, BarChart3, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// --- Types ---
interface SourceRef {
  source_id: string;
  source_type: string;
  qty: number;
  cliente: string;
}

interface ConsumptionRow {
  produto_id: string;
  total_qty: number;
  qty_venda: number;
  qty_os: number;
  qty_60d: number;
  total_value: number;
  event_count: number;
  source_count: number;
  client_count: number;
  event_count_90d: number;
  event_count_180d: number;
  source_count_90d: number;
  source_count_180d: number;
  first_date: string;
  last_date: string;
  consumption_value: number;
  source_refs: SourceRef[];
  monthly_qty: Record<string, number>;
}

interface ProductInfo {
  produto_id: string;
  nome: string;
  codigo_interno: string | null;
  fornecedor_id: string | null;
  grupo: string | null;
  valor_custo: number | null;
}

interface SupplierLeadTime {
  fornecedor_id: string;
  fornecedor_nome: string;
  avg_lead_time_days: number;
  min_lead_time_days: number;
  max_lead_time_days: number;
  sample_count: number;
}

interface PCRef {
  codigo: string;
  qtd: number;
  fornecedor: string;
  situacao: string;
}

interface PCEntry {
  qtd: number;
  refs: PCRef[];
}

interface OrcRef {
  codigo: string;
  qtd: number;
  cliente: string;
}

interface OrcEntry {
  qtd: number;
  refs: OrcRef[];
}

type ABCClass = 'A' | 'B' | 'C';
type XYZClass = 'X' | 'Y' | 'Z';
type DemandPattern = 'regular' | 'intermitente' | 'erratica' | 'lumpy' | 'sem_demanda';

type GiroClass = 'ALTO' | 'MEDIO' | 'BAIXO' | 'SEM_GIRO';
type StatusEstoque = 'COMPRAR_ESTOQUE' | 'REVISAR_MANUALMENTE' | 'NAO_ESTOCAR' | 'ESTOQUE_OK';

interface AnalysisItem {
  produto_id: string;
  nome: string;
  codigo_interno: string | null;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  grupo: string | null;
  valor_custo: number | null;

  total_qty: number;
  qty_venda: number;
  qty_os: number;
  qty_60d: number;
  total_value: number;
  event_count: number;
  source_count: number;
  client_count: number;
  event_count_90d: number;
  event_count_180d: number;
  source_count_90d: number;
  source_count_180d: number;
  non_zero_months_90d: number;
  non_zero_months_180d: number;
  days_since_last: number | null;

  historical_monthly_avg: number;
  recent_monthly_avg: number;
  forecast_monthly: number;
  monthly_std_dev: number;
  cv: number | null;
  adi: number | null;
  non_zero_months: number;

  classe_giro: GiroClass;
  status_estoque: StatusEstoque;


  abc_class: ABCClass;
  cumulative_pct: number;
  xyz_class: XYZClass;
  demand_pattern: DemandPattern;
  is_critical: boolean;
  is_recurring: boolean;

  estoque_atual: number | null;
  stock_known: boolean;
  pc_qty: number;
  effective_pc_qty: number;
  orc_qty: number;
  budget_demand_qty: number;
  projected_available: number | null;

  avg_daily: number;
  lead_time_days: number;
  safety_stock: number;
  operational_minimum: number;
  reorder_point: number;
  max_stock: number;
  dias_cobertura: number | null;

  qty_a_comprar: number;
  qty_liquida: number;

  stock_demand_qty: number;
  budget_signal_qty: number;
  suggested_qty: number;
  is_stock_eligible: boolean;
  budget_without_giro: boolean;


  risk_score: number;
  motivos_sugestao: string[];
  alertas: string[];

  pc_refs: PCRef[];
  orc_refs: OrcRef[];
  source_refs: SourceRef[];
}

type AnalysisTab = 'compras' | 'orcsemgiro' | 'recorrenteok' | 'ranking' | 'leadtime' | 'trend';

// ============================================================================
// POLÍTICA DE REPOSIÇÃO — parâmetros centralizados e fáceis de ajustar.
// (Pode futuramente vir de inventory_policy_config.)
// ============================================================================
const POLICY = {
  analysisMonths: 12,
  minAnalysisMonths: 6,
  recentMonths: 3,
  reviewPeriodDays: 30,

  defaultLeadTimeDays: 21,
  minLeadTimeDays: 7,
  maxLeadTimeDays: 90,

  serviceLevels: { critical: 0.98, A: 0.95, B: 0.90, C: 0.85 },
  zScores: { critical: 2.05, A: 1.65, B: 1.28, C: 1.04 } as Record<string, number>,

  lowCostThresholds: { veryLow: 30, low: 80, medium: 200, moderate: 500 },
  minShelfByCost: { veryLow: 6, low: 4, medium: 2, moderate: 1 },
  maxCoverageDaysByCost: { veryLow: 90, low: 75, medium: 60, moderate: 45, high: 30 },

  staleDemandDays: 365,
  stalePurchaseOrderDays: 90,

  pendingBudgetDemandFactor: 0.70,
  approvedBudgetDemandFactor: 1.00,

  minRecurringSources: 2,
  minRecurringQty: 2,
};

const CRITICAL_KEYWORDS = [
  'placa', 'controlador', 'compressor', 'contator', 'rele', 'relé', 'termostato',
  'sensor', 'resistencia', 'resistência', 'motor', 'bomba', 'ventilador', 'micro',
  'chave', 'rolamento', 'retentor', 'correia', 'mangueira', 'vedacao', 'vedação',
  'valvula', 'válvula',
];

// Futuramente: tabela manual inventory_criticality_overrides
//   (produto_id, criticality: 'critical'|'normal'|'do_not_stock', min_qty_override, max_qty_override, notes)
function inferCriticality(nome: string): boolean {
  const name = (nome || '').toLowerCase();
  return CRITICAL_KEYWORDS.some(k => name.includes(k));
}

// Mínimo de prateleira puro por custo (independe de recorrência).
function getMinShelfQty(unitCost: number): number {
  const t = POLICY.lowCostThresholds;
  const m = POLICY.minShelfByCost;
  if (unitCost > 0 && unitCost <= t.veryLow) return m.veryLow;
  if (unitCost <= t.low) return m.low;
  if (unitCost <= t.medium) return m.medium;
  return 1;
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

// Teto de estoque de segurança por custo, para itens intermitentes/lumpy não explodirem.
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

const ANALYSIS_FILTER_STORAGE_KEY = 'inventory-analysis-filters';
const ALL_GROUPS_VALUE = '__all__';
const DEFAULT_ANALYSIS_TAB: AnalysisTab = 'compras';

const readPersistedAnalysisFilters = () => {
  if (typeof window === 'undefined') {
    return { searchTerm: '', grupoFilter: ALL_GROUPS_VALUE };
  }

  try {
    const raw = window.localStorage.getItem(ANALYSIS_FILTER_STORAGE_KEY);
    if (!raw) {
      return { searchTerm: '', grupoFilter: ALL_GROUPS_VALUE };
    }

    const parsed = JSON.parse(raw);
    return {
      searchTerm: typeof parsed?.searchTerm === 'string' ? parsed.searchTerm : '',
      grupoFilter: typeof parsed?.grupoFilter === 'string' ? parsed.grupoFilter : ALL_GROUPS_VALUE,
    };
  } catch {
    return { searchTerm: '', grupoFilter: ALL_GROUPS_VALUE };
  }
};

const matchesAnalysisFilters = (item: AnalysisItem, searchTerm: string, grupoFilter: string) => {
  if (grupoFilter !== ALL_GROUPS_VALUE && (item.grupo || 'Sem grupo') !== grupoFilter) {
    return false;
  }

  const query = searchTerm.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return (
    item.nome.toLowerCase().includes(query) ||
    item.codigo_interno?.toLowerCase().includes(query) ||
    item.produto_id.toLowerCase().includes(query)
  );
};

const normalizeGroupName = (value: string | null | undefined) =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const isSpecificProductGroup = (grupo: string | null | undefined) =>
  normalizeGroupName(grupo).startsWith('especifico');

// --- Data fetchers ---
async function fetchAllRows(
  table: string,
  select: string,
  filters?: { gte?: [string, string] },
): Promise<any[]> {
  const PAGE_SIZE = 1000;
  let allRows: any[] = [];
  let from = 0;
  while (true) {
    let query = supabase
      .from(table as any)
      .select(select)
      .range(from, from + PAGE_SIZE - 1)
      .order('occurred_at', { ascending: true });
    if (filters?.gte) {
      query = query.gte(filters.gte[0], filters.gte[1]);
    }
    const { data, error } = await query;
    if (error) throw error;
    const rows = data as any[] || [];
    allRows = allRows.concat(rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allRows;
}

async function fetchConsumptionAgg(lookbackDays: number, salesWindowDays: number = 60): Promise<ConsumptionRow[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString();

  const now = Date.now();
  const cut60 = now - salesWindowDays * 86400000;
  const cut90 = now - 90 * 86400000;
  const cut180 = now - 180 * 86400000;

  const rows = await fetchAllRows(
    'inventory_consumption_events',
    'produto_id, qty, valor_custo, occurred_at, source_id, source_type, cliente_nome',
    { gte: ['occurred_at', cutoffStr] },
  );

  // Chave de agregação EXCLUSIVAMENTE por produto_id (sem variacao_id / item_key).
  type Internal = ConsumptionRow & {
    _sources: Set<string>; _clients: Set<string>; _sourceRefs: Map<string, SourceRef>;
    _sources90: Set<string>; _sources180: Set<string>;
  };
  const map = new Map<string, Internal>();
  for (const r of rows) {
    const key = r.produto_id;
    if (!key || key.trim() === '') continue;
    const qty = parseFloat(r.qty) || 0;
    const val = (parseFloat(r.valor_custo) || 0) * qty;
    const sourceId = r.source_id || '';
    const sourceType = r.source_type || '';
    const cliente = r.cliente_nome || '';
    const clientKey = (cliente || sourceId).toLowerCase().trim();
    const existing = map.get(key);
    const monthKey = (r.occurred_at || '').slice(0, 7); // YYYY-MM
    const occMs = r.occurred_at ? new Date(r.occurred_at).getTime() : 0;
    const in90 = occMs >= cut90;
    const in180 = occMs >= cut180;
    const in60 = occMs >= cut60;
    if (existing) {
      existing.total_qty += qty;
      if (sourceType === 'venda') existing.qty_venda += qty; else existing.qty_os += qty;
      if (in60) existing.qty_60d += qty;
      existing.total_value += val;
      existing.event_count += 1;
      if (in90) existing.event_count_90d += 1;
      if (in180) existing.event_count_180d += 1;
      existing._sources.add(sourceId);
      existing._clients.add(clientKey);
      if (in90) existing._sources90.add(sourceId);
      if (in180) existing._sources180.add(sourceId);
      existing.source_count = existing._sources.size;
      existing.client_count = existing._clients.size;
      existing.source_count_90d = existing._sources90.size;
      existing.source_count_180d = existing._sources180.size;
      if (r.occurred_at < existing.first_date) existing.first_date = r.occurred_at;
      if (r.occurred_at > existing.last_date) existing.last_date = r.occurred_at;
      existing.monthly_qty[monthKey] = (existing.monthly_qty[monthKey] || 0) + qty;
      const existingRef = existing._sourceRefs.get(sourceId);
      if (existingRef) {
        existingRef.qty += qty;
      } else {
        existing._sourceRefs.set(sourceId, { source_id: sourceId, source_type: sourceType, qty, cliente });
      }
    } else {
      const refMap = new Map<string, SourceRef>();
      refMap.set(sourceId, { source_id: sourceId, source_type: sourceType, qty, cliente });
      map.set(key, {
        produto_id: r.produto_id,
        total_qty: qty,
        qty_venda: sourceType === 'venda' ? qty : 0,
        qty_os: sourceType === 'venda' ? 0 : qty,
        qty_60d: in60 ? qty : 0,
        total_value: val,
        event_count: 1,
        source_count: 1,
        client_count: 1,
        event_count_90d: in90 ? 1 : 0,
        event_count_180d: in180 ? 1 : 0,
        source_count_90d: in90 ? 1 : 0,
        source_count_180d: in180 ? 1 : 0,
        first_date: r.occurred_at,
        last_date: r.occurred_at,
        consumption_value: 0,
        source_refs: [],
        monthly_qty: { [monthKey]: qty },
        _sources: new Set([sourceId]),
        _clients: new Set([clientKey]),
        _sources90: in90 ? new Set([sourceId]) : new Set<string>(),
        _sources180: in180 ? new Set([sourceId]) : new Set<string>(),
        _sourceRefs: refMap,
      });
    }
  }

  for (const row of map.values()) {
    row.source_refs = [...row._sourceRefs.values()];
    row.consumption_value = row.total_value; // valor de consumo (custo × qtd) p/ ABC
  }

  const filtered = [...map.values()].filter(r => r.event_count >= 1);
  return filtered.sort((a, b) => b.consumption_value - a.consumption_value);
}

async function fetchTrendData(): Promise<any[]> {
  return fetchAllRows(
    'inventory_consumption_events',
    'produto_id, qty, occurred_at',
  );
}

async function fetchProductNames(ids: string[]): Promise<Map<string, ProductInfo>> {
  const map = new Map<string, ProductInfo>();
  if (ids.length === 0) return map;
  // PostgREST tem limite de tamanho de URL: com centenas de IDs a query .in()
  // estoura e retorna parcial/vazio. Buscar em lotes evita nomes faltando.
  const CHUNK = 150;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data } = await supabase
      .from('products_index')
      .select('produto_id, nome, codigo_interno, fornecedor_id, payload_min_json')
      .in('produto_id', chunk);
    for (const p of (data || [])) {
      const payload = (p as any).payload_min_json;
      const grupo = payload?.nome_grupo || null;
      const valorCusto = payload?.valor_custo ? parseFloat(payload.valor_custo) : null;
      map.set(p.produto_id, { produto_id: p.produto_id, nome: p.nome, codigo_interno: p.codigo_interno, fornecedor_id: (p as any).fornecedor_id || null, grupo, valor_custo: valorCusto });
    }
  }
  return map;
}


async function fetchConfig() {
  const { data } = await supabase
    .from('inventory_policy_config' as any)
    .select('lookback_days, sales_window_days, abc_thresholds, purchase_crossref_situacao_ids, budget_crossref_situacao_ids')
    .order('created_at', { ascending: false })
    .limit(1);
  return (data as any[])?.[0] || { lookback_days: 180, sales_window_days: 60, abc_thresholds: { A: 0.8, B: 0.95 }, purchase_crossref_situacao_ids: [] };
}

async function fetchSupplierLeadTimes(): Promise<SupplierLeadTime[]> {
  const { data, error } = await supabase
    .from('supplier_lead_times' as any)
    .select('fornecedor_id, fornecedor_nome, avg_lead_time_days, min_lead_time_days, max_lead_time_days, sample_count')
    .gte('sample_count', 3)
    .order('avg_lead_time_days', { ascending: false });
  if (error) return [];
  return ((data as any[]) || []).filter(lt => Number(lt.sample_count) >= 3);
}

export default function InventoryAnalysisPage() {
  const [initialFilters] = useState(readPersistedAnalysisFilters);
  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map());
  const [movMap, setMovMap] = useState<Map<string, boolean>>(new Map());
  const [pcMap, setPcMap] = useState<Map<string, PCEntry>>(new Map());
  const [orcMap, setOrcMap] = useState<Map<string, OrcEntry>>(new Map());
  const [loadingStock, setLoadingStock] = useState(false);
  const [loadingPCs, setLoadingPCs] = useState(false);
  const [loadingOrcs, setLoadingOrcs] = useState(false);
  const [stockProgress, setStockProgress] = useState({ done: 0, total: 0 });
  const [searchTerm, setSearchTerm] = useState(initialFilters.searchTerm);
  const [grupoFilter, setGrupoFilter] = useState<string>(initialFilters.grupoFilter);
  const [activeTab, setActiveTab] = useState<AnalysisTab>(DEFAULT_ANALYSIS_TAB);
  const [syncingLT, setSyncingLT] = useState(false);
  const [docCodigoMap, setDocCodigoMap] = useState<Map<string, string>>(new Map());

  const configQuery = useQuery({ queryKey: ['inv-config'], queryFn: fetchConfig });
  const thresholds = configQuery.data?.abc_thresholds || { A: 0.8, B: 0.95 };
  const lookbackDays = configQuery.data?.lookback_days || 180;
  const salesWindowDays = configQuery.data?.sales_window_days || 60;
  const crossrefSituacaoIds: string[] = configQuery.data?.purchase_crossref_situacao_ids || [];
  const budgetSituacaoIds: string[] = configQuery.data?.budget_crossref_situacao_ids || [];

  // A análise de demanda precisa cobrir a janela completa (analysisMonths), mesmo
  // que o lookback configurado seja menor.
  const effectiveLookback = Math.max(lookbackDays, POLICY.analysisMonths * 31);

  const consumptionQuery = useQuery({
    queryKey: ['inv-consumption', effectiveLookback, salesWindowDays],
    queryFn: () => fetchConsumptionAgg(effectiveLookback, salesWindowDays),
    enabled: !!configQuery.data,
  });
  const trendQuery = useQuery({ queryKey: ['inv-trend'], queryFn: fetchTrendData });
  const leadTimesQuery = useQuery({ queryKey: ['supplier-lead-times'], queryFn: fetchSupplierLeadTimes });
  
  const productIds = useMemo(() => (consumptionQuery.data || []).map(r => r.produto_id), [consumptionQuery.data]);
  const namesQuery = useQuery({
    queryKey: ['inv-names', productIds.join(',')],
    queryFn: () => fetchProductNames(productIds),
    enabled: productIds.length > 0,
  });

  // Build supplier lead time lookup map (fornecedor_id → lead time data)
  const supplierLTMap = useMemo(() => {
    const map = new Map<string, SupplierLeadTime>();
    for (const lt of (leadTimesQuery.data || [])) {
      map.set(lt.fornecedor_id, lt);
    }
    return map;
  }, [leadTimesQuery.data]);

  // Fallback lead time (median of all suppliers, not average — more robust)
  const fallbackLeadTime = useMemo(() => {
    const lts = leadTimesQuery.data || [];
    if (lts.length === 0) return 14;
    const sorted = [...lts].sort((a, b) => a.avg_lead_time_days - b.avg_lead_time_days);
    const mid = Math.floor(sorted.length / 2);
    return Math.round(sorted.length % 2 ? sorted[mid].avg_lead_time_days : (sorted[mid - 1].avg_lead_time_days + sorted[mid].avg_lead_time_days) / 2);
  }, [leadTimesQuery.data]);

  // ===========================================================================
  // MOTOR DE PLANEJAMENTO POR PRODUTO_ID (estilo ERP/EAM).
  // Todos os cruzamentos (estoque, PC, orçamento, consumo) por produto_id.
  // ===========================================================================
  const analysisItems: AnalysisItem[] = useMemo(() => {
    const rows = consumptionQuery.data || [];
    const names = namesQuery.data || new Map();
    if (rows.length === 0) return [];

    // --- ABC clássico por valor de consumo (custo × qtd) ---
    const totalValue = rows.reduce((s, r) => s + r.consumption_value, 0);
    let cumulative = 0;

    // Pré-computar as chaves dos últimos analysisMonths meses (mais recente primeiro).
    const now = new Date();
    const monthKeys: string[] = [];
    for (let i = 0; i < POLICY.analysisMonths; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    return rows.map((r): AnalysisItem => {
      cumulative += r.consumption_value;
      const pct = totalValue > 0 ? cumulative / totalValue : 0;
      const abcClass: ABCClass = pct <= thresholds.A ? 'A' : pct <= thresholds.B ? 'B' : 'C';

      const info = names.get(r.produto_id);
      const nome = info?.nome || `Produto ${r.produto_id}`;
      const unitCost = info?.valor_custo ?? (r.total_qty > 0 ? r.total_value / r.total_qty : 0);
      const isCritical = inferCriticality(nome);

      // --- Séries mensais (incluindo zeros) ---
      const monthlySeries = monthKeys.map(k => r.monthly_qty?.[k] || 0); // 12 meses (recente→antigo)
      const recentSeries = monthlySeries.slice(0, POLICY.recentMonths);
      const historicalMonthlyAvg = monthlySeries.reduce((s, v) => s + v, 0) / monthlySeries.length;
      const recentMonthlyAvg = recentSeries.length
        ? recentSeries.reduce((s, v) => s + v, 0) / recentSeries.length
        : 0;
      // média ponderada recente: mês atual 0.5, anterior 0.3, dois meses atrás 0.2
      const recentWeightedAvg =
        (recentSeries[0] || 0) * 0.5 +
        (recentSeries[1] || 0) * 0.3 +
        (recentSeries[2] || 0) * 0.2;

      const monthlyStdDev = stdDev(monthlySeries);
      const cv = historicalMonthlyAvg > 0 ? monthlyStdDev / historicalMonthlyAvg : null;
      const nonZeroMonths = monthlySeries.filter(v => v > 0).length;
      const adi = nonZeroMonths > 0 ? POLICY.analysisMonths / nonZeroMonths : null;

      // --- Classe de GIRO (recorrência real, separada do ABC financeiro) ---
      const nonZeroMonths90 = monthlySeries.slice(0, 3).filter(v => v > 0).length;
      const nonZeroMonths180 = monthlySeries.slice(0, 6).filter(v => v > 0).length;
      const lastMsGiro = r.last_date ? new Date(r.last_date).getTime() : 0;
      const daysSinceLast = lastMsGiro ? Math.round((now.getTime() - lastMsGiro) / 86400000) : null;
      let classeGiro: GiroClass;
      if (r.source_count_90d >= 3 || nonZeroMonths90 >= 2) classeGiro = 'ALTO';
      else if (r.source_count_180d >= 2 || nonZeroMonths180 >= 2) classeGiro = 'MEDIO';
      else if (r.event_count_180d >= 1) classeGiro = 'BAIXO';
      else classeGiro = 'SEM_GIRO';

      // --- XYZ ---
      const cvVal = cv ?? 0;
      const xyzClass: XYZClass = cvVal <= 0.5 ? 'X' : cvVal <= 1.0 ? 'Y' : 'Z';

      // --- Padrão de demanda ---
      const cv2 = cvVal * cvVal;
      let demandPattern: DemandPattern;
      if (nonZeroMonths === 0) demandPattern = 'sem_demanda';
      else if (adi! <= 1.32 && cv2 <= 0.49) demandPattern = 'regular';
      else if (adi! > 1.32 && cv2 <= 0.49) demandPattern = 'intermitente';
      else if (adi! <= 1.32 && cv2 > 0.49) demandPattern = 'erratica';
      else demandPattern = 'lumpy';

      // --- Recorrência ---
      const isRecurring =
        r.source_count >= POLICY.minRecurringSources ||
        r.event_count >= POLICY.minRecurringSources ||
        r.total_qty >= POLICY.minRecurringQty ||
        nonZeroMonths >= 2;

      // --- Previsão de demanda mensal por padrão ---
      const baseForecastMonthly = Math.max(historicalMonthlyAvg, recentWeightedAvg);
      let forecastMonthly: number;
      if (demandPattern === 'intermitente') forecastMonthly = Math.max(historicalMonthlyAvg, recentWeightedAvg * 0.7);
      else if (demandPattern === 'lumpy') forecastMonthly = historicalMonthlyAvg;
      else if (demandPattern === 'sem_demanda') forecastMonthly = 0;
      else forecastMonthly = baseForecastMonthly; // regular / erratica

      // --- Lead time (por fornecedor; senão padrão), com limites ---
      const fornecedorId = info?.fornecedor_id || null;
      const supplierLT = fornecedorId ? supplierLTMap.get(fornecedorId) : null;
      let leadTimeDays = supplierLT ? supplierLT.avg_lead_time_days : POLICY.defaultLeadTimeDays;
      leadTimeDays = Math.min(POLICY.maxLeadTimeDays, Math.max(POLICY.minLeadTimeDays, leadTimeDays));
      const fornecedorNome = supplierLT?.fornecedor_nome || null;
      const usedDefaultLT = !supplierLT;

      // --- Demanda diária ---
      const avgDailyDemand = forecastMonthly / 30;
      const stdDailyDemand = monthlyStdDev / 30;

      // --- Estoque de segurança ---
      const z = isCritical ? POLICY.zScores.critical : POLICY.zScores[abcClass];
      let safetyStock = Math.ceil(z * stdDailyDemand * Math.sqrt(leadTimeDays));
      if (!Number.isFinite(safetyStock) || safetyStock < 0) safetyStock = 0;
      // teto por custo para demanda intermitente/lumpy não explodir
      if (demandPattern === 'intermitente' || demandPattern === 'lumpy') {
        safetyStock = Math.min(safetyStock, getMaxShelfQtyByCost(unitCost, forecastMonthly));
      }

      // --- Mínimo operacional (peça barata recorrente / crítica) ---
      const operationalMinimum = getOperationalMinimum(unitCost, isRecurring, isCritical);

      // --- Sinal de orçamento pendente (situações escolhidas) ---
      const orcEntry = orcMap.get(r.produto_id);
      const orcQty = orcEntry?.qtd || 0;
      const orcRefs = orcEntry?.refs || [];
      // sistema não diferencia aprovado/pendente → usa fator pendente (configurável)
      const budgetSignalQty = orcQty * POLICY.pendingBudgetDemandFactor;
      const budgetDemandQty = budgetSignalQty; // compat. com saldo projetado

      // --- Pedido de compra em aberto ---
      const pcEntry = pcMap.get(r.produto_id);
      const pcQty = pcEntry?.qtd || 0;
      const pcRefs = pcEntry?.refs || [];
      const effectivePcQty = pcQty;

      // --- Estoque e saldo projetado ---
      const estoque = stockMap.get(r.produto_id) ?? null;
      const stockKnown = estoque !== null && estoque !== undefined;
      const estoqueBase = stockKnown ? estoque! : 0;
      const projectedAvailable = stockKnown
        ? estoqueBase + effectivePcQty - budgetSignalQty
        : null;

      // --- Ponto de ressuprimento (informativo) ---
      const demandDuringLeadTime = avgDailyDemand * leadTimeDays;
      let reorderPoint = Math.ceil(demandDuringLeadTime + safetyStock);
      reorderPoint = Math.max(reorderPoint, operationalMinimum);

      // --- Estoque máximo alvo = nível de demanda de estoque (consumo real) ---
      const coverageDays = getCoverageDaysByCost(unitCost);
      const minShelfQty = getMinShelfQty(unitCost);
      let maxStock = Math.ceil(avgDailyDemand * (leadTimeDays + coverageDays) + safetyStock);
      maxStock = Math.max(maxStock, operationalMinimum);

      // ===================================================================
      // ELEGIBILIDADE PARA ESTOQUE (giro real, não dinheiro)
      // ===================================================================
      const totalQty90d = monthlySeries.slice(0, 3).reduce((s, v) => s + v, 0);
      const totalQty180d = monthlySeries.slice(0, 6).reduce((s, v) => s + v, 0);
      const lastMs = r.last_date ? new Date(r.last_date).getTime() : 0;
      const daysSinceLastConsumption = lastMs ? (now.getTime() - lastMs) / 86400000 : Infinity;

      // sem overrides manuais no cliente → manualStockItem/manualMinStock = false
      const manualStockItem = false;
      const manualMinStock = 0;
      const hasManual = manualStockItem || manualMinStock > 0;

      const hasRecentConsumption = totalQty90d > 0 || daysSinceLastConsumption <= 90;
      const isRecurringStock =
        r.source_count_90d >= 2 ||
        r.source_count_180d >= 3 ||
        nonZeroMonths180 >= 2 ||
        totalQty180d >= minShelfQty;

      // --- Reposição REATIVA ---
      // Item controlado por estoque no GC (movimenta_estoque = 1) que caiu a zero / abaixo
      // do ponto de ressuprimento: precisa repor o que saiu, mesmo sem recorrência de
      // múltiplos clientes. PORÉM só é reativo se a peça REALMENTE girou recentemente
      // OU se zerou de fato. Um equipamento parado há meses (sem consumo recente) e com
      // estoque > 0 NÃO deve ser sugerido só porque o ROP calculado sobre uma venda antiga
      // ficou acima do estoque atual.
      const isInventoryItem = movMap.get(r.produto_id) === true;
      const inventoryNeedsRestock =
        isInventoryItem &&
        stockKnown &&
        r.event_count >= 1 &&
        estoqueBase <= reorderPoint &&
        (hasRecentConsumption || estoqueBase <= 0);


      const isStockEligible = (hasRecentConsumption && isRecurringStock) || hasManual || inventoryNeedsRestock;

      const oneEventOnly = r.event_count <= 1;
      const expensiveOneOff = unitCost > 500 && oneEventOnly && !hasManual;

      // --- Demanda de estoque (consumo real) e demanda total ---
      // Item elegível apenas por reposição reativa (zerou, sem recorrência) usa um piso
      // enxuto (repõe o essencial) em vez do mínimo de prateleira preventivo.
      const reactiveOnly =
        inventoryNeedsRestock && !((hasRecentConsumption && isRecurringStock) || hasManual);
      const shelfFloor = reactiveOnly ? Math.max(operationalMinimum, 1) : minShelfQty;
      const stockDemandQty = isStockEligible ? Math.max(maxStock, shelfFloor) : 0;
      // orçamento NÃO soma cego: usa max com a demanda de estoque, e só p/ elegíveis
      const demandaTotal = isStockEligible ? Math.max(stockDemandQty, budgetSignalQty) : 0;

      let suggestedQty = isStockEligible
        ? Math.max(0, Math.ceil(demandaTotal - estoqueBase - effectivePcQty))
        : 0;

      // --- Lote mínimo / múltiplo de compra (se existirem no cadastro) ---
      const minOrderQty = Number((info as any)?.min_order_qty || 0) || 0;
      const orderMultiple = Number((info as any)?.order_multiple || 0) || 0;
      if (suggestedQty > 0 && minOrderQty > 0) suggestedQty = Math.max(suggestedQty, minOrderQty);
      if (suggestedQty > 0 && orderMultiple > 0) suggestedQty = Math.ceil(suggestedQty / orderMultiple) * orderMultiple;

      const staleDemand = daysSinceLastConsumption > POLICY.staleDemandDays;
      const oneOffDemand = r.source_count <= 1 && r.event_count <= 1 && nonZeroMonths <= 1;

      // item em orçamento pendente mas sem giro → não compra automática (aba separada)
      const budgetWithoutGiro = budgetSignalQty > 0 && !isStockEligible;

      let qtyToBuy = suggestedQty;

      // === STATUS DE ESTOQUE ===
      let statusEstoque: StatusEstoque;
      if (!isStockEligible) {
        qtyToBuy = 0;
        statusEstoque = (expensiveOneOff || (unitCost > 500 && oneEventOnly))
          ? 'REVISAR_MANUALMENTE'
          : 'NAO_ESTOCAR';
      } else {
        statusEstoque = qtyToBuy > 0 ? 'COMPRAR_ESTOQUE' : 'ESTOQUE_OK';
      }

      const projForCompare = projectedAvailable ?? estoqueBase;

      // --- Motivos e alertas ---
      const motivos: string[] = [];
      const alertas: string[] = [];
      if (qtyToBuy > 0) {
        if (hasRecentConsumption && isRecurringStock) motivos.push('Peça recorrente com consumo recente');
        if (stockKnown && estoqueBase <= 0) motivos.push('Estoque atual zerado');
        if (stockKnown && estoqueBase < stockDemandQty) motivos.push('Estoque abaixo do mínimo calculado');
        if (budgetSignalQty > 0) motivos.push('Orçamento pendente aumentou risco');
        if (reactiveOnly) motivos.push('Item de estoque zerou após saída — repor o vendido');
        if (pcQty > 0 && effectivePcQty < demandaTotal) motivos.push('Pedido de compra em aberto insuficiente');
        // Lead time entra no cálculo do estoque de segurança, mas não deve aparecer como motivo textual na lista.
        if (motivos.length === 0) motivos.push('Necessidade de reposição calculada');
      }
      if (!stockKnown) alertas.push('Sem estoque atual carregado');
      // Lead time real = intervalo entre a SITUAÇÃO DE INÍCIO do pedido de compra
      // e a DATA DE ENTRADA no estoque daquele pedido (Fase 4). Sem aviso de fallback aqui.
      if (staleDemand) alertas.push('Produto com demanda antiga');
      if (budgetWithoutGiro) {
        alertas.push('Produto em orçamento pendente, mas sem giro recorrente. Não comprar automaticamente.');
      }
      if (statusEstoque === 'REVISAR_MANUALMENTE') {
        alertas.push('Item de alto valor com apenas um evento. ABC financeiro não autoriza estoque automático.');
        motivos.push('ABC financeiro = ' + abcClass + ', giro = ' + classeGiro + ' → revisar manualmente');
      } else if (statusEstoque === 'NAO_ESTOCAR') {
        motivos.push('Sem giro recorrente (' + classeGiro + ') → não estocar automaticamente');
      }

      // --- Risco operacional (ordenação) ---
      const stockoutRisk = (projForCompare <= 0) ? 100 : 0;
      const belowRopRisk = (projForCompare <= reorderPoint) ? 50 : 0;
      const budgetRisk = (budgetDemandQty > estoqueBase) ? 40 : 0;
      const criticalityRisk = isCritical ? 30 : 0;
      const leadTimeRisk = leadTimeDays >= 30 ? 20 : 0;
      const recurrenceRisk = isRecurring ? 10 : 0;
      const riskScore = stockoutRisk + belowRopRisk + budgetRisk + criticalityRisk + leadTimeRisk + recurrenceRisk;

      const avgDaily = avgDailyDemand;
      const diasCobertura = stockKnown && avgDaily > 0 ? estoqueBase / avgDaily : null;
      const qtyLiquida = qtyToBuy; // suggestedQty já líquido de PC em aberto

      return {
        produto_id: r.produto_id,
        nome,
        codigo_interno: info?.codigo_interno || null,
        fornecedor_id: fornecedorId,
        fornecedor_nome: fornecedorNome,
        grupo: info?.grupo || null,
        valor_custo: info?.valor_custo ?? null,

        total_qty: r.total_qty,
        qty_venda: r.qty_venda,
        qty_os: r.qty_os,
        qty_60d: r.qty_60d,
        total_value: r.total_value,
        event_count: r.event_count,
        source_count: r.source_count,
        client_count: r.client_count,
        event_count_90d: r.event_count_90d,
        event_count_180d: r.event_count_180d,
        source_count_90d: r.source_count_90d,
        source_count_180d: r.source_count_180d,
        non_zero_months_90d: nonZeroMonths90,
        non_zero_months_180d: nonZeroMonths180,
        days_since_last: daysSinceLast,

        classe_giro: classeGiro,
        status_estoque: statusEstoque,


        historical_monthly_avg: historicalMonthlyAvg,
        recent_monthly_avg: recentMonthlyAvg,
        forecast_monthly: forecastMonthly,
        monthly_std_dev: monthlyStdDev,
        cv,
        adi,
        non_zero_months: nonZeroMonths,

        abc_class: abcClass,
        cumulative_pct: pct,
        xyz_class: xyzClass,
        demand_pattern: demandPattern,
        is_critical: isCritical,
        is_recurring: isRecurring,

        estoque_atual: estoque,
        stock_known: stockKnown,
        pc_qty: pcQty,
        effective_pc_qty: effectivePcQty,
        orc_qty: orcQty,
        budget_demand_qty: budgetDemandQty,
        projected_available: projectedAvailable,

        avg_daily: avgDaily,
        lead_time_days: leadTimeDays,
        safety_stock: safetyStock,
        operational_minimum: operationalMinimum,
        reorder_point: reorderPoint,
        max_stock: maxStock,
        dias_cobertura: diasCobertura,

        qty_a_comprar: qtyToBuy,
        qty_liquida: qtyLiquida,

        stock_demand_qty: stockDemandQty,
        budget_signal_qty: budgetSignalQty,
        suggested_qty: qtyToBuy,
        is_stock_eligible: isStockEligible,
        budget_without_giro: budgetWithoutGiro,


        risk_score: riskScore,
        motivos_sugestao: motivos,
        alertas,

        pc_refs: pcRefs,
        orc_refs: orcRefs,
        source_refs: r.source_refs || [],
      };
    });
  }, [consumptionQuery.data, namesQuery.data, stockMap, movMap, pcMap, orcMap, thresholds, supplierLTMap]);

  // Unique groups for filter
  const uniqueGrupos = useMemo(() => {
    const set = new Set<string>();
    for (const i of analysisItems) {
      if (i.grupo) set.add(i.grupo);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [analysisItems]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.setItem(
        ANALYSIS_FILTER_STORAGE_KEY,
        JSON.stringify({ searchTerm, grupoFilter }),
      );
    } catch {
      // ignore persistence failures
    }
  }, [searchTerm, grupoFilter]);

  // Resolve internal doc IDs (source_id) → visible codigo (4-digit OS / Venda).
  // Fetches via gc-proxy with limited concurrency and caches in docCodigoMap.
  useEffect(() => {
    if (analysisItems.length === 0) return;
    const pending: Array<{ id: string; type: string }> = [];
    const seen = new Set<string>();
    for (const it of analysisItems) {
      for (const r of it.source_refs) {
        if (!r.source_id) continue;
        if (r.source_type !== 'os' && r.source_type !== 'venda') continue;
        const key = `${r.source_type}:${r.source_id}`;
        if (seen.has(key) || docCodigoMap.has(key)) continue;
        seen.add(key);
        pending.push({ id: r.source_id, type: r.source_type });
      }
    }
    if (pending.length === 0) return;

    let cancelled = false;
    (async () => {
      const CONCURRENCY = 4;
      const updates = new Map<string, string>();
      let cursor = 0;
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (!cancelled && cursor < pending.length) {
          const item = pending[cursor++];
          try {
            const doc = item.type === 'os'
              ? await getOS(item.id)
              : await getVenda(item.id);
            if (doc?.codigo) {
              updates.set(`${item.type}:${item.id}`, String(doc.codigo));
            }
          } catch {
            // ignore individual failures
          }
        }
      });
      await Promise.all(workers);
      if (cancelled || updates.size === 0) return;
      setDocCodigoMap(prev => {
        const next = new Map(prev);
        updates.forEach((v, k) => next.set(k, v));
        return next;
      });
    })();

    return () => { cancelled = true; };
  }, [analysisItems, docCodigoMap]);

  useEffect(() => {
    if (grupoFilter === ALL_GROUPS_VALUE || grupoFilter === 'Sem grupo' || uniqueGrupos.length === 0) {
      return;
    }

    if (!uniqueGrupos.includes(grupoFilter)) {
      setGrupoFilter(ALL_GROUPS_VALUE);
    }
  }, [grupoFilter, uniqueGrupos]);

  // Filtered items (search + grupo)
  const filteredItems = useMemo(() => {
    return analysisItems.filter((item) => matchesAnalysisFilters(item, searchTerm, grupoFilter));
  }, [analysisItems, searchTerm, grupoFilter]);

  // Trend chart data
  const trendChartData = useMemo(() => {
    const events = trendQuery.data || [];
    if (events.length === 0) return [];
    const weekMap = new Map<string, number>();
    for (const e of events) {
      const d = new Date(e.occurred_at);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().split('T')[0];
      weekMap.set(key, (weekMap.get(key) || 0) + (parseFloat(e.qty) || 0));
    }
    return [...weekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, qty]) => ({ week, qty: Math.round(qty) }));
  }, [trendQuery.data]);

  // KPIs
  const kpis = useMemo(() => {
    const items = analysisItems;
    const aCount = items.filter(i => i.abc_class === 'A').length;
    const bCount = items.filter(i => i.abc_class === 'B').length;
    const cCount = items.filter(i => i.abc_class === 'C').length;
    const criticalCount = items.filter(i => i.stock_known && i.projected_available !== null && i.projected_available <= i.reorder_point).length;
    const totalConsumo = items.reduce((s, i) => s + i.total_qty, 0);
    const totalValor = items.reduce((s, i) => s + i.total_value, 0);
    return { aCount, bCount, cCount, criticalCount, totalConsumo, totalValor, totalProdutos: items.length };
  }, [analysisItems]);

  // Lista de compras: o motor de planejamento já decidiu qty_a_comprar por todas as
  // regras (ROP, mínimo operacional, orçamento, lead time, bloqueios). Aqui apenas
  // filtramos quem precisa comprar (qtd líquida > 0) e ordenamos por risco operacional.
  const purchaseItems = useMemo(() => {
    // Rank de urgência (não é a curva ABC): prioriza itens em ruptura que
    // venderam recentemente, depois ruptura, depois venda recente.
    const urgencyTier = (item: AnalysisItem): number => {
      const isRuptura = item.stock_known && (item.estoque_atual ?? 0) <= 0;
      const soldRecently = (item.qty_60d ?? 0) > 0;
      if (isRuptura && soldRecently) return 0;
      if (isRuptura) return 1;
      if (soldRecently) return 2;
      return 3;
    };
    return analysisItems
      .filter((item) => {
        if (!matchesAnalysisFilters(item, searchTerm, grupoFilter)) return false;
        return item.is_stock_eligible && item.suggested_qty > 0;
      })
      .sort((a, b) => {
        const tierDiff = urgencyTier(a) - urgencyTier(b);
        if (tierDiff !== 0) return tierDiff;
        if ((b.qty_60d ?? 0) !== (a.qty_60d ?? 0)) return (b.qty_60d ?? 0) - (a.qty_60d ?? 0);
        return b.risk_score - a.risk_score;
      });
  }, [analysisItems, grupoFilter, searchTerm]);

  // Orçamentos pendentes sem giro recorrente — sinal, mas NÃO compra automática
  const budgetNoGiroItems = useMemo(() => {
    return analysisItems
      .filter((item) => {
        if (!matchesAnalysisFilters(item, searchTerm, grupoFilter)) return false;
        return item.budget_without_giro;
      })
      .sort((a, b) => {
        const abcOrder = { A: 0, B: 1, C: 2 };
        const abcDiff = abcOrder[a.abc_class] - abcOrder[b.abc_class];
        if (abcDiff !== 0) return abcDiff;
        return b.budget_signal_qty - a.budget_signal_qty;
      });
  }, [analysisItems, grupoFilter, searchTerm]);

  // Estoque recorrente OK — elegível mas sem necessidade de compra agora
  const recurringOkItems = useMemo(() => {
    return analysisItems
      .filter((item) => {
        if (!matchesAnalysisFilters(item, searchTerm, grupoFilter)) return false;
        return item.is_stock_eligible && item.suggested_qty <= 0;
      })
      .sort((a, b) => {
        const abcOrder = { A: 0, B: 1, C: 2 };
        const abcDiff = abcOrder[a.abc_class] - abcOrder[b.abc_class];
        if (abcDiff !== 0) return abcDiff;
        return b.total_qty - a.total_qty;
      });
  }, [analysisItems, grupoFilter, searchTerm]);

  // Fetch active purchase orders from GC
  const handleFetchPCs = useCallback(async () => {
    setLoadingPCs(true);
    try {
      // Use crossref statuses from inventory policy config
      const statusIds = crossrefSituacaoIds;
      if (!statusIds || statusIds.length === 0) {
        toast.error('Configure as situações de cruzamento de PCs na Política de Estoque (aba Compras).');
        setLoadingPCs(false);
        return;
      }

      const newPcMap = new Map<string, PCEntry>();
      for (const sid of statusIds) {
        let page = 1;
        while (true) {
          const res = await listOrdensCompra(sid, page);
          for (const ordem of res.data) {
            for (const p of ordem.produtos || []) {
              const pid = String(p.produto?.produto_id || '').trim();
              if (!pid) continue;
              const qty = parseFloat(String(p.produto?.quantidade || '0')) || 0;
              if (qty <= 0) continue;

              if (!newPcMap.has(pid)) newPcMap.set(pid, { qtd: 0, refs: [] });
              const entry = newPcMap.get(pid)!;
              entry.qtd += qty;
              entry.refs.push({
                codigo: ordem.codigo,
                qtd: qty,
                fornecedor: ordem.nome_fornecedor,
                situacao: ordem.nome_situacao,
              });
            }
          }
          if (page >= res.meta.total_paginas) break;
          page++;
          await new Promise(r => setTimeout(r, 400));
        }
      }

      setPcMap(newPcMap);
      toast.success(`${newPcMap.size} produtos com pedido de compra em andamento`);
    } catch (err) {
      toast.error('Erro ao buscar pedidos de compra: ' + (err instanceof Error ? err.message : 'Erro'));
    } finally {
      setLoadingPCs(false);
    }
  }, [crossrefSituacaoIds]);

  // Fetch pending budgets (orçamentos) and aggregate product demand
  const handleFetchOrcamentos = useCallback(async () => {
    setLoadingOrcs(true);
    try {
      // Use configured budget statuses, fallback to "Aguardando Aprovação"
      let statusIds = budgetSituacaoIds;
      if (!statusIds || statusIds.length === 0) {
        const statuses = await getStatusOrcamentos();
        const aguardando = statuses?.find(s => s.nome.toLowerCase().includes('aguardando aprov'));
        if (!aguardando) {
          toast.error('Status "Aguardando Aprovação" não encontrado. Configure as situações de orçamento na Política de Estoque.');
          setLoadingOrcs(false);
          return;
        }
        statusIds = [aguardando.id];
      }

      // Date range: mesma janela de VENDAS RECENTES (dias do preenchimento), não o lookback.
      // Orçamento parado além dessa janela não conta como demanda pendente.
      const now = new Date();
      const start = new Date(now.getTime() - salesWindowDays * 24 * 60 * 60 * 1000);

      const allOrcs: GCOrcamento[] = [];
      for (const sid of statusIds) {
        let page = 1;
        while (true) {
          const res = await listOrcamentos(sid, page);
          allOrcs.push(...res.data);
          if (page >= res.meta.total_paginas) break;
          page++;
          await new Promise(r => setTimeout(r, 400));
        }
      }

      // Client-side date filter (API may not support date_inicio/date_fim reliably)
      const pending = allOrcs.filter(o => {
        // Filter converted
        const fin = String(o.situacao_financeiro ?? '').toLowerCase();
        const est = String(o.situacao_estoque ?? '').toLowerCase();
        if (['1', 'true', 'sim', 'yes'].includes(fin) || ['1', 'true', 'sim', 'yes'].includes(est)) return false;
        // Filter by date
        try {
          const [y, m, d] = o.data.split('-').map(Number);
          const orcDate = new Date(y, m - 1, d);
          return orcDate >= start;
        } catch { return false; }
      });

      // Aggregate product demand
      const newOrcMap = new Map<string, OrcEntry>();
      for (const orc of pending) {
        for (const p of orc.produtos || []) {
          const pid = String(p.produto?.produto_id || '').trim();
          if (!pid) continue;
          const qty = parseFloat(String(p.produto?.quantidade || '0')) || 0;
          if (qty <= 0) continue;

          if (!newOrcMap.has(pid)) newOrcMap.set(pid, { qtd: 0, refs: [] });
          const entry = newOrcMap.get(pid)!;
          entry.qtd += qty;
          entry.refs.push({
            codigo: orc.codigo,
            qtd: qty,
            cliente: orc.nome_cliente,
          });
        }
      }

      setOrcMap(newOrcMap);
      toast.success(`${pending.length} orçamentos (${salesWindowDays}d, ${statusIds.length} situação(ões)) · ${newOrcMap.size} produtos`);
    } catch (err) {
      toast.error('Erro ao buscar orçamentos: ' + (err instanceof Error ? err.message : 'Erro'));
    } finally {
      setLoadingOrcs(false);
    }
  }, [salesWindowDays, budgetSituacaoIds]);

  // Bulk fetch stock for ALL products via paginated edge function
  const handleFetchStock = useCallback(async () => {
    setLoadingStock(true);
    setStockProgress({ done: 0, total: 0 });
    let cursor: any = null;
    let callCount = 0;

    try {
      while (true) {
        callCount++;
        const { data, error } = await supabase.functions.invoke('bulk-stock-fetch', {
          body: { cursor },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        if (data?.progress) {
          setStockProgress({ done: data.progress.productsLoaded, total: data.progress.totalRegistros || data.progress.productsLoaded });
        }

        if (data?.retry) {
          await new Promise(r => setTimeout(r, 2000));
          cursor = data.cursor;
          continue;
        }

        if (data?.done) {
          const sm = data.stockMap || {};
          const newMap = new Map<string, number>();
          for (const [id, qty] of Object.entries(sm)) {
            newMap.set(id, qty as number);
          }
          setStockMap(newMap);
          const mm = data.movMap || {};
          const newMov = new Map<string, boolean>();
          for (const [id, flag] of Object.entries(mm)) {
            if (flag) newMov.set(id, true);
          }
          setMovMap(newMov);
          toast.success(`Estoque atualizado: ${newMap.size} produtos`);
          break;
        }

        cursor = data.cursor;
        await new Promise(r => setTimeout(r, 100));
      }
    } catch (err) {
      console.error('Bulk stock fetch error:', err);
      toast.error('Erro ao buscar estoques: ' + (err instanceof Error ? err.message : 'Erro'));
    } finally {
      setLoadingStock(false);
    }

    // Also fetch PCs if not loaded yet
    if (pcMap.size === 0) {
      handleFetchPCs();
    }
  }, [pcMap, handleFetchPCs]);

  // Sync lead times
  const handleSyncLeadTimes = async () => {
    setSyncingLT(true);
    try {
      const { data, error } = await supabase.functions.invoke('inventory-lead-time-sync');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Lead times atualizados: ${data?.suppliers_analyzed || 0} fornecedores analisados`);
      leadTimesQuery.refetch();
    } catch (err) {
      toast.error('Erro ao sincronizar lead times: ' + (err instanceof Error ? err.message : 'Erro'));
    } finally {
      setSyncingLT(false);
    }
  };

  const formatNumberBR = (value: number, digits = 2) =>
    Number.isFinite(value)
      ? value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : '';

  const escapeCsvCell = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };

  const buildCsvPtBr = (headers: string[], rows: Array<Array<string | number | null | undefined>>) => {
    const separator = ';';
    const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(separator));
    return `\uFEFF${lines.join('\r\n')}`;
  };

  const downloadCsv = (fileName: string, content: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = ['Produto ID', 'Código', 'Nome', 'Grupo', 'ABC Financeiro', 'Classe Giro', 'Status Estoque', 'XYZ', 'Padrão Demanda', 'Custo Unit. (R$)', 'Eventos', 'Eventos 90d', 'Eventos 180d', 'Fontes 90d', 'Fontes 180d', 'Dias desde últ. consumo', 'Consumo Total', 'Valor Total (R$)', 'Méd Mensal Hist.', 'Previsão Mensal', 'Méd/Dia', 'Estoque Atual', 'Saldo Projetado', 'Lead Time', 'Estoque Segurança', 'Mín. Operacional', 'Ponto Ressup.', 'Estoque Máx.', 'A Comprar'];
    const rows = filteredItems.map((i) => [
      i.produto_id,
      i.codigo_interno || '',
      i.nome,
      i.grupo || 'Sem grupo',
      i.abc_class,
      i.classe_giro,
      i.status_estoque,
      i.xyz_class,
      i.demand_pattern,
      i.valor_custo !== null ? formatNumberBR(i.valor_custo, 2) : '',
      i.event_count,
      i.event_count_90d,
      i.event_count_180d,
      i.source_count_90d,
      i.source_count_180d,
      i.days_since_last ?? '',
      formatNumberBR(i.total_qty, 0),
      formatNumberBR(i.total_value, 2),
      formatNumberBR(i.historical_monthly_avg, 2),
      formatNumberBR(i.forecast_monthly, 2),
      formatNumberBR(i.avg_daily, 2),
      i.estoque_atual ?? '',
      i.projected_available !== null ? formatNumberBR(i.projected_available, 1) : '',
      formatNumberBR(i.lead_time_days, 0),
      i.safety_stock,
      i.operational_minimum,
      i.reorder_point,
      i.max_stock,
      i.qty_a_comprar,
    ]);

    downloadCsv(
      `analise-estoque-${new Date().toISOString().split('T')[0]}.csv`,
      buildCsvPtBr(headers, rows),
    );
  };

  // Export shopping list CSV
  const handleExportShoppingList = () => {
    if (purchaseItems.length === 0) return;

    const headers = ['Risco', 'Classe ABC', 'XYZ', 'Padrão Demanda', 'Crítico', 'Produto ID', 'Código', 'Nome', 'Grupo', 'Custo Unit. (R$)', 'Estoque Atual', 'PC em Aberto', 'Orçamento Ponderado', 'Saldo Projetado', 'Lead Time', 'Estoque Segurança', 'Mín. Operacional', 'Ponto Ressup.', 'Estoque Máx.', 'Qtd Sugerida', 'Qtd Líquida', 'Motivos', 'Alertas', 'PCs'];
    const rows = purchaseItems.map((i) => [
      i.risk_score,
      i.abc_class,
      i.xyz_class,
      i.demand_pattern,
      i.is_critical ? 'Sim' : 'Não',
      i.produto_id,
      i.codigo_interno || '',
      i.nome,
      i.grupo || 'Sem grupo',
      i.valor_custo !== null ? formatNumberBR(i.valor_custo, 2) : '',
      i.estoque_atual ?? '',
      i.pc_qty,
      formatNumberBR(i.orc_qty, 2),
      i.projected_available !== null ? formatNumberBR(i.projected_available, 1) : '',
      formatNumberBR(i.lead_time_days, 0),
      i.safety_stock,
      i.operational_minimum,
      i.reorder_point,
      i.max_stock,
      i.qty_a_comprar,
      i.qty_liquida,
      i.motivos_sugestao.join(' | '),
      i.alertas.join(' | '),
      i.pc_refs.map((r) => `PC${r.codigo}(${r.qtd})`).join(' · '),
    ]);

    downloadCsv(
      `lista-compras-${new Date().toISOString().split('T')[0]}.csv`,
      buildCsvPtBr(headers, rows),
    );
  };

  const abcBadge = (cls: 'A' | 'B' | 'C') => {
    const variants: Record<string, string> = {
      A: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      B: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
      C: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${variants[cls]}`}>{cls}</span>;
  };

  const giroBadge = (cls: GiroClass) => {
    const variants: Record<GiroClass, string> = {
      ALTO: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      MEDIO: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
      BAIXO: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      SEM_GIRO: 'bg-muted text-muted-foreground',
    };
    const labels: Record<GiroClass, string> = { ALTO: 'Alto', MEDIO: 'Médio', BAIXO: 'Baixo', SEM_GIRO: 'Sem giro' };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${variants[cls]}`}>{labels[cls]}</span>;
  };

  const statusEstoqueBadge = (st: StatusEstoque) => {
    const variants: Record<StatusEstoque, string> = {
      COMPRAR_ESTOQUE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      ESTOQUE_OK: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      REVISAR_MANUALMENTE: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
      NAO_ESTOCAR: 'bg-muted text-muted-foreground',
    };
    const labels: Record<StatusEstoque, string> = {
      COMPRAR_ESTOQUE: 'Comprar estoque',
      ESTOQUE_OK: 'Estoque ok',
      REVISAR_MANUALMENTE: 'Revisar manual',
      NAO_ESTOCAR: 'Não estocar',
    };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${variants[st]}`}>{labels[st]}</span>;
  };

  const isLoading = consumptionQuery.isLoading || configQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (analysisItems.length === 0) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Análise de Estoque</h1>
        <Card className="p-8 text-center">
          <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold">Sem dados de consumo</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Execute a sincronização de consumo na página de <strong>Política de Estoque</strong> para extrair dados de saída efetiva.
          </p>
        </Card>
      </div>
    );
  }

  const leadTimes = leadTimesQuery.data || [];
  const abcChartData = [
    { name: 'A', count: kpis.aCount, fill: 'hsl(0 84% 60%)' },
    { name: 'B', count: kpis.bCount, fill: 'hsl(45 93% 47%)' },
    { name: 'C', count: kpis.cCount, fill: 'hsl(142 71% 45%)' },
  ];
  const showStickyFilters = activeTab === 'ranking' || (activeTab === 'compras' && stockMap.size > 0);
  const activeFilterCount = activeTab === 'compras'
    ? purchaseItems.length
    : activeTab === 'orcsemgiro'
      ? budgetNoGiroItems.length
      : activeTab === 'recorrenteok'
        ? recurringOkItems.length
        : filteredItems.length;

  return (
    <div className="max-w-[1400px] mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Análise de Estoque & Suprimentos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Últimos {lookbackDays} dias · {kpis.totalProdutos} SKUs com saída registrada · {Math.round(kpis.totalConsumo)} un. consumidas · ABC clássico (valor de consumo)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleFetchStock} disabled={loadingStock} className="gap-1">
            {loadingStock ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {loadingStock ? `Estoque ${stockProgress.done}/${stockProgress.total}` : 'Atualizar Estoques'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleSyncLeadTimes} disabled={syncingLT} className="gap-1">
            {syncingLT ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
            {syncingLT ? 'Calculando...' : 'Calcular Lead Times'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-1">
            <Download className="h-3 w-3" /> CSV
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Classe A</p>
          <p className="text-xl font-bold text-destructive mt-0.5">{kpis.aCount}</p>
          <p className="text-[10px] text-muted-foreground">{(thresholds.A * 100).toFixed(0)}% do valor · z {POLICY.zScores.A}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Classe B</p>
          <p className="text-xl font-bold text-amber-600 mt-0.5">{kpis.bCount}</p>
          <p className="text-[10px] text-muted-foreground">{((thresholds.B - thresholds.A) * 100).toFixed(0)}% do valor · z {POLICY.zScores.B}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Classe C</p>
          <p className="text-xl font-bold text-primary mt-0.5">{kpis.cCount}</p>
          <p className="text-[10px] text-muted-foreground">{((1 - thresholds.B) * 100).toFixed(0)}% do valor · z {POLICY.zScores.C}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Lead Time (fallback)</p>
          <p className="text-xl font-bold text-foreground mt-0.5">{fallbackLeadTime}d</p>
          <p className="text-[10px] text-muted-foreground">{leadTimes.length} fornecedores · por produto</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Precisam Reposição</p>
          <p className="text-xl font-bold mt-0.5">
            {stockMap.size > 0 ? (
              kpis.criticalCount > 0 ? <span className="text-destructive">{kpis.criticalCount}</span> : <span className="text-primary">0</span>
            ) : <span className="text-muted-foreground">—</span>}
          </p>
          <p className="text-[10px] text-muted-foreground">{stockMap.size > 0 ? 'abaixo do ROP' : 'atualize estoques'}</p>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AnalysisTab)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="compras" className="gap-1"><ShoppingCart className="h-3.5 w-3.5" /> Comprar Agora</TabsTrigger>
          <TabsTrigger value="orcsemgiro" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Orçamento sem Giro</TabsTrigger>
          <TabsTrigger value="recorrenteok" className="gap-1"><PackageCheck className="h-3.5 w-3.5" /> Estoque OK</TabsTrigger>
          <TabsTrigger value="ranking" className="gap-1"><BarChart3 className="h-3.5 w-3.5" /> Ranking ABC</TabsTrigger>
          <TabsTrigger value="leadtime" className="gap-1"><Clock className="h-3.5 w-3.5" /> Lead Times</TabsTrigger>
          <TabsTrigger value="trend" className="gap-1"><TrendingUp className="h-3.5 w-3.5" /> Tendência</TabsTrigger>
        </TabsList>

        {showStickyFilters && (
          <div className="sticky top-14 z-20 mt-4">
            <Card className="border-border/80 bg-background/95 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    placeholder="Buscar por nome, código ou ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-9 w-full text-sm sm:max-w-sm"
                  />
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="h-9 w-full justify-between text-xs sm:w-[260px]">
                        <div className="flex items-center gap-1 truncate">
                          <Filter className="h-3 w-3 shrink-0" />
                          <span className="truncate">{grupoFilter === ALL_GROUPS_VALUE ? 'Todos os grupos' : grupoFilter}</span>
                        </div>
                        <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Buscar grupo..." />
                        <CommandList>
                          <CommandEmpty>Nenhum grupo encontrado.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value={ALL_GROUPS_VALUE}
                              onSelect={() => setGrupoFilter(ALL_GROUPS_VALUE)}
                            >
                              <Check className={cn("mr-2 h-4 w-4", grupoFilter === ALL_GROUPS_VALUE ? "opacity-100" : "opacity-0")} />
                              Todos os grupos
                            </CommandItem>
                            {uniqueGrupos.map((g) => (
                              <CommandItem key={g} value={g} onSelect={() => setGrupoFilter(g)}>
                                <Check className={cn("mr-2 h-4 w-4", grupoFilter === g ? "opacity-100" : "opacity-0")} />
                                {g}
                              </CommandItem>
                            ))}
                            <CommandItem value="Sem grupo" onSelect={() => setGrupoFilter('Sem grupo')}>
                              <Check className={cn("mr-2 h-4 w-4", grupoFilter === 'Sem grupo' ? "opacity-100" : "opacity-0")} />
                              Sem grupo
                            </CommandItem>
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <Badge variant="secondary" className="w-fit">
                  {activeFilterCount} {activeTab === 'compras' ? 'produto(s) na lista' : 'produto(s) filtrado(s)'}
                </Badge>
              </div>
            </Card>
          </div>
        )}

        {/* LISTA DE COMPRAS (default tab) */}
        <TabsContent value="compras" className="mt-4 space-y-4">
          {stockMap.size > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                {purchaseItems.length > 0 ? (
                  <>
                    <p className="text-sm font-medium">
                      🚨 <strong>{purchaseItems.length}</strong> produto(s) precisam de reposição
                      {pcMap.size > 0 && <span className="text-muted-foreground font-normal"> · {pcMap.size} produtos com PC em andamento</span>}
                      {orcMap.size > 0 && <span className="text-muted-foreground font-normal"> · {orcMap.size} produtos em orçamentos</span>}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      ROP + demanda de orçamentos pendentes · Qtd líquida = necessidade − PC em andamento
                    </p>
                  </>
                ) : (
                  <p className="text-sm font-medium text-muted-foreground">
                    {analysisItems.length} produtos analisados
                  </p>
                )}
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                <Button variant="outline" size="sm" onClick={handleFetchPCs} disabled={loadingPCs} className="gap-1">
                  {loadingPCs ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  {loadingPCs ? 'Buscando PCs...' : pcMap.size > 0 ? 'Atualizar PCs' : 'Cruzar c/ PCs'}
                </Button>
                <Button variant="outline" size="sm" onClick={handleFetchOrcamentos} disabled={loadingOrcs} className="gap-1">
                  {loadingOrcs ? <Loader2 className="h-3 w-3 animate-spin" /> : <Package className="h-3 w-3" />}
                  {loadingOrcs ? 'Buscando...' : orcMap.size > 0 ? 'Atualizar Orçamentos' : 'Cruzar c/ Orçamentos'}
                </Button>
                {orcMap.size > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setOrcMap(new Map())} className="gap-1 text-muted-foreground">
                    Limpar Orçamentos
                  </Button>
                )}
                {purchaseItems.length > 0 && (
                  <Button variant="outline" size="sm" onClick={handleExportShoppingList} className="gap-1">
                    <Download className="h-3 w-3" /> Exportar Lista
                  </Button>
                )}
              </div>
            </div>
          )}

          {stockMap.size === 0 ? (
            <Card className="p-8 text-center">
              <ShoppingCart className="h-12 w-12 mx-auto text-amber-500 mb-3" />
              <h3 className="font-semibold text-lg">Gerar Lista de Compras</h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                Para gerar a lista de compras inteligente, primeiro precisamos buscar o estoque atual dos produtos.
                O sistema vai comparar com o consumo histórico e sugerir as quantidades ideais por classe ABC.
              </p>
              <div className="flex flex-col items-center gap-2 mt-4">
                <Button onClick={handleFetchStock} disabled={loadingStock} className="gap-2">
                  {loadingStock ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {loadingStock ? `Buscando estoque ${stockProgress.done}/${stockProgress.total}...` : 'Buscar Estoques e Gerar Lista'}
                </Button>
                {loadingStock && (
                  <div className="w-64 bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(stockProgress.done / Math.max(stockProgress.total, 1)) * 100}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="mt-4 text-xs text-muted-foreground space-y-1">
                <p>📊 Política ERP: ponto de ressuprimento = demanda no lead time + estoque de segurança (z por classe/criticidade) · mínimo operacional para peça barata recorrente</p>
                <p>⏱ Lead time: <strong>por fornecedor do produto</strong> (fallback: {fallbackLeadTime}d se sem vínculo)</p>
                <p>🛡 {leadTimes.length} fornecedores com lead time calculado</p>
              </div>
            </Card>
          ) : purchaseItems.length === 0 ? (
            <Card className="p-8 text-center">
              <Package className="h-12 w-12 mx-auto text-primary mb-3" />
              <h3 className="font-semibold text-lg">✅ Estoque Saudável</h3>
              <p className="text-sm text-muted-foreground mt-2">
                Todos os {stockMap.size} produtos analisados estão acima do ponto de reposição. Nenhuma compra necessária no momento.
              </p>
            </Card>
          ) : (
            <>

              <div className="rounded-lg border overflow-auto max-h-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-10 px-2 py-1.5 text-xs">ABC</TableHead>
                      <TableHead className="w-8 px-2 py-1.5 text-xs">XYZ</TableHead>
                      <TableHead className="px-2 py-1.5 text-xs">Produto</TableHead>
                      <TableHead className="px-2 py-1.5 text-xs">Padrão</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs">Custo Unit.</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs">Estoque</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs text-violet-600">Vend. {salesWindowDays}d</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs text-emerald-600">Vendas</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs">OS</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs text-blue-600">PC Aberto</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs text-amber-600">Orçamento</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs">Saldo Proj.</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs">LT</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs">Est. Seg.</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs">Mín. Op.</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs">ROP</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs">Est. Máx.</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs">Sugerido</TableHead>
                      <TableHead className="text-right px-2 py-1.5 text-xs font-bold text-destructive">COMPRAR</TableHead>
                      <TableHead className="min-w-[260px] px-2 py-1.5 text-xs">Motivos / Alertas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchaseItems.map(item => (
                      <TableRow key={item.produto_id} className={
                        item.abc_class === 'A' ? 'bg-red-50/50 dark:bg-red-950/10' :
                        item.abc_class === 'B' ? 'bg-amber-50/50 dark:bg-amber-950/10' : ''
                      }>
                        <TableCell className="px-2 py-1">{abcBadge(item.abc_class)}</TableCell>
                        <TableCell className="px-2 py-1 text-xs font-medium text-muted-foreground">{item.xyz_class}</TableCell>
                        <TableCell className="px-2 py-1">
                          <p className="text-sm font-medium truncate max-w-[260px] flex items-center gap-1">
                            {item.is_critical && <span title="Peça crítica">🔧</span>}
                            {item.nome}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {item.codigo_interno && `${item.codigo_interno} · `}
                            {item.fornecedor_nome || 'Sem fornecedor'}
                          </p>
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-muted-foreground capitalize">{item.demand_pattern.replace('_', ' ')}</TableCell>
                        <TableCell className="px-2 py-1 text-right text-xs">
                          {item.valor_custo !== null ? `R$ ${item.valor_custo.toFixed(2)}` : '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-right">
                          {item.stock_known ? (
                            (item.estoque_atual ?? 0) < 0 ? (
                              <span className="text-red-600 font-bold animate-pulse" title="Estoque negativo — não deveria existir!">{item.estoque_atual}</span>
                            ) : (
                              item.estoque_atual
                            )
                          ) : <span className="text-amber-600 text-xs" title="Estoque não carregado">—</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-right">
                          {item.qty_60d > 0 ? (
                            <span className="text-violet-600 font-semibold text-xs" title={`Quantidade vendida (Vendas + OS) nos últimos ${salesWindowDays} dias`}>{formatNumberBR(item.qty_60d, item.qty_60d % 1 === 0 ? 0 : 1)}un</span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-right">
                          {item.qty_venda > 0 ? (
                            <span className="text-emerald-600 font-medium text-xs" title="Quantidade vendida (documentos de Venda)">{formatNumberBR(item.qty_venda, item.qty_venda % 1 === 0 ? 0 : 1)}un</span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-right">
                          {item.qty_os > 0 ? (
                            <span className="text-muted-foreground text-xs" title="Quantidade baixada em OS">{formatNumberBR(item.qty_os, item.qty_os % 1 === 0 ? 0 : 1)}un</span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-right">
                          {item.pc_qty > 0 ? (
                            <span className="text-blue-600 font-medium text-xs" title={item.pc_refs.map(r => `PC ${r.codigo}: ${r.qtd}un (${r.fornecedor} — ${r.situacao})`).join('\n')}>
                              {item.pc_qty}un
                            </span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-right">
                          {item.orc_qty > 0 ? (
                            <span className="text-amber-600 font-medium text-xs" title={item.orc_refs.map(r => `ORC ${r.codigo}: ${r.qtd}un (${r.cliente})`).join('\n')}>
                              {formatNumberBR(item.orc_qty, item.orc_qty % 1 === 0 ? 0 : 1)}un
                            </span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-right text-xs">
                          {item.projected_available !== null
                            ? <span className={item.projected_available <= item.reorder_point ? 'text-destructive font-bold' : ''}>{item.projected_available.toFixed(1)}</span>
                            : '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-right text-xs font-medium">{Math.round(item.lead_time_days)}d</TableCell>
                        <TableCell className="px-2 py-1 text-right text-xs">{item.safety_stock}</TableCell>
                        <TableCell className="px-2 py-1 text-right text-xs">{item.operational_minimum}</TableCell>
                        <TableCell className="px-2 py-1 text-right text-xs">{item.reorder_point}</TableCell>
                        <TableCell className="px-2 py-1 text-right text-xs">{item.max_stock}</TableCell>
                        <TableCell className="px-2 py-1 text-right text-xs">{item.qty_a_comprar}</TableCell>
                        <TableCell className="px-2 py-1 text-right">
                          <Badge variant={item.qty_liquida > 0 ? "destructive" : "secondary"} className="font-bold text-sm">
                            {item.qty_liquida}
                          </Badge>
                        </TableCell>
                        <TableCell className="min-w-[260px] max-w-[320px] px-2 py-1">
                          <div className="flex flex-col gap-0.5">
                            {item.motivos_sugestao.map((m, idx) => (
                              <span key={idx} className="text-[10px] leading-snug text-muted-foreground">• {m}</span>
                            ))}
                            {item.alertas.map((a, idx) => (
                              <span key={`a${idx}`} className="flex items-start gap-1 text-[10px] leading-snug text-amber-600">
                                <AlertTriangle className="h-2.5 w-2.5" /> {a}
                              </span>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Summary by ABC class */}
              <div className="grid grid-cols-3 gap-3">
                {(['A', 'B', 'C'] as const).map(cls => {
                  const items = purchaseItems.filter(i => i.abc_class === cls);
                  const totalQtyBruta = items.reduce((s, i) => s + (i.qty_a_comprar || 0), 0);
                  const totalQtyLiquida = items.reduce((s, i) => s + (i.qty_liquida || 0), 0);
                  const totalPC = items.reduce((s, i) => s + i.pc_qty, 0);
                  return (
                    <Card key={cls} className="p-3 text-center">
                      {abcBadge(cls)}
                      <p className="text-lg font-bold mt-1">{items.length} itens</p>
                      <p className="text-xs text-muted-foreground">{totalQtyLiquida} un. a comprar</p>
                      {totalPC > 0 && <p className="text-[10px] text-blue-600">{totalPC} un. já em PC</p>}
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>

        {/* ORÇAMENTO SEM GIRO — sinal, nunca compra automática */}
        <TabsContent value="orcsemgiro" className="mt-4 space-y-4">
          <Card className="p-3 border-amber-300 bg-amber-50/50 dark:bg-amber-900/10">
            <p className="text-xs text-amber-800 dark:text-amber-300">
              Produtos que aparecem em orçamentos pendentes mas <strong>não têm giro recorrente</strong>.
              Servem como alerta de antecipação — não entram na compra automática de estoque.
            </p>
          </Card>
          <div className="rounded-lg border overflow-auto max-h-[520px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Orç. (sinal)</TableHead>
                  <TableHead className="w-16">Giro</TableHead>
                  <TableHead className="text-right">Eventos</TableHead>
                  <TableHead className="text-right">Custo Unit.</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead>Decisão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgetNoGiroItems.map(item => (
                  <TableRow key={item.produto_id}>
                    <TableCell>
                      <p className="text-sm font-medium truncate max-w-[280px]">{item.nome}</p>
                      {item.codigo_interno && <p className="text-[10px] text-muted-foreground">{item.codigo_interno}</p>}
                    </TableCell>
                    <TableCell className="text-right text-xs font-medium">{item.budget_signal_qty.toFixed(1)}</TableCell>
                    <TableCell>{giroBadge(item.classe_giro)}</TableCell>
                    <TableCell className="text-right text-xs">{item.event_count}</TableCell>
                    <TableCell className="text-right text-xs">{item.valor_custo !== null ? item.valor_custo.toFixed(2) : '—'}</TableCell>
                    <TableCell className="text-right text-xs">{item.estoque_atual ?? '—'}</TableCell>
                    <TableCell>{statusEstoqueBadge(item.status_estoque)}</TableCell>
                  </TableRow>
                ))}
                {budgetNoGiroItems.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">Nenhum orçamento pendente sem giro.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ESTOQUE RECORRENTE OK */}
        <TabsContent value="recorrenteok" className="mt-4 space-y-4">
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">
              Produtos recorrentes (elegíveis para estoque) com cobertura suficiente — sem necessidade de compra agora.
            </p>
          </Card>
          <div className="rounded-lg border overflow-auto max-h-[520px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="w-16">Giro</TableHead>
                  <TableHead className="text-right">Consumo 90d</TableHead>
                  <TableHead className="text-right">Consumo 180d</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Alvo</TableHead>
                  <TableHead className="text-right">PC Aberto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recurringOkItems.map(item => (
                  <TableRow key={item.produto_id}>
                    <TableCell>
                      <p className="text-sm font-medium truncate max-w-[280px]">{item.nome}</p>
                      {item.codigo_interno && <p className="text-[10px] text-muted-foreground">{item.codigo_interno}</p>}
                    </TableCell>
                    <TableCell>{giroBadge(item.classe_giro)}</TableCell>
                    <TableCell className="text-right text-xs">{Math.round(item.event_count_90d)}</TableCell>
                    <TableCell className="text-right text-xs">{Math.round(item.event_count_180d)}</TableCell>
                    <TableCell className="text-right text-xs">{item.estoque_atual ?? '—'}</TableCell>
                    <TableCell className="text-right text-xs">{item.stock_demand_qty}</TableCell>
                    <TableCell className="text-right text-xs">{item.pc_qty || '—'}</TableCell>
                  </TableRow>
                ))}
                {recurringOkItems.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">Nenhum produto recorrente com estoque suficiente.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>


        {/* RANKING ABC */}
        <TabsContent value="ranking" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-3 rounded-lg border overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead className="w-12">ABC fin.</TableHead>
                    <TableHead className="w-16">Giro</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Eventos</TableHead>
                    <TableHead className="text-right">90d</TableHead>
                    <TableHead className="text-right">180d</TableHead>
                    <TableHead className="text-right">Últ. consumo</TableHead>
                    <TableHead className="text-right">Valor (R$)</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead>Decisão estoque</TableHead>
                    <TableHead className="text-right">% Acum.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item, idx) => (
                    <TableRow key={item.produto_id} className={item.status_estoque === 'REVISAR_MANUALMENTE' ? 'bg-amber-500/5' : ''}>
                      <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell>{abcBadge(item.abc_class)}</TableCell>
                      <TableCell>{giroBadge(item.classe_giro)}</TableCell>
                      <TableCell>
                        <p className="text-sm font-medium truncate max-w-[230px]">{item.nome}</p>
                        {item.codigo_interno && <p className="text-[10px] text-muted-foreground">{item.codigo_interno}</p>}
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium">{item.event_count}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{item.source_count_90d}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{item.source_count_180d}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {item.days_since_last !== null ? `${item.days_since_last}d` : '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs">{item.total_value.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        {item.estoque_atual !== null ? item.estoque_atual : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>{statusEstoqueBadge(item.status_estoque)}</TableCell>
                      <TableCell className="text-right text-[10px] text-muted-foreground">
                        {(item.cumulative_pct * 100).toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* ABC Distribution mini chart */}
            <Card className="p-4">
              <h3 className="text-xs font-semibold mb-3 uppercase tracking-wide text-muted-foreground">Distribuição ABC</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={abcChartData} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={30} />
                  <Tooltip formatter={(v: number) => [`${v} SKUs`, 'Quantidade']} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {abcChartData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Valor total:</span><span className="font-medium">R$ {kpis.totalValor.toFixed(0)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Consumo total:</span><span className="font-medium">{Math.round(kpis.totalConsumo)} un.</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Período:</span><span className="font-medium">{lookbackDays} dias</span></div>
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* LEAD TIMES */}
        <TabsContent value="leadtime" className="mt-4 space-y-4">
          {leadTimes.length === 0 ? (
            <Card className="p-8 text-center">
              <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <h3 className="font-semibold text-lg">Lead Times não calculados</h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                Clique em "Calcular Lead Times" para analisar o histórico de pedidos de compra e calcular o tempo médio de entrega por fornecedor.
              </p>
              <Button onClick={handleSyncLeadTimes} disabled={syncingLT} className="mt-4 gap-2">
                {syncingLT ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
                Calcular Lead Times
              </Button>
            </Card>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Lead time (mediana em dias) calculado a partir do histórico de pedidos de compra finalizados ({leadTimes.reduce((s, l) => s + l.sample_count, 0)} amostras válidas). Fornecedores com menos de 3 amostras ou afetados por mudanças de status em lote no GestãoClick são descartados.
              </p>
              <div className="rounded-lg border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead className="text-right">Mediana (dias)</TableHead>
                      <TableHead className="text-right">Mín.</TableHead>
                      <TableHead className="text-right">Máx.</TableHead>
                      <TableHead className="text-right">Amostras</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leadTimes.map(lt => (
                      <TableRow key={lt.fornecedor_id}>
                        <TableCell className="font-medium">{lt.fornecedor_nome}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={lt.avg_lead_time_days > 20 ? 'destructive' : 'secondary'}>
                            {lt.avg_lead_time_days.toFixed(1)}d
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs">{lt.min_lead_time_days.toFixed(0)}d</TableCell>
                        <TableCell className="text-right text-xs">{lt.max_lead_time_days.toFixed(0)}d</TableCell>
                        <TableCell className="text-right text-xs">{lt.sample_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Card className="p-4">
                <p className="text-sm">
                  <strong>Lead time por fornecedor</strong> (fallback: {fallbackLeadTime}d para produtos sem vínculo)
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Cada produto usa o lead time do SEU fornecedor para calcular o ROP. Produtos sem fornecedor vinculado usam a mediana.
                </p>
              </Card>
            </>
          )}
        </TabsContent>

        {/* TREND */}
        <TabsContent value="trend" className="mt-4 space-y-4">
          <Card className="p-6">
            <h3 className="text-sm font-semibold mb-4">Consumo semanal (todas as saídas)</h3>
            {trendChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={trendChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 11 }}
                    tickFormatter={v => {
                      const d = new Date(v);
                      return `${d.getDate()}/${d.getMonth() + 1}`;
                    }}
                  />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    labelFormatter={v => `Semana de ${new Date(v).toLocaleDateString('pt-BR')}`}
                    formatter={(v: number) => [`${v} un.`, 'Consumo']}
                  />
                  <Bar dataKey="qty" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">Sem dados de tendência</p>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
