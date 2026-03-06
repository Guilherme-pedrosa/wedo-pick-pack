import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStatusOrcamentos } from '@/api/compras';
import { rastrearOrcamentos, RastreadorResult, OrcamentoReadiness, ConflictInfo } from '@/api/rastreador';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Search, Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight,
  PackageCheck, Clock, RefreshCw, Download, Printer,
} from 'lucide-react';
import { toast } from 'sonner';

function exportCSV(result: RastreadorResult) {
  const header = ['Status', 'Código ORC', 'Cliente', 'Data', 'Itens Prontos', 'Total Itens', 'Produto', 'Qtd Necessária', 'Estoque Disponível', 'Estoque Total', 'Item Pronto'];
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
  a.download = `rastreador-orcamentos-${result.scannedAt.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatDateBR(d: string) {
  try { const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; } catch { return d; }
}

export default function RastreadorPage() {
  const [selectedSituacoes, setSelectedSituacoes] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ step: '', checked: 0, total: 0 });
  const [result, setResult] = useState<RastreadorResult | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPrintView, setIsPrintView] = useState(false);

  const statusQuery = useQuery({
    queryKey: ['status-orcamentos'],
    queryFn: getStatusOrcamentos,
  });

  const toggleSituacao = (id: string) => {
    setSelectedSituacoes(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const handleScan = async () => {
    if (selectedSituacoes.length === 0) return;
    setScanning(true);
    setResult(null);
    setProgress({ step: 'Iniciando…', checked: 0, total: 0 });
    try {
      const res = await rastrearOrcamentos(
        selectedSituacoes,
        (step, checked, total) => setProgress({ step, checked, total }),
      );
      setResult(res);
      toast.success(
        `Rastreamento concluído! ${res.totalProntos} de ${res.totalOrcamentos} orçamentos prontos para OS.`
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

  const formatDate = formatDateBR;

  const OrcamentoCard = ({ entry, ready }: { entry: OrcamentoReadiness; ready: boolean }) => {
    const expanded = expandedId === entry.orcamento.id;
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
                <span className="font-semibold text-sm">#{entry.orcamento.codigo}</span>
                <Badge
                  variant={ready ? 'default' : 'secondary'}
                  className={`text-[10px] px-1.5 ${ready ? 'bg-green-600' : 'bg-amber-600 text-white'}`}
                >
                  {entry.itensProntos}/{entry.totalItens}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate max-w-[250px]">
                {entry.orcamento.nome_cliente}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{formatDate(entry.orcamento.data)}</span>
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
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] bg-background">
      {/* Top controls */}
      <div className="bg-card border-b border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">Rastreador de Orçamentos</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Selecione as situações para verificar quais orçamentos já possuem todas as peças em estoque e podem virar OS.
        </p>

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

        <div className="flex items-center gap-2">
          <Button
            onClick={handleScan}
            disabled={selectedSituacoes.length === 0 || scanning}
            className="gap-2"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Rastrear Orçamentos
          </Button>
          {result && (
            <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Atualizar
            </Button>
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
            <p className="text-sm">Selecione as situações e clique em "Rastrear" para verificar</p>
          </div>
        )}

        {result && (
          <div className="space-y-6 max-w-3xl mx-auto">
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
