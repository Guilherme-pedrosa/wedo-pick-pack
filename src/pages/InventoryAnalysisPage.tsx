import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { listOrdensCompra, listOrcamentos, getStatusOrcamentos } from '@/api/compras';
import { GCOrcamento } from '@/api/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw, Download, AlertTriangle, TrendingUp, Package, ShoppingCart, Clock, BarChart3, Filter } from 'lucide-react';
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
  variacao_id: string | null;
  total_qty: number;
  total_value: number;
  event_count: number;
  source_count: number;
  first_date: string;
  last_date: string;
  hybrid_score: number;
  source_refs: SourceRef[];
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

interface AnalysisItem {
  produto_id: string;
  nome: string;
  codigo_interno: string | null;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  grupo: string | null;
  valor_custo: number | null;
  total_qty: number;
  total_value: number;
  event_count: number;
  source_count: number;
  hybrid_score: number;
  avg_daily: number;
  abc_class: 'A' | 'B' | 'C';
  cumulative_pct: number;
  estoque_atual: number | null;
  dias_cobertura: number | null;
  lead_time_days: number;
  rop: number | null;
  qty_a_comprar: number | null;
  qty_liquida: number | null;
  pc_qty: number;
  pc_refs: PCRef[];
  orc_qty: number;
  orc_refs: OrcRef[];
  source_refs: SourceRef[];
  coverage_target: number;
}

type AnalysisTab = 'compras' | 'ranking' | 'leadtime' | 'trend';

// ABC-specific safety margins on top of lead time
// A = critical items, 40% safety; B = 25%; C = 10%
const ABC_SAFETY = { A: 1.4, B: 1.25, C: 1.1 };
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

async function fetchConsumptionAgg(lookbackDays: number): Promise<ConsumptionRow[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString();

  const rows = await fetchAllRows(
    'inventory_consumption_events',
    'produto_id, variacao_id, qty, valor_custo, occurred_at, source_id, source_type, cliente_nome',
    { gte: ['occurred_at', cutoffStr] },
  );

  const map = new Map<string, ConsumptionRow & { _sources: Set<string>; _clients: Set<string>; _sourceRefs: Map<string, SourceRef> }>();
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
    if (existing) {
      existing.total_qty += qty;
      existing.total_value += val;
      existing._sources.add(sourceId);
      existing._clients.add(clientKey);
      existing.event_count = existing._clients.size;
      existing.source_count = existing._sources.size;
      if (r.occurred_at < existing.first_date) existing.first_date = r.occurred_at;
      if (r.occurred_at > existing.last_date) existing.last_date = r.occurred_at;
      // Aggregate source refs by source_id
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
        variacao_id: r.variacao_id,
        total_qty: qty,
        total_value: val,
        event_count: 1,
        source_count: 1,
        first_date: r.occurred_at,
        last_date: r.occurred_at,
        hybrid_score: 0,
        source_refs: [],
        _sources: new Set([sourceId]),
        _clients: new Set([clientKey]),
        _sourceRefs: refMap,
      });
    }
  }

  // Finalize source_refs from map
  for (const row of map.values()) {
    row.source_refs = [...row._sourceRefs.values()];
  }

  // Classic ABC: rank by consumption value (unit cost × qty consumed)
  // hybrid_score field reused to hold consumption_value for backward compat
  for (const row of map.values()) {
    row.hybrid_score = row.total_value;
  }

  // Include any product with at least 1 unique consumption event
  const filtered = [...map.values()].filter(r => r.event_count >= 1);
  return filtered.sort((a, b) => b.total_value - a.total_value);
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
  const { data } = await supabase
    .from('products_index')
    .select('produto_id, nome, codigo_interno, fornecedor_id, payload_min_json')
    .in('produto_id', ids);
  for (const p of (data || [])) {
    const payload = (p as any).payload_min_json;
    const grupo = payload?.nome_grupo || null;
    const valorCusto = payload?.valor_custo ? parseFloat(payload.valor_custo) : null;
    map.set(p.produto_id, { produto_id: p.produto_id, nome: p.nome, codigo_interno: p.codigo_interno, fornecedor_id: (p as any).fornecedor_id || null, grupo, valor_custo: valorCusto });
  }
  return map;
}

async function fetchConfig() {
  const { data } = await supabase
    .from('inventory_policy_config' as any)
    .select('lookback_days, abc_thresholds, purchase_crossref_situacao_ids, budget_crossref_situacao_ids')
    .order('created_at', { ascending: false })
    .limit(1);
  return (data as any[])?.[0] || { lookback_days: 180, abc_thresholds: { A: 0.8, B: 0.95 }, purchase_crossref_situacao_ids: [] };
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

  const configQuery = useQuery({ queryKey: ['inv-config'], queryFn: fetchConfig });
  const thresholds = configQuery.data?.abc_thresholds || { A: 0.8, B: 0.95 };
  const lookbackDays = configQuery.data?.lookback_days || 180;
  const crossrefSituacaoIds: string[] = configQuery.data?.purchase_crossref_situacao_ids || [];
  const budgetSituacaoIds: string[] = configQuery.data?.budget_crossref_situacao_ids || [];

  const consumptionQuery = useQuery({
    queryKey: ['inv-consumption', lookbackDays],
    queryFn: () => fetchConsumptionAgg(lookbackDays),
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

  // Build analysis items with ABC + per-supplier ROP
  const analysisItems: AnalysisItem[] = useMemo(() => {
    const rows = consumptionQuery.data || [];
    const names = namesQuery.data || new Map();
    if (rows.length === 0) return [];

    const totalScore = rows.reduce((s, r) => s + r.hybrid_score, 0);
    let cumulative = 0;

    return rows.map(r => {
      cumulative += r.hybrid_score;
      const pct = totalScore > 0 ? cumulative / totalScore : 0;
      const abcClass: 'A' | 'B' | 'C' = pct <= thresholds.A ? 'A' : pct <= thresholds.B ? 'B' : 'C';
      const info = names.get(r.produto_id);
      const avgDaily = lookbackDays > 0 ? r.total_qty / lookbackDays : 0;
      const estoque = stockMap.get(r.produto_id) ?? null;
      
      // Use THIS product's supplier lead time, not global average
      const fornecedorId = info?.fornecedor_id || null;
      const supplierLT = fornecedorId ? supplierLTMap.get(fornecedorId) : null;
      const leadTimeDays = supplierLT ? supplierLT.avg_lead_time_days : fallbackLeadTime;
      const fornecedorNome = supplierLT?.fornecedor_nome || null;

      const safetyFactor = ABC_SAFETY[abcClass];
      const coverageTarget = leadTimeDays;
      // Base ROP from average daily consumption
      const ropAvg = avgDaily * leadTimeDays * safetyFactor;
      // Recurrence-based ROP: usa o INTERVALO MÉDIO ENTRE SAÍDAS observado
      // (não diluído pelo lookback inteiro). Se o intervalo médio entre saídas
      // for menor que o lead time, esperam-se múltiplas saídas durante a reposição
      // → precisamos cobrir essa demanda. Resolve produtos como contrato Ecolab,
      // onde poucas saídas grandes em janela curta zeram o estoque antes da PC chegar.
      const sourceCount = r.source_count ?? 0;
      const avgQtyPerDoc = sourceCount > 0 ? r.total_qty / sourceCount : 0;
      let ropRecurrence = 0;
      if (sourceCount >= 2) {
        const firstMs = new Date(r.first_date).getTime();
        const lastMs = new Date(r.last_date).getTime();
        const spanDays = Math.max(1, (lastMs - firstMs) / 86400000);
        const intervalDays = spanDays / (sourceCount - 1); // intervalo médio entre saídas
        const expectedDocsInLT = leadTimeDays / intervalDays;
        ropRecurrence = Math.max(avgQtyPerDoc, expectedDocsInLT * avgQtyPerDoc * safetyFactor);
      }
      const rop = Math.max(ropAvg, ropRecurrence);
      const diasCobertura = estoque !== null && avgDaily > 0 ? estoque / avgDaily : null;

      // Budget demand (orçamentos pendentes)
      const orcEntry = orcMap.get(r.produto_id);
      const orcQty = orcEntry?.qtd || 0;
      const orcRefs = orcEntry?.refs || [];

      // qty_a_comprar considers ROP + budget demand
      const ropNeed = estoque !== null ? Math.max(0, Math.ceil(rop - estoque)) : null;
      let qtyAComprar = ropNeed !== null ? Math.max(ropNeed, Math.ceil(rop + orcQty - (estoque ?? 0))) : null;

      // Piso por recorrência: se há saída recorrente (>=2 docs) e o item está
      // sob algum gatilho (estoque <=0, cobertura < LT ou estoque < ROP), garantir
      // ao menos a média de peças por documento de saída — caso contrário a sugestão
      // pode dar 0 quando o ROP é baixo mas o histórico mostra que o próximo
      // chamado vai esvaziar o estoque novamente.
      const isRecurringCalc = sourceCount >= 2;
      const isOutOfStockCalc = estoque !== null && estoque <= 0;
      const coverageBelowLTCalc = diasCobertura !== null && diasCobertura < leadTimeDays;
      const belowROPCalc = estoque !== null && rop > 0 && estoque < rop;
      if (qtyAComprar !== null && isRecurringCalc && (isOutOfStockCalc || coverageBelowLTCalc || belowROPCalc)) {
        const minByRecurrence = Math.max(1, Math.ceil(avgQtyPerDoc));
        qtyAComprar = Math.max(qtyAComprar, minByRecurrence);
      }

      // Cross-reference with active purchase orders
      // Se há PC aberta, ela cobre a demanda — não forçar piso adicional.
      const pcEntry = pcMap.get(r.produto_id);
      const pcQty = pcEntry?.qtd || 0;
      const pcRefs = pcEntry?.refs || [];
      const qtyLiquida = qtyAComprar !== null ? Math.max(0, qtyAComprar - pcQty) : null;

      return {
        produto_id: r.produto_id,
        nome: info?.nome || `Produto ${r.produto_id}`,
        codigo_interno: info?.codigo_interno || null,
        grupo: info?.grupo || null,
        valor_custo: info?.valor_custo ?? null,
        fornecedor_id: fornecedorId,
        fornecedor_nome: fornecedorNome,
        total_qty: r.total_qty,
        total_value: r.total_value,
        event_count: r.event_count,
        source_count: r.source_count,
        hybrid_score: r.hybrid_score,
        avg_daily: avgDaily,
        abc_class: abcClass,
        cumulative_pct: pct,
        estoque_atual: estoque,
        dias_cobertura: diasCobertura,
        lead_time_days: leadTimeDays,
        rop,
        qty_a_comprar: qtyAComprar,
        qty_liquida: qtyLiquida,
        pc_qty: pcQty,
        pc_refs: pcRefs,
        orc_qty: orcQty,
        orc_refs: orcRefs,
        source_refs: r.source_refs || [],
        coverage_target: coverageTarget,
      };
    });
  }, [consumptionQuery.data, namesQuery.data, stockMap, pcMap, orcMap, lookbackDays, thresholds, supplierLTMap, fallbackLeadTime]);

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
    const criticalCount = items.filter(i => i.dias_cobertura !== null && i.dias_cobertura < i.lead_time_days).length;
    const totalConsumo = items.reduce((s, i) => s + i.total_qty, 0);
    const totalValor = items.reduce((s, i) => s + i.total_value, 0);
    return { aCount, bCount, cCount, criticalCount, totalConsumo, totalValor, totalProdutos: items.length };
  }, [analysisItems]);

  // Purchase suggestions: triggered by client reach OR by recurring outflow volume.
  // - Client-reach gate: <R$1k → 2+ clients, ≥R$1k → 3+ clients (catches broad demand)
  // - Volume gate: 4+ documentos de saída únicos (cobre casos como contratos Ecolab,
  //   onde um único cliente puxa muita peça e o gate de clientes únicos sozinho ignoraria)
  const purchaseItems = useMemo(() => {
    return analysisItems.filter((item) => {
      if (!matchesAnalysisFilters(item, searchTerm, grupoFilter)) return false;

      const i = item;
      // Se a PC ativa já cobre a demanda, não entra na lista de compras.
      // Item com compra líquida 0 pode continuar na análise, mas não como sugestão.
      if (i.qty_liquida === null || i.qty_liquida <= 0) return false;

      const avgUnitCost = i.total_qty > 0 ? i.total_value / i.total_qty : 0;
      const minClients = avgUnitCost >= 1000 ? 3 : 2;
      const passesClientGate = i.event_count >= minClients;
      const passesVolumeGate = (i.source_count ?? 0) >= 2;

      // Override 1: saída recorrente (>=2 docs) + estoque zerado/negativo
      // → reportar apenas se ainda houver compra líquida após abater PC ativa.
      const isRecurring = (i.source_count ?? 0) >= 2;
      const isOutOfStock = i.estoque_atual !== null && i.estoque_atual <= 0;
      if (isRecurring && isOutOfStock) return true;

      // Override 2: saída recorrente + cobertura insuficiente para o lead time
      // → vai zerar antes da PC chegar. Cobre consignado Ecolab onde tem 1-3 peças
      // em estoque mas a cadência de saída esvazia antes da reposição.
      const coverageBelowLT = i.dias_cobertura !== null && i.dias_cobertura < i.lead_time_days;
      if (isRecurring && coverageBelowLT) return true;

      // Override 3: saída recorrente + estoque < ROP (ponto de reposição atingido)
      // → sinalizar que cruzou o gatilho somente se a compra líquida for positiva.
      const belowROP = i.estoque_atual !== null && i.rop > 0 && i.estoque_atual < i.rop;
      if (isRecurring && belowROP) return true;

      return passesClientGate || passesVolumeGate;
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

      // Date range: same lookback as consumption analysis
      const now = new Date();
      const start = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

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
      toast.success(`${pending.length} orçamentos (${lookbackDays}d, ${statusIds.length} situação(ões)) · ${newOrcMap.size} produtos`);
    } catch (err) {
      toast.error('Erro ao buscar orçamentos: ' + (err instanceof Error ? err.message : 'Erro'));
    } finally {
      setLoadingOrcs(false);
    }
  }, [lookbackDays, budgetSituacaoIds]);

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
    const headers = ['Produto ID', 'Código', 'Nome', 'Grupo', 'Classe ABC', 'Custo Unit. (R$)', 'Eventos', 'Consumo Total', 'Valor Total (R$)', 'Valor Consumo', 'Consumo Médio/Dia', 'Estoque Atual', 'Dias Cobertura', 'ROP', 'A Comprar'];
    const rows = filteredItems.map((i) => [
      i.produto_id,
      i.codigo_interno || '',
      i.nome,
      i.grupo || 'Sem grupo',
      i.abc_class,
      i.valor_custo !== null ? formatNumberBR(i.valor_custo, 2) : '',
      i.event_count,
      formatNumberBR(i.total_qty, 0),
      formatNumberBR(i.total_value, 2),
      formatNumberBR(i.hybrid_score, 1),
      formatNumberBR(i.avg_daily, 2),
      i.estoque_atual ?? '',
      i.dias_cobertura !== null ? formatNumberBR(i.dias_cobertura, 1) : '',
      i.rop !== null ? formatNumberBR(i.rop, 1) : '',
      i.qty_a_comprar ?? '',
    ]);

    downloadCsv(
      `analise-estoque-${new Date().toISOString().split('T')[0]}.csv`,
      buildCsvPtBr(headers, rows),
    );
  };

  // Export shopping list CSV
  const handleExportShoppingList = () => {
    if (purchaseItems.length === 0) return;

    const headers = ['Classe ABC', 'Produto ID', 'Código', 'Nome', 'Grupo', 'Saída (peças)', 'OS Únicas', 'Estoque Atual', 'Consumo Méd/Dia', 'Lead Time', 'ROP', 'Cobertura (dias)', 'Necessidade Bruta', 'PC em Andamento (peças)', 'Qtd Líquida a Comprar', 'PCs'];
    const rows = purchaseItems.map((i) => [
      i.abc_class,
      i.produto_id,
      i.codigo_interno || '',
      i.nome,
      (i as any).grupo || 'Sem grupo',
      formatNumberBR(Math.round(i.total_qty), 0),
      i.event_count,
      i.estoque_atual,
      formatNumberBR(i.avg_daily, 2),
      formatNumberBR(Math.round(i.lead_time_days), 0),
      i.rop !== null ? formatNumberBR(i.rop, 0) : '',
      i.dias_cobertura !== null ? formatNumberBR(i.dias_cobertura, 0) : '0',
      i.qty_a_comprar,
      i.pc_qty,
      i.qty_liquida,
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
  const activeFilterCount = activeTab === 'compras' ? purchaseItems.length : filteredItems.length;

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
          <p className="text-[10px] text-muted-foreground">{(thresholds.A * 100).toFixed(0)}% do valor · seg ×{ABC_SAFETY.A}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Classe B</p>
          <p className="text-xl font-bold text-amber-600 mt-0.5">{kpis.bCount}</p>
          <p className="text-[10px] text-muted-foreground">{((thresholds.B - thresholds.A) * 100).toFixed(0)}% do valor · seg ×{ABC_SAFETY.B}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Classe C</p>
          <p className="text-xl font-bold text-primary mt-0.5">{kpis.cCount}</p>
          <p className="text-[10px] text-muted-foreground">{((1 - thresholds.B) * 100).toFixed(0)}% do valor · seg ×{ABC_SAFETY.C}</p>
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
          <TabsTrigger value="compras" className="gap-1"><ShoppingCart className="h-3.5 w-3.5" /> Lista de Compras</TabsTrigger>
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
                <p>📊 Cobertura = Lead Time <strong>por fornecedor</strong> · Segurança: <strong>A ×{ABC_SAFETY.A}</strong>, B ×{ABC_SAFETY.B}, C ×{ABC_SAFETY.C}</p>
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
                      <TableHead className="w-12">ABC</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Grupo</TableHead>
                      <TableHead className="text-right">Custo Unit.</TableHead>
                      <TableHead className="text-right">Saída (peças)</TableHead>
                      <TableHead className="text-right">OS</TableHead>
                      <TableHead className="text-right">Estoque</TableHead>
                      <TableHead className="text-right">Méd/dia</TableHead>
                      <TableHead className="text-right">LT</TableHead>
                      <TableHead className="text-right">ROP</TableHead>
                      <TableHead className="text-right">Cobertura</TableHead>
                      <TableHead className="text-right">Necessidade</TableHead>
                      <TableHead className="text-right text-amber-600">Orçamentos</TableHead>
                      <TableHead className="text-right text-blue-600">PC Andamento</TableHead>
                      <TableHead className="text-right font-bold text-destructive">COMPRAR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchaseItems.map(item => (
                      <TableRow key={item.produto_id} className={
                        item.abc_class === 'A' ? 'bg-red-50/50 dark:bg-red-950/10' :
                        item.abc_class === 'B' ? 'bg-amber-50/50 dark:bg-amber-950/10' : ''
                      }>
                        <TableCell>{abcBadge(item.abc_class)}</TableCell>
                        <TableCell>
                          <p className="text-sm font-medium truncate max-w-[280px]">{item.nome}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {item.codigo_interno && `${item.codigo_interno} · `}
                            {item.fornecedor_nome || 'Sem fornecedor'}
                          </p>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[120px]">{item.grupo || '—'}</TableCell>
                        <TableCell className="text-right text-xs">
                          {item.valor_custo !== null ? `R$ ${item.valor_custo.toFixed(2)}` : '—'}
                        </TableCell>
                        <TableCell className="text-right font-medium">{Math.round(item.total_qty)}</TableCell>
                        <TableCell className="text-right text-xs">
                          {item.event_count}
                          {item.source_refs.length > 0 && (
                            <span className="text-[10px] text-muted-foreground block max-w-[160px] truncate" title={item.source_refs.map(r => `${r.source_type.toUpperCase()} ${r.source_id}: ${Math.round(r.qty)}un (${r.cliente})`).join('\n')}>
                              {item.source_refs.slice(0, 3).map(r => `${r.source_type === 'os' ? 'OS' : r.source_type === 'venda' ? 'V' : r.source_type.toUpperCase()}${r.source_id}`).join(', ')}
                              {item.source_refs.length > 3 && ` +${item.source_refs.length - 3}`}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{item.estoque_atual}</TableCell>
                        <TableCell className="text-right text-xs">{item.avg_daily.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-xs font-medium">{Math.round(item.lead_time_days)}d</TableCell>
                        <TableCell className="text-right text-xs">{item.rop?.toFixed(0)}</TableCell>
                        <TableCell className="text-right">
                          <span className={`font-bold ${(item.dias_cobertura ?? 0) < item.lead_time_days ? 'text-destructive' : 'text-amber-600'}`}>
                            {item.dias_cobertura?.toFixed(0) || '0'}d
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-xs">{item.qty_a_comprar}</TableCell>
                        <TableCell className="text-right">
                          {item.orc_qty > 0 ? (
                            <span className="text-amber-600 font-medium text-xs" title={item.orc_refs.map(r => `ORC ${r.codigo}: ${r.qtd}un (${r.cliente})`).join('\n')}>
                              {item.orc_qty}un
                              <span className="text-[10px] text-muted-foreground block max-w-[160px] truncate">
                                {item.orc_refs.map(r => `#${r.codigo}`).join(', ')}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.pc_qty > 0 ? (
                            <span className="text-blue-600 font-medium text-xs" title={item.pc_refs.map(r => `PC ${r.codigo}: ${r.qtd}un (${r.fornecedor} — ${r.situacao})`).join('\n')}>
                              {item.pc_qty}un
                              <span className="text-[10px] text-muted-foreground block">
                                {item.pc_refs.map(r => `PC${r.codigo}`).join(', ')}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={item.qty_liquida && item.qty_liquida > 0 ? "destructive" : "secondary"} className="font-bold text-sm">
                            {item.qty_liquida ?? item.qty_a_comprar}
                          </Badge>
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

        {/* RANKING ABC */}
        <TabsContent value="ranking" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-3 rounded-lg border overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead className="w-12">ABC</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Grupo</TableHead>
                    <TableHead className="text-right">Eventos</TableHead>
                    <TableHead className="text-right">Consumo</TableHead>
                    <TableHead className="text-right">Valor (R$)</TableHead>
                    <TableHead className="text-right">Méd/dia</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Cob.</TableHead>
                    <TableHead className="text-right">% Acum.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item, idx) => (
                    <TableRow key={item.produto_id} className={item.dias_cobertura !== null && item.dias_cobertura < item.lead_time_days ? 'bg-destructive/5' : ''}>
                      <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell>{abcBadge(item.abc_class)}</TableCell>
                      <TableCell>
                        <p className="text-sm font-medium truncate max-w-[250px]">{item.nome}</p>
                        {item.codigo_interno && <p className="text-[10px] text-muted-foreground">{item.codigo_interno}</p>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[120px]">{item.grupo || '—'}</TableCell>
                      <TableCell className="text-right text-xs font-medium">{item.event_count}</TableCell>
                      <TableCell className="text-right font-medium">{Math.round(item.total_qty)}</TableCell>
                      <TableCell className="text-right text-xs">{item.total_value.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-xs">{item.avg_daily.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        {item.estoque_atual !== null ? item.estoque_atual : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.dias_cobertura !== null ? (
                          <span className={item.dias_cobertura < item.lead_time_days ? 'text-destructive font-bold' : 'text-xs'}>
                            {item.dias_cobertura.toFixed(0)}d
                          </span>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
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
