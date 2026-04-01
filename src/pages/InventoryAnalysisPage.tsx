import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { listOrdensCompra } from '@/api/compras';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw, Download, AlertTriangle, TrendingUp, Package, ShoppingCart, Clock, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// --- Types ---
interface ConsumptionRow {
  produto_id: string;
  variacao_id: string | null;
  total_qty: number;
  total_value: number;
  event_count: number;
  first_date: string;
  last_date: string;
  hybrid_score: number;
}

interface ProductInfo {
  produto_id: string;
  nome: string;
  codigo_interno: string | null;
  fornecedor_id: string | null;
  grupo: string | null;
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

interface AnalysisItem {
  produto_id: string;
  nome: string;
  codigo_interno: string | null;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  grupo: string | null;
  total_qty: number;
  total_value: number;
  event_count: number;
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
  coverage_target: number;
}

// ABC-specific safety margins on top of lead time
// A = critical items, 40% safety; B = 25%; C = 10%
const ABC_SAFETY = { A: 1.4, B: 1.25, C: 1.1 };

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
    'produto_id, variacao_id, qty, valor_custo, occurred_at, source_id, cliente_nome',
    { gte: ['occurred_at', cutoffStr] },
  );

  const map = new Map<string, ConsumptionRow & { _sources: Set<string>; _clients: Set<string> }>();
  for (const r of rows) {
    const key = r.produto_id;
    if (!key || key.trim() === '') continue;
    const qty = parseFloat(r.qty) || 0;
    const val = (parseFloat(r.valor_custo) || 0) * qty;
    const sourceId = r.source_id || '';
    const clientKey = (r.cliente_nome || sourceId).toLowerCase().trim();
    const existing = map.get(key);
    if (existing) {
      existing.total_qty += qty;
      existing.total_value += val;
      existing._sources.add(sourceId);
      existing._clients.add(clientKey);
      existing.event_count = existing._clients.size; // unique clients
      if (r.occurred_at < existing.first_date) existing.first_date = r.occurred_at;
      if (r.occurred_at > existing.last_date) existing.last_date = r.occurred_at;
    } else {
      map.set(key, {
        produto_id: r.produto_id,
        variacao_id: r.variacao_id,
        total_qty: qty,
        total_value: val,
        event_count: 1,
        first_date: r.occurred_at,
        last_date: r.occurred_at,
        hybrid_score: 0,
        _sources: new Set([sourceId]),
        _clients: new Set([clientKey]),
      });
    }
  }

  // Hybrid score: total_value × daily_frequency
  // Uses unique client count, not raw row count
  for (const row of map.values()) {
    const dailyFrequency = row.event_count / lookbackDays;
    row.hybrid_score = row.total_value * dailyFrequency;
  }

  // Include any product with at least 1 unique consumption event
  const filtered = [...map.values()].filter(r => r.event_count >= 1);
  return filtered.sort((a, b) => b.hybrid_score - a.hybrid_score);
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
    .select('produto_id, nome, codigo_interno, fornecedor_id')
    .in('produto_id', ids);
  for (const p of (data || [])) {
    map.set(p.produto_id, { produto_id: p.produto_id, nome: p.nome, codigo_interno: p.codigo_interno, fornecedor_id: (p as any).fornecedor_id || null });
  }
  return map;
}

async function fetchConfig() {
  const { data } = await supabase
    .from('inventory_policy_config' as any)
    .select('lookback_days, abc_thresholds, purchase_crossref_situacao_ids')
    .order('created_at', { ascending: false })
    .limit(1);
  return (data as any[])?.[0] || { lookback_days: 180, abc_thresholds: { A: 0.8, B: 0.95 }, purchase_crossref_situacao_ids: [] };
}

async function fetchSupplierLeadTimes(): Promise<SupplierLeadTime[]> {
  const { data, error } = await supabase
    .from('supplier_lead_times' as any)
    .select('fornecedor_id, fornecedor_nome, avg_lead_time_days, min_lead_time_days, max_lead_time_days, sample_count')
    .order('avg_lead_time_days', { ascending: false });
  if (error) return [];
  return (data as any[]) || [];
}

export default function InventoryAnalysisPage() {
  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map());
  const [pcMap, setPcMap] = useState<Map<string, PCEntry>>(new Map());
  const [loadingStock, setLoadingStock] = useState(false);
  const [loadingPCs, setLoadingPCs] = useState(false);
  const [stockProgress, setStockProgress] = useState({ done: 0, total: 0 });
  const [searchTerm, setSearchTerm] = useState('');
  const [syncingLT, setSyncingLT] = useState(false);

  const configQuery = useQuery({ queryKey: ['inv-config'], queryFn: fetchConfig });
  const thresholds = configQuery.data?.abc_thresholds || { A: 0.8, B: 0.95 };
  const lookbackDays = configQuery.data?.lookback_days || 180;
  const crossrefSituacaoIds: string[] = configQuery.data?.purchase_crossref_situacao_ids || [];

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
      const rop = avgDaily * leadTimeDays * safetyFactor;
      const diasCobertura = estoque !== null && avgDaily > 0 ? estoque / avgDaily : null;
      const qtyAComprar = estoque !== null ? Math.max(0, Math.ceil(rop - estoque)) : null;

      // Cross-reference with active purchase orders
      const pcEntry = pcMap.get(r.produto_id);
      const pcQty = pcEntry?.qtd || 0;
      const pcRefs = pcEntry?.refs || [];
      const qtyLiquida = qtyAComprar !== null ? Math.max(0, qtyAComprar - pcQty) : null;

      return {
        produto_id: r.produto_id,
        nome: info?.nome || `Produto ${r.produto_id}`,
        codigo_interno: info?.codigo_interno || null,
        fornecedor_id: fornecedorId,
        fornecedor_nome: fornecedorNome,
        total_qty: r.total_qty,
        total_value: r.total_value,
        event_count: r.event_count,
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
        coverage_target: coverageTarget,
      };
    });
  }, [consumptionQuery.data, namesQuery.data, stockMap, pcMap, lookbackDays, thresholds, supplierLTMap, fallbackLeadTime]);

  // Filtered items
  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return analysisItems;
    const q = searchTerm.toLowerCase();
    return analysisItems.filter(i =>
      i.nome.toLowerCase().includes(q) ||
      i.codigo_interno?.toLowerCase().includes(q) ||
      i.produto_id.includes(q)
    );
  }, [analysisItems, searchTerm]);

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

  // Purchase suggestions: price-based client thresholds
  // < R$1000 unit cost: 2+ unique clients; >= R$1000: 3+ unique clients
  const purchaseItems = useMemo(() =>
    analysisItems.filter(i => {
      if (i.qty_liquida === null || i.qty_liquida <= 0) return false;
      const avgUnitCost = i.total_qty > 0 ? i.total_value / i.total_qty : 0;
      const minClients = avgUnitCost >= 1000 ? 3 : 2;
      return i.event_count >= minClients;
    }),
    [analysisItems]
  );

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
    const headers = ['Produto ID', 'Código', 'Nome', 'Classe ABC', 'Eventos', 'Consumo Total', 'Valor Total (R$)', 'Score Híbrido', 'Consumo Médio/Dia', 'Estoque Atual', 'Dias Cobertura', 'ROP', 'A Comprar'];
    const rows = filteredItems.map((i) => [
      i.produto_id,
      i.codigo_interno || '',
      i.nome,
      i.abc_class,
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

    const headers = ['Classe ABC', 'Produto ID', 'Código', 'Nome', 'Saída (peças)', 'OS Únicas', 'Estoque Atual', 'Consumo Méd/Dia', 'Lead Time', 'ROP', 'Cobertura (dias)', 'Necessidade Bruta', 'PC em Andamento (peças)', 'Qtd Líquida a Comprar', 'PCs'];
    const rows = purchaseItems.map((i) => [
      i.abc_class,
      i.produto_id,
      i.codigo_interno || '',
      i.nome,
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

  return (
    <div className="max-w-[1400px] mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Análise de Estoque & Suprimentos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Últimos {lookbackDays} dias · {kpis.totalProdutos} SKUs com saída registrada · {Math.round(kpis.totalConsumo)} un. consumidas · ABC híbrido (valor × freq. diária)
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
      <Tabs defaultValue="compras">
        <TabsList className="flex-wrap">
          <TabsTrigger value="compras" className="gap-1"><ShoppingCart className="h-3.5 w-3.5" /> Lista de Compras</TabsTrigger>
          <TabsTrigger value="ranking" className="gap-1"><BarChart3 className="h-3.5 w-3.5" /> Ranking ABC</TabsTrigger>
          <TabsTrigger value="leadtime" className="gap-1"><Clock className="h-3.5 w-3.5" /> Lead Times</TabsTrigger>
          <TabsTrigger value="trend" className="gap-1"><TrendingUp className="h-3.5 w-3.5" /> Tendência</TabsTrigger>
        </TabsList>

        {/* LISTA DE COMPRAS (default tab) */}
        <TabsContent value="compras" className="mt-4 space-y-4">
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
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-sm font-medium">
                    🚨 <strong>{purchaseItems.length}</strong> produto(s) precisam de reposição
                    {pcMap.size > 0 && <span className="text-muted-foreground font-normal"> · {pcMap.size} produtos com PC em andamento</span>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ROP = consumo médio × lead time (por fornecedor) × segurança · Saída = peças consumidas · OS = documentos únicos · Qtd líquida = necessidade − PC em andamento
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleFetchPCs} disabled={loadingPCs} className="gap-1">
                    {loadingPCs ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    {loadingPCs ? 'Buscando PCs...' : pcMap.size > 0 ? 'Atualizar PCs' : 'Cruzar c/ PCs'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExportShoppingList} className="gap-1">
                    <Download className="h-3 w-3" /> Exportar Lista
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border overflow-auto max-h-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-12">ABC</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Saída (peças)</TableHead>
                      <TableHead className="text-right">OS</TableHead>
                      <TableHead className="text-right">Estoque</TableHead>
                      <TableHead className="text-right">Méd/dia</TableHead>
                      <TableHead className="text-right">LT</TableHead>
                      <TableHead className="text-right">ROP</TableHead>
                      <TableHead className="text-right">Cobertura</TableHead>
                      <TableHead className="text-right">Necessidade</TableHead>
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
                        <TableCell className="text-right font-medium">{Math.round(item.total_qty)}</TableCell>
                        <TableCell className="text-right text-xs">{item.event_count}</TableCell>
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
          <div className="flex items-center gap-2">
            <Input
              placeholder="Buscar por nome, código ou ID..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="max-w-sm h-9"
            />
            <span className="text-xs text-muted-foreground">{filteredItems.length} produtos</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-3 rounded-lg border overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead className="w-12">ABC</TableHead>
                    <TableHead>Produto</TableHead>
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
                Lead time calculado a partir do histórico de pedidos de compra finalizados ({leadTimes.reduce((s, l) => s + l.sample_count, 0)} amostras)
              </p>
              <div className="rounded-lg border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead className="text-right">Média (dias)</TableHead>
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
