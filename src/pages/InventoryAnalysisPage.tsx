import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getProductStock } from '@/api/gestaoclick';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Loader2, RefreshCw, Download, AlertTriangle, TrendingUp, Package, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';

// --- Types ---
interface ConsumptionRow {
  produto_id: string;
  variacao_id: string | null;
  total_qty: number;
  total_value: number;
  event_count: number;
  first_date: string;
  last_date: string;
}

interface ProductInfo {
  produto_id: string;
  nome: string;
  codigo_interno: string | null;
}

interface AnalysisItem {
  produto_id: string;
  nome: string;
  codigo_interno: string | null;
  total_qty: number;
  total_value: number;
  event_count: number;
  avg_daily: number;
  abc_class: 'A' | 'B' | 'C';
  cumulative_pct: number;
  estoque_atual: number | null;
  dias_cobertura: number | null;
  rop: number | null;
  qty_a_comprar: number | null;
}

interface TrendPoint {
  week: string;
  qty: number;
}

// --- Helper to aggregate consumption ---
async function fetchConsumptionAgg(): Promise<ConsumptionRow[]> {
  // Fetch all events and aggregate client-side (table may not be too large for 60-180 days)
  const { data, error } = await supabase
    .from('inventory_consumption_events' as any)
    .select('produto_id, variacao_id, qty, valor_custo, occurred_at')
    .order('occurred_at', { ascending: true });

  if (error) throw error;
  const rows = data as any[] || [];

  const map = new Map<string, ConsumptionRow>();
  for (const r of rows) {
    const key = r.produto_id;
    const existing = map.get(key);
    const qty = parseFloat(r.qty) || 0;
    const val = (parseFloat(r.valor_custo) || 0) * qty;
    if (existing) {
      existing.total_qty += qty;
      existing.total_value += val;
      existing.event_count++;
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
      });
    }
  }

  return [...map.values()].sort((a, b) => b.total_value - a.total_value);
}

async function fetchTrendData(): Promise<any[]> {
  const { data, error } = await supabase
    .from('inventory_consumption_events' as any)
    .select('produto_id, qty, occurred_at')
    .order('occurred_at', { ascending: true });

  if (error) throw error;
  return data as any[] || [];
}

async function fetchProductNames(ids: string[]): Promise<Map<string, ProductInfo>> {
  const map = new Map<string, ProductInfo>();
  if (ids.length === 0) return map;

  // Fetch from products_index
  const { data } = await supabase
    .from('products_index')
    .select('produto_id, nome, codigo_interno')
    .in('produto_id', ids);

  for (const p of (data || [])) {
    map.set(p.produto_id, { produto_id: p.produto_id, nome: p.nome, codigo_interno: p.codigo_interno });
  }

  return map;
}

async function fetchConfig() {
  const { data } = await supabase
    .from('inventory_policy_config' as any)
    .select('lookback_days, abc_thresholds')
    .order('created_at', { ascending: false })
    .limit(1);
  return (data as any[])?.[0] || { lookback_days: 180, abc_thresholds: { A: 0.8, B: 0.95 } };
}

export default function InventoryAnalysisPage() {
  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map());
  const [loadingStock, setLoadingStock] = useState(false);
  const [stockProgress, setStockProgress] = useState({ done: 0, total: 0 });
  const [searchTerm, setSearchTerm] = useState('');
  const [leadTimeDays, setLeadTimeDays] = useState(14);

  const configQuery = useQuery({ queryKey: ['inv-config'], queryFn: fetchConfig });
  const consumptionQuery = useQuery({ queryKey: ['inv-consumption'], queryFn: fetchConsumptionAgg });
  const trendQuery = useQuery({ queryKey: ['inv-trend'], queryFn: fetchTrendData });
  const productIds = useMemo(() => (consumptionQuery.data || []).map(r => r.produto_id), [consumptionQuery.data]);
  const namesQuery = useQuery({
    queryKey: ['inv-names', productIds.join(',')],
    queryFn: () => fetchProductNames(productIds),
    enabled: productIds.length > 0,
  });

  const thresholds = configQuery.data?.abc_thresholds || { A: 0.8, B: 0.95 };
  const lookbackDays = configQuery.data?.lookback_days || 180;

  // Build analysis items with ABC
  const analysisItems: AnalysisItem[] = useMemo(() => {
    const rows = consumptionQuery.data || [];
    const names = namesQuery.data || new Map();
    if (rows.length === 0) return [];

    const totalValue = rows.reduce((s, r) => s + r.total_value, 0);
    let cumulative = 0;

    return rows.map(r => {
      cumulative += r.total_value;
      const pct = totalValue > 0 ? cumulative / totalValue : 0;
      const info = names.get(r.produto_id);
      const avgDaily = lookbackDays > 0 ? r.total_qty / lookbackDays : 0;
      const estoque = stockMap.get(r.produto_id) ?? null;
      const rop = avgDaily * leadTimeDays * 1.2; // 20% safety margin
      const diasCobertura = estoque !== null && avgDaily > 0 ? estoque / avgDaily : null;
      const qtyAComprar = estoque !== null ? Math.max(0, Math.ceil(rop - estoque)) : null;

      return {
        produto_id: r.produto_id,
        nome: info?.nome || `Produto ${r.produto_id}`,
        codigo_interno: info?.codigo_interno || null,
        total_qty: r.total_qty,
        total_value: r.total_value,
        event_count: r.event_count,
        avg_daily: avgDaily,
        abc_class: pct <= thresholds.A ? 'A' : pct <= thresholds.B ? 'B' : 'C',
        cumulative_pct: pct,
        estoque_atual: estoque,
        dias_cobertura: diasCobertura,
        rop,
        qty_a_comprar: qtyAComprar,
      };
    });
  }, [consumptionQuery.data, namesQuery.data, stockMap, lookbackDays, thresholds, leadTimeDays]);

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

  // Trend chart data (weekly aggregation)
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
    const criticalCount = items.filter(i => i.dias_cobertura !== null && i.dias_cobertura < leadTimeDays).length;
    const totalConsumo = items.reduce((s, i) => s + i.total_qty, 0);
    const totalValor = items.reduce((s, i) => s + i.total_value, 0);
    return { aCount, bCount, cCount, criticalCount, totalConsumo, totalValor, totalProdutos: items.length };
  }, [analysisItems, leadTimeDays]);

  // Fetch stock for top products
  const handleFetchStock = async () => {
    const topItems = analysisItems.slice(0, 50); // top 50
    if (topItems.length === 0) return;

    setLoadingStock(true);
    setStockProgress({ done: 0, total: topItems.length });
    const newMap = new Map(stockMap);

    for (let i = 0; i < topItems.length; i += 3) {
      const batch = topItems.slice(i, i + 3);
      const results = await Promise.all(batch.map(item => getProductStock(item.produto_id)));
      for (const r of results) {
        if (r) newMap.set(r.produto_id, r.estoque);
      }
      setStockProgress({ done: Math.min(i + 3, topItems.length), total: topItems.length });
      if (i + 3 < topItems.length) {
        await new Promise(r => setTimeout(r, 1100));
      }
    }

    setStockMap(newMap);
    setLoadingStock(false);
    toast.success(`Estoque atualizado para ${topItems.length} produtos`);
  };

  // Export CSV
  const handleExportCSV = () => {
    const header = 'Produto ID,Código,Nome,Classe ABC,Consumo Total,Valor Total,Consumo Médio/Dia,Estoque Atual,Dias Cobertura,ROP,Qty a Comprar\n';
    const rows = filteredItems.map(i =>
      `${i.produto_id},${i.codigo_interno || ''},${i.nome.replace(/,/g, ' ')},${i.abc_class},${i.total_qty},${i.total_value.toFixed(2)},${i.avg_daily.toFixed(2)},${i.estoque_atual ?? ''},${i.dias_cobertura !== null ? i.dias_cobertura.toFixed(1) : ''},${i.rop?.toFixed(1) || ''},${i.qty_a_comprar ?? ''}`
    ).join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analise-estoque-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ABC badge color
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

  // Items needing purchase (has stock data + qty_a_comprar > 0)
  const purchaseItems = analysisItems.filter(i => i.qty_a_comprar !== null && i.qty_a_comprar > 0);

  // ABC distribution chart
  const abcChartData = [
    { name: 'Classe A', count: kpis.aCount, fill: 'hsl(var(--destructive))' },
    { name: 'Classe B', count: kpis.bCount, fill: 'hsl(var(--warning, 45 93% 47%))' },
    { name: 'Classe C', count: kpis.cCount, fill: 'hsl(var(--primary))' },
  ];

  return (
    <div className="max-w-[1400px] mx-auto p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Análise de Estoque</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Baseado nos últimos {lookbackDays} dias · {kpis.totalProdutos} produtos · {Math.round(kpis.totalConsumo)} unidades consumidas
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleFetchStock} disabled={loadingStock} className="gap-1">
            {loadingStock ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {loadingStock ? `Estoque ${stockProgress.done}/${stockProgress.total}` : 'Atualizar Estoques'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-1">
            <Download className="h-3 w-3" /> CSV
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Classe A (críticos)</p>
          <p className="text-2xl font-bold text-destructive mt-1">{kpis.aCount}</p>
          <p className="text-xs text-muted-foreground">{(thresholds.A * 100).toFixed(0)}% do valor</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Classe B</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{kpis.bCount}</p>
          <p className="text-xs text-muted-foreground">{((thresholds.B - thresholds.A) * 100).toFixed(0)}% do valor</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Classe C</p>
          <p className="text-2xl font-bold text-primary mt-1">{kpis.cCount}</p>
          <p className="text-xs text-muted-foreground">{((1 - thresholds.B) * 100).toFixed(0)}% do valor</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Abaixo do ROP</p>
          <p className="text-2xl font-bold mt-1">{kpis.criticalCount > 0 ? (
            <span className="text-destructive">{kpis.criticalCount}</span>
          ) : (
            <span className="text-primary">0</span>
          )}</p>
          <p className="text-xs text-muted-foreground">Precisam reposição</p>
        </Card>
      </div>

      {/* Lead time config */}
      <Card className="p-4 flex items-center gap-4">
        <span className="text-sm font-medium text-foreground whitespace-nowrap">Lead Time estimado:</span>
        <Input
          type="number"
          min={1}
          max={90}
          value={leadTimeDays}
          onChange={e => setLeadTimeDays(parseInt(e.target.value) || 14)}
          className="w-20 h-8"
        />
        <span className="text-sm text-muted-foreground">dias (usado para calcular ROP e cobertura)</span>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="ranking">
        <TabsList>
          <TabsTrigger value="ranking" className="gap-1"><TrendingUp className="h-3.5 w-3.5" /> Ranking ABC</TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Reposição</TabsTrigger>
          <TabsTrigger value="trend" className="gap-1"><TrendingUp className="h-3.5 w-3.5" /> Tendência</TabsTrigger>
        </TabsList>

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

          <div className="rounded-lg border overflow-auto max-h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead className="w-14">ABC</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Consumo</TableHead>
                  <TableHead className="text-right">Valor (R$)</TableHead>
                  <TableHead className="text-right">Méd/dia</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Cobertura</TableHead>
                  <TableHead className="text-right">% Acum.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item, idx) => (
                  <TableRow key={item.produto_id} className={item.dias_cobertura !== null && item.dias_cobertura < leadTimeDays ? 'bg-destructive/5' : ''}>
                    <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell>{abcBadge(item.abc_class)}</TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium truncate max-w-[300px]">{item.nome}</p>
                        {item.codigo_interno && <p className="text-xs text-muted-foreground">{item.codigo_interno}</p>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{Math.round(item.total_qty)}</TableCell>
                    <TableCell className="text-right">{item.total_value.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{item.avg_daily.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      {item.estoque_atual !== null ? item.estoque_atual : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.dias_cobertura !== null ? (
                        <span className={item.dias_cobertura < leadTimeDays ? 'text-destructive font-bold' : ''}>
                          {item.dias_cobertura.toFixed(0)}d
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {(item.cumulative_pct * 100).toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* REPOSIÇÃO / PURCHASE SUGGESTIONS */}
        <TabsContent value="alerts" className="mt-4 space-y-4">
          {stockMap.size === 0 ? (
            <Card className="p-8 text-center">
              <AlertTriangle className="h-10 w-10 mx-auto text-amber-500 mb-3" />
              <h3 className="font-semibold">Estoque não carregado</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Clique em "Atualizar Estoques" para buscar o saldo atual dos 50 produtos mais críticos e ver sugestões de compra.
              </p>
              <Button variant="outline" className="mt-4 gap-1" onClick={handleFetchStock} disabled={loadingStock}>
                <RefreshCw className="h-3 w-3" /> Atualizar Estoques
              </Button>
            </Card>
          ) : purchaseItems.length === 0 ? (
            <Card className="p-8 text-center">
              <ShoppingCart className="h-10 w-10 mx-auto text-primary mb-3" />
              <h3 className="font-semibold">Nenhum item precisa de reposição</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Todos os produtos analisados estão acima do ponto de reposição (ROP).
              </p>
            </Card>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {purchaseItems.length} produto(s) abaixo do ponto de reposição (consumo médio × {leadTimeDays} dias × 1.2 segurança)
              </p>
              <div className="rounded-lg border overflow-auto max-h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">ABC</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Estoque</TableHead>
                      <TableHead className="text-right">Méd/dia</TableHead>
                      <TableHead className="text-right">ROP</TableHead>
                      <TableHead className="text-right">Cobertura</TableHead>
                      <TableHead className="text-right font-bold">Comprar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchaseItems.map(item => (
                      <TableRow key={item.produto_id} className="bg-destructive/5">
                        <TableCell>{abcBadge(item.abc_class)}</TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium truncate max-w-[300px]">{item.nome}</p>
                            {item.codigo_interno && <p className="text-xs text-muted-foreground">{item.codigo_interno}</p>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{item.estoque_atual}</TableCell>
                        <TableCell className="text-right">{item.avg_daily.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{item.rop?.toFixed(0)}</TableCell>
                        <TableCell className="text-right">
                          <span className="text-destructive font-bold">{item.dias_cobertura?.toFixed(0)}d</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="destructive" className="font-bold">{item.qty_a_comprar}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>

        {/* TREND CHART */}
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

          {/* ABC Distribution */}
          <Card className="p-6">
            <h3 className="text-sm font-semibold mb-4">Distribuição ABC (por número de produtos)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={abcChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={80} />
                <Tooltip formatter={(v: number) => [`${v} produtos`, 'Quantidade']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {abcChartData.map((entry, index) => (
                    <Bar key={index} dataKey="count" fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
