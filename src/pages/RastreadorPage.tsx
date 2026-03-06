import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStatusOrcamentos, getStatusCompras } from '@/api/compras';
import { rastrearOrcamentos, RastreadorResult, OrcamentoReadiness, ConflictInfo } from '@/api/rastreador';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Search, Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight,
  PackageCheck, Clock, RefreshCw, Download, Printer, Package, X, Truck,
} from 'lucide-react';
import { toast } from 'sonner';

function exportCSV(result: RastreadorResult) {
  const header = ['Status', 'Código ORC', 'Cliente', 'Data', 'Itens Prontos', 'Total Itens', 'Produto', 'Qtd Necessária', 'Estoque Disponível', 'Estoque Total', 'Em Compra', 'Coberto por Pedido', 'Item Pronto'];
  const rows: string[][] = [];

  const addRows = (entries: OrcamentoReadiness[], status: string) => {
    for (const e of entries) {
      for (const item of e.itens) {
        rows.push([
          status,
          e.orcamento.codigo,
          e.orcamento.nome_cliente,
          e.orcamento.data,
          String(e.itensProntos),
          String(e.totalItens),
          item.nome_produto,
          String(item.qtd_necessaria),
          String(item.estoque_disponivel),
          String(item.estoque_total),
          String(item.qtd_em_compra),
          item.coberto_por_compra ? 'Sim' : 'Não',
          item.pronto ? 'Sim' : 'Não',
        ]);
      }
    }
  };

  addRows(result.orcamentosProntos, 'Pronto para OS');
  addRows(result.orcamentosPendentes, 'Aguardando peças');

  const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cruzamento-os-estoque-${result.scannedAt.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatDateBR(d: string) {
  try { const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; } catch { return d; }
}

export default function RastreadorPage() {
  const [selectedSituacoes, setSelectedSituacoes] = useState<string[]>([]);
  const [selectedCompra, setSelectedCompra] = useState<string[]>([]);
  const [compraHydrated, setCompraHydrated] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ step: '', checked: 0, total: 0 });
  const [result, setResult] = useState<RastreadorResult | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPrintView, setIsPrintView] = useState(false);
  const [convertidosDismissed, setConvertidosDismissed] = useState(false);

  const statusQuery = useQuery({
    queryKey: ['status-orcamentos'],
    queryFn: getStatusOrcamentos,
  });

  const statusCompraQuery = useQuery({
    queryKey: ['status-compras'],
    queryFn: getStatusCompras,
  });

  // Auto-select all purchase order statuses on first load
  useEffect(() => {
    if (compraHydrated) return;
    if (statusCompraQuery.data && statusCompraQuery.data.length > 0) {
      setSelectedCompra(statusCompraQuery.data.map(s => s.id));
      setCompraHydrated(true);
    }
  }, [statusCompraQuery.data, compraHydrated]);

  const toggleSituacao = (id: string) => {
    setSelectedSituacoes(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const toggleCompra = (id: string) => {
    setSelectedCompra(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const handleScan = async () => {
    if (selectedSituacoes.length === 0) return;
    setScanning(true);
    setResult(null);
    setConvertidosDismissed(false);
    setProgress({ step: 'Iniciando…', checked: 0, total: 0 });
    try {
      const res = await rastrearOrcamentos(
        selectedSituacoes,
        selectedCompra,
        (step, checked, total) => setProgress({ step, checked, total }),
      );
      setResult(res);
      toast.success(
        `Cruzamento concluído! ${res.totalProntos} de ${res.totalOrcamentos} orçamentos prontos para OS.`
      );
    } catch (err) {
      toast.error('Erro ao rastrear orçamentos');
      console.error(err);
    } finally {
      setScanning(false);
    }
  };

  const handlePrint = () => {
    setIsPrintView(true);
    setTimeout(() => {
      window.print();
      setIsPrintView(false);
    }, 300);
  };

  const convertidos = result?.orcamentosConvertidos ?? [];
  const convertedIds = useMemo(() => new Set(convertidos.map(c => c.orcamento_id)), [convertidos]);

  const OrcamentoCard = ({ entry, ready }: { entry: OrcamentoReadiness; ready: boolean }) => {
    const expanded = expandedId === entry.orcamento.id;
    const isConverted = convertedIds.has(entry.orcamento.id);
    return (
      <Card
        className={`p-3 border-l-4 cursor-pointer transition-colors hover:bg-muted/50 ${
          ready ? 'border-l-green-500' : 'border-l-amber-500'
        }`}
        onClick={() => setExpandedId(expanded ? null : entry.orcamento.id)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {ready
              ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            }
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm font-mono">#{entry.orcamento.codigo}</span>
                <Badge
                  variant={ready ? 'default' : 'secondary'}
                  className={`text-[10px] px-1.5 ${ready ? 'bg-green-600' : 'bg-amber-600 text-white'}`}
                >
                  {entry.itensProntos}/{entry.totalItens}
                </Badge>
                {entry.itensCobertosCompra > 0 && (
                  <Badge className="text-[10px] px-1.5 bg-blue-600 text-white">
                    <Truck className="h-2.5 w-2.5 mr-0.5" />
                    {entry.itensCobertosCompra} em compra
                  </Badge>
                )}
                {isConverted && (
                  <Badge className="text-[10px] px-1.5 bg-amber-500 text-white">
                    Convertido
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate max-w-[250px]">
                {entry.orcamento.nome_cliente}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{formatDateBR(entry.orcamento.data)}</span>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
        </div>

        {expanded && (
          <div className="mt-3 space-y-1.5 border-t border-border pt-2">
            {entry.itens.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {item.pronto
                    ? <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                    : item.coberto_por_compra
                      ? <Truck className="h-3 w-3 text-blue-500 shrink-0" />
                      : <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
                  }
                  <span className="truncate">{item.nome_produto}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                  <span>Precisa: {item.qtd_necessaria}</span>
                  <span>|</span>
                  <span className={item.pronto ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>
                    Disp: {item.estoque_disponivel}
                  </span>
                  {item.estoque_disponivel !== item.estoque_total && (
                    <span className="text-muted-foreground">(total: {item.estoque_total})</span>
                  )}
                  {item.qtd_em_compra > 0 && (
                    <span className="text-blue-600 font-medium">📦 {item.qtd_em_compra} em compra</span>
                  )}
                </div>
              </div>
            ))}
            {/* Show purchase order details if any item has orders */}
            {entry.itens.some(i => i.ordens_compra.length > 0) && (
              <div className="mt-2 pt-2 border-t border-border/50">
                <p className="text-[11px] font-semibold text-muted-foreground mb-1">Pedidos de Compra Relacionados:</p>
                {[...new Map(entry.itens.flatMap(i => i.ordens_compra).map(o => [o.id, o])).values()].map(o => (
                  <div key={o.id} className="text-[11px] text-muted-foreground flex items-center gap-2">
                    <span className="font-mono">PC #{o.codigo}</span>
                    <span>— {o.nome_fornecedor}</span>
                    <Badge variant="outline" className="text-[9px] px-1">{o.situacao}</Badge>
                    {o.data_previsao && (
                      <span className="text-blue-600">Prazo: {formatDateBR(o.data_previsao)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    );
  };

  // Print view
  if (isPrintView && result) {
    const renderSection = (title: string, entries: OrcamentoReadiness[]) => (
      entries.length > 0 && (
        <div className="mb-6">
          <h2 className="text-base font-bold mb-2 border-b pb-1">{title} ({entries.length})</h2>
          {entries.map(e => (
            <div key={e.orcamento.id} className="mb-4">
              <div className="flex justify-between items-baseline mb-1">
                <span className="font-semibold text-sm">
                  #{e.orcamento.codigo} — {e.orcamento.nome_cliente}
                </span>
                <span className="text-xs">{formatDateBR(e.orcamento.data)} | {e.itensProntos}/{e.totalItens} itens OK</span>
              </div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-0.5 pr-2">Produto</th>
                    <th className="text-right py-0.5 px-2">Precisa</th>
                    <th className="text-right py-0.5 px-2">Disponível</th>
                    <th className="text-right py-0.5 px-2">Total</th>
                    <th className="text-right py-0.5 px-2">Em Compra</th>
                    <th className="text-center py-0.5 pl-2">OK?</th>
                  </tr>
                </thead>
                <tbody>
                  {e.itens.map((item, idx) => (
                    <tr key={idx} className="border-b border-gray-200">
                      <td className="py-0.5 pr-2">{item.nome_produto}</td>
                      <td className="text-right py-0.5 px-2">{item.qtd_necessaria}</td>
                      <td className="text-right py-0.5 px-2">{item.estoque_disponivel}</td>
                      <td className="text-right py-0.5 px-2">{item.estoque_total}</td>
                      <td className="text-right py-0.5 px-2">{item.qtd_em_compra || '—'}</td>
                      <td className="text-center py-0.5 pl-2">{item.pronto ? '✅' : item.coberto_por_compra ? '📦' : '❌'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )
    );

    return (
      <div className="p-6 bg-white text-black print-content">
        <h1 className="text-xl font-bold mb-1">Cruzamento OS e Estoque</h1>
        <p className="text-xs text-gray-500 mb-4">
          Gerado em {new Date(result.scannedAt).toLocaleString('pt-BR')} |
          {result.totalProntos} prontos de {result.totalOrcamentos} analisados
        </p>
        {renderSection('✅ Prontos para virar OS', result.orcamentosProntos)}
        {result.conflitos.length > 0 && (
          <div className="mb-6">
            <h2 className="text-base font-bold mb-2 border-b pb-1">⚠️ Conflitos de Estoque ({result.conflitos.length})</h2>
            {result.conflitos.map(c => (
              <div key={c.produto_key} className="mb-2 text-xs">
                <span className="font-medium">{c.nome_produto}</span> — Estoque: {c.estoque_total}, Demanda: {c.demanda_total}
                <div className="ml-4">
                  {c.orcamentos_envolvidos.map(o => (
                    <div key={o.id}>#{o.codigo} — {o.nome_cliente} — precisa {o.qtd}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {renderSection('⏳ Aguardando peças', result.orcamentosPendentes)}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] bg-background no-print-content">
      {/* Top controls */}
      <div className="bg-card border-b border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">Cruzamento OS e Estoque</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Selecione as situações para verificar quais orçamentos já possuem todas as peças em estoque e podem virar OS.
        </p>

        {/* Budget status selection */}
        <div className="flex items-center gap-2 mb-1">
          <PackageCheck className="h-4 w-4 text-green-600" />
          <h3 className="text-xs font-bold text-foreground">Situações de Orçamento</h3>
        </div>
        {statusQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando situações…
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {(statusQuery.data || []).map(s => (
              <label key={s.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox
                  checked={selectedSituacoes.includes(s.id)}
                  onCheckedChange={() => toggleSituacao(s.id)}
                  disabled={scanning}
                />
                {s.nome}
              </label>
            ))}
          </div>
        )}

        <Separator />

        {/* Purchase order status selection */}
        <div className="flex items-center gap-2 mb-1">
          <Package className="h-4 w-4 text-amber-600" />
          <h3 className="text-xs font-bold text-foreground">Pedidos de Compra — Cruzamento</h3>
        </div>
        <p className="text-[11px] text-muted-foreground leading-tight">
          Marque os status de compra em andamento para cruzar com o estoque. Selecionados: {selectedCompra.length}.
        </p>
        {statusCompraQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {(statusCompraQuery.data || []).map(s => (
              <label key={s.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox
                  checked={selectedCompra.includes(s.id)}
                  onCheckedChange={() => toggleCompra(s.id)}
                  disabled={scanning}
                />
                {s.nome}
              </label>
            ))}
          </div>
        )}

        <Separator />

        <div className="flex items-center gap-2">
          <Button
            onClick={handleScan}
            disabled={selectedSituacoes.length === 0 || scanning}
            className="gap-2"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Cruzar OS e Estoque
          </Button>
          {result && (
            <>
              <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Atualizar
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportCSV(result)} className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                CSV
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
                <Printer className="h-3.5 w-3.5" />
                PDF
              </Button>
            </>
          )}
        </div>

        {scanning && (
          <div className="space-y-1">
            <Progress value={progress.total > 0 ? (progress.checked / progress.total) * 100 : 0} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              {progress.step} {progress.total > 0 ? `${progress.checked}/${progress.total}` : ''}
            </p>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4">
        {!result && !scanning && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <Search className="h-10 w-10 opacity-30" />
            <p className="text-sm">Selecione as situações e clique em "Cruzar OS e Estoque" para verificar</p>
          </div>
        )}

        {result && (
          <div className="space-y-6 max-w-3xl mx-auto">
            {/* Converted budgets warning */}
            {convertidos.length > 0 && !convertidosDismissed && (
              <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-amber-900">
                      Atenção — {convertidos.length} orçamento(s) já convertido(s)
                    </h3>
                    <p className="text-sm text-amber-800 mt-1">
                      Os orçamentos abaixo já geraram Venda ou OS no GestãoClick. Verifique antes de prosseguir.
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {convertidos.map(c => (
                        <Badge
                          key={c.orcamento_id}
                          className="bg-amber-100 text-amber-900 border border-amber-300 text-xs font-mono"
                        >
                          {c.codigo} — {c.nome_cliente}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConvertidosDismissed(true)}
                        className="gap-1.5"
                      >
                        <X className="h-3.5 w-3.5" /> Ignorar e continuar
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Card className="p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{result.totalOrcamentos}</p>
                <p className="text-xs text-muted-foreground">Total analisados</p>
              </Card>
              <Card className="p-3 text-center border-green-500/50 bg-green-500/5">
                <p className="text-2xl font-bold text-green-600">{result.totalProntos}</p>
                <p className="text-xs text-muted-foreground">Prontos para OS</p>
              </Card>
              <Card className="p-3 text-center border-amber-500/50 bg-amber-500/5">
                <p className="text-2xl font-bold text-amber-600">
                  {result.totalOrcamentos - result.totalProntos}
                </p>
                <p className="text-xs text-muted-foreground">Aguardando peças</p>
              </Card>
            </div>

            <p className="text-xs text-muted-foreground text-right">
              Escaneado em {new Date(result.scannedAt).toLocaleString('pt-BR')}
            </p>

            {/* Ready budgets */}
            {result.orcamentosProntos.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <PackageCheck className="h-4 w-4 text-green-600" />
                  <h2 className="text-sm font-bold text-foreground">
                    Prontos para virar OS ({result.orcamentosProntos.length})
                  </h2>
                </div>
                <div className="space-y-2">
                  {result.orcamentosProntos.map(entry => (
                    <OrcamentoCard key={entry.orcamento.id} entry={entry} ready />
                  ))}
                </div>
            </div>
            )}

            {/* Conflicts */}
            {result.conflitos.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <h2 className="text-sm font-bold text-foreground">
                      Conflitos de estoque ({result.conflitos.length})
                    </h2>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Peças disputadas por múltiplos orçamentos — o estoque não atende todos.
                  </p>
                  <div className="space-y-2">
                    {result.conflitos.map(c => (
                      <Card key={c.produto_key} className="p-3 border-l-4 border-l-red-500">
                        <p className="font-medium text-sm">{c.nome_produto}</p>
                        <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                          <span>Estoque: <strong className="text-foreground">{c.estoque_total}</strong></span>
                          <span>Demanda total: <strong className="text-red-500">{c.demanda_total}</strong></span>
                        </div>
                        <div className="mt-2 space-y-0.5">
                          {c.orcamentos_envolvidos.map(o => (
                            <div key={o.id} className="text-xs text-muted-foreground">
                              #{o.codigo} — {o.nome_cliente} — precisa {o.qtd}
                            </div>
                          ))}
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              </>
            )}

            <Separator />

            {/* Pending budgets */}
            {result.orcamentosPendentes.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600" />
                  <h2 className="text-sm font-bold text-foreground">
                    Aguardando peças ({result.orcamentosPendentes.length})
                  </h2>
                </div>
                <div className="space-y-2">
                  {result.orcamentosPendentes.map(entry => (
                    <OrcamentoCard key={entry.orcamento.id} entry={entry} ready={false} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
