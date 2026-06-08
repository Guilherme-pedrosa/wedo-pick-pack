import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Search, RefreshCw, Package, AlertTriangle, CheckCircle2, ShoppingCart, FileText, Wrench, Settings, Receipt } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  buildExplorerIndex,
  clearExplorerIndex,
  getExplorerStatus,
  getProductExplorerData,
  searchProducts,
  ProductExplorerData,
  ProductSearchResult,
} from '@/api/produtoExplorer';
import { logSystemAction } from '@/lib/systemLog';

const fmtQty = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const fmtMoney = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtPct = (n: number) =>
  `${(n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

const fmtDate = (s: string) => {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('pt-BR');
};

export default function ProductExplorerPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ProductSearchResult | null>(null);
  const [data, setData] = useState<ProductExplorerData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [indexReady, setIndexReady] = useState(!!getExplorerStatus());
  const [indexProgress, setIndexProgress] = useState<string>('');
  const [building, setBuilding] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    logSystemAction({ module: 'compras', action: 'Acessou Explorador de Peças' });
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchProducts(query);
        setResults(res);
      } catch (e) {
        toast.error('Erro na busca de produtos');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function ensureIndex(force = false) {
    setBuilding(true);
    try {
      await buildExplorerIndex((step, p, t) => {
        setIndexProgress(`${step} ${p}/${t}`);
      }, force);
      setIndexReady(true);
      setIndexProgress('');
    } catch (e) {
      toast.error('Falha ao construir índice');
    } finally {
      setBuilding(false);
    }
  }

  async function loadProduct(p: ProductSearchResult) {
    setSelected(p);
    setLoadingDetail(true);
    setData(null);
    try {
      if (!getExplorerStatus()) await ensureIndex();
      const d = await getProductExplorerData(p.produto_id);
      setData(d);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar';
      toast.error(msg);
    } finally {
      setLoadingDetail(false);
    }
  }

  const status = getExplorerStatus();
  const lastBuilt = useMemo(() => {
    if (!status) return null;
    return new Date(status.builtAt).toLocaleString('pt-BR');
  }, [status, indexReady, building]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Explorador de Peças</h1>
          <p className="text-sm text-muted-foreground">
            Digite o código ou nome da peça para ver OS, orçamentos, pedidos de compra e saúde do estoque.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastBuilt && (
            <span className="text-xs text-muted-foreground">
              Índice: {lastBuilt}
            </span>
          )}
          <Link to="/produtos/explorar/config">
            <Button variant="outline" size="sm" className="gap-2">
              <Settings className="h-4 w-4" /> Configurar
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { clearExplorerIndex(); setIndexReady(false); ensureIndex(true); }}
            disabled={building}
          >
            {building ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Reindexar
          </Button>
        </div>
      </div>

      {building && (
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm">{indexProgress || 'Construindo índice…'}</span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" /> Buscar peça
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Código interno, código de barras, ID ou nome…"
            autoFocus
          />
          {searching && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> buscando…
            </div>
          )}
          {results.length > 0 && (
            <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
              {results.map(r => (
                <button
                  key={r.produto_id}
                  onClick={() => loadProduct(r)}
                  className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors text-sm"
                >
                  <div className="font-medium">
                    [{r.codigo_interno || r.produto_id}] {r.nome}
                  </div>
                  {r.codigo_barra && (
                    <div className="text-xs text-muted-foreground">EAN: {r.codigo_barra}</div>
                  )}
                </button>
              ))}
            </div>
          )}
          {!searching && query && results.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhum produto encontrado.</p>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="h-5 w-5" />
              [{selected.codigo_interno || selected.produto_id}] {selected.nome}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingDetail || !data ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                {indexProgress || 'Carregando dados da peça…'}
              </div>
            ) : (
              <ProductDetail data={data} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HealthBadge({ h }: { h: ProductExplorerData['health'] }) {
  if (h === 'ok')
    return (
      <Badge className="bg-emerald-500 hover:bg-emerald-500 text-white gap-1">
        <CheckCircle2 className="h-3 w-3" /> Saudável
      </Badge>
    );
  if (h === 'warn')
    return (
      <Badge className="bg-amber-500 hover:bg-amber-500 text-white gap-1">
        <AlertTriangle className="h-3 w-3" /> Atenção
      </Badge>
    );
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="h-3 w-3" /> Precisa Comprar
    </Badge>
  );
}

function Kpi({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone?: string }) {
  return (
    <div className={`rounded-lg border p-3 flex flex-col gap-1 ${tone ?? ''}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function PriceSummaryCard({ s }: { s: ProductExplorerData['priceSummary'] }) {
  // alerta: vendendo abaixo ou muito perto do custo (margem < 16%)
  const lowMargin = s.margem_pct !== null && s.margem_pct < 0.16;
  const negative = s.margem_pct !== null && s.margem_pct < 0;
  const marginTone = s.margem_pct === null
    ? ''
    : negative
      ? 'border-destructive bg-destructive/10'
      : lowMargin
        ? 'border-amber-500 bg-amber-500/10'
        : 'border-emerald-500 bg-emerald-500/10';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Receipt className="h-4 w-4" /> Vendas x Compras (valores)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Vendido */}
          <div className="rounded-lg border p-4 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Vendido (OS + Vendas)</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{fmtQty(s.qtd_vendida)}</span>
              <span className="text-xs text-muted-foreground">un · {s.num_vendas} registros</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm pt-1">
              <div><span className="text-muted-foreground">Preço médio:</span> <strong>{fmtMoney(s.preco_venda_medio)}</strong></div>
              <div><span className="text-muted-foreground">Último:</span> <strong>{fmtMoney(s.ultimo_preco_venda)}</strong></div>
              <div><span className="text-muted-foreground">Mín:</span> {fmtMoney(s.preco_venda_min)}</div>
              <div><span className="text-muted-foreground">Máx:</span> {fmtMoney(s.preco_venda_max)}</div>
            </div>
          </div>
          {/* Comprado */}
          <div className="rounded-lg border p-4 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Comprado (Pedidos)</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{fmtQty(s.qtd_comprada)}</span>
              <span className="text-xs text-muted-foreground">un · {s.num_compras} registros</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm pt-1">
              <div><span className="text-muted-foreground">Custo médio:</span> <strong>{fmtMoney(s.custo_medio)}</strong></div>
              <div><span className="text-muted-foreground">Último custo:</span> <strong>{fmtMoney(s.ultimo_custo)}</strong></div>
            </div>
          </div>
        </div>

        {/* Margem */}
        <div className={`rounded-lg border p-4 flex flex-wrap items-center gap-x-6 gap-y-2 ${marginTone}`}>
          <div className="flex items-center gap-2">
            {negative ? (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            ) : lowMargin ? (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            )}
            <span className="text-sm font-medium">
              Margem média:{' '}
              <strong className="text-lg">
                {s.margem_pct === null ? '—' : fmtPct(s.margem_pct)}
              </strong>
            </span>
          </div>
          <div className="text-sm text-muted-foreground">
            Venda média {fmtMoney(s.preco_venda_medio)} − Custo médio {fmtMoney(s.custo_medio)} ={' '}
            <strong className={negative ? 'text-destructive' : ''}>
              {fmtMoney(s.preco_venda_medio - s.custo_medio)}
            </strong>
          </div>
          {s.margem_pct !== null && (negative || lowMargin) && (
            <span className="text-sm font-semibold">
              {negative ? '⚠️ Vendendo ABAIXO do custo!' : '⚠️ Margem apertada (perto do custo)'}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProductDetail({ data }: { data: ProductExplorerData }) {
  const need = Math.max(0, -data.saldo_projetado);
  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Kpi label="Estoque atual" value={fmtQty(data.estoque)} icon={<Package className="h-3 w-3" />} />
        <Kpi label="Demanda OS" value={fmtQty(data.qtd_demanda_os)} icon={<Wrench className="h-3 w-3" />} />
        <Kpi label="Demanda Orçamentos" value={fmtQty(data.qtd_demanda_orcamentos)} icon={<FileText className="h-3 w-3" />} />
        <Kpi label="Demanda Vendas" value={fmtQty(data.qtd_demanda_vendas)} icon={<Receipt className="h-3 w-3" />} />
        <Kpi label="Em Pedido de Compra" value={fmtQty(data.qtd_em_compra)} icon={<ShoppingCart className="h-3 w-3" />} />
        <Kpi label="Saldo Projetado" value={fmtQty(data.saldo_projetado)} icon={<AlertTriangle className="h-3 w-3" />} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <HealthBadge h={data.health} />
        {data.health !== 'ok' && need > 0 && (
          <span className="text-sm">
            Necessidade de compra estimada: <strong>{fmtQty(need)}</strong>
          </span>
        )}
        {data.detalhe?.nome_grupo && (
          <Badge variant="outline">Grupo: {data.detalhe.nome_grupo}</Badge>
        )}
      </div>

      <PriceSummaryCard s={data.priceSummary} />

      <Tabs defaultValue="os">
        <TabsList>
          <TabsTrigger value="os">OS ({data.oss.length})</TabsTrigger>
          <TabsTrigger value="orc">Orçamentos ({data.orcamentos.length})</TabsTrigger>
          <TabsTrigger value="vendas">Vendas ({data.vendas.length})</TabsTrigger>
          <TabsTrigger value="compras">Pedidos de Compra ({data.compras.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="os">
          {data.oss.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Nenhuma OS encontrada com essa peça.</p>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.oss.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">#{o.codigo}</TableCell>
                      <TableCell>{o.nome_cliente || '—'}</TableCell>
                      <TableCell><Badge variant="outline">{o.nome_situacao || '—'}</Badge></TableCell>
                      <TableCell>{fmtDate(o.data)}</TableCell>
                      <TableCell className="text-right">{fmtQty(o.qtd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="orc">
          {data.orcamentos.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Nenhum orçamento encontrado com essa peça.</p>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.orcamentos.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">#{o.codigo}</TableCell>
                      <TableCell>{o.nome_cliente || '—'}</TableCell>
                      <TableCell><Badge variant="outline">{o.nome_situacao || '—'}</Badge></TableCell>
                      <TableCell>{fmtDate(o.data)}</TableCell>
                      <TableCell className="text-right">{fmtQty(o.qtd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="vendas">
          {data.vendas.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Nenhuma venda encontrada com essa peça.</p>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.vendas.map(v => (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">#{v.codigo}</TableCell>
                      <TableCell>{v.nome_cliente || '—'}</TableCell>
                      <TableCell><Badge variant="outline">{v.nome_situacao || '—'}</Badge></TableCell>
                      <TableCell>{fmtDate(v.data)}</TableCell>
                      <TableCell className="text-right">{fmtQty(v.qtd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>


        <TabsContent value="compras">
          {data.compras.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Nenhum pedido de compra encontrado para essa peça.</p>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.compras.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">#{c.codigo}</TableCell>
                      <TableCell>{c.nome_fornecedor || '—'}</TableCell>
                      <TableCell><Badge variant="outline">{c.nome_situacao || '—'}</Badge></TableCell>
                      <TableCell>{fmtDate(c.data)}</TableCell>
                      <TableCell className="text-right">{fmtQty(c.qtd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
