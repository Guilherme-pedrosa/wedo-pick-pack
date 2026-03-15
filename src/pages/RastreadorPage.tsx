import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStatusOrcamentos } from '@/api/compras';
import { rastrearOrcamentos, RastreadorResult, OrcamentoReadiness, ConflictInfo } from '@/api/rastreador';
import { OrcamentoConvertidoWarning } from '@/api/types';
import { GCOrcamento } from '@/api/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import {
  Search, Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight,
  PackageCheck, Clock, RefreshCw, Download, Printer, User, Filter, Ban, X,
  Zap,
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
  const [nomeCliente, setNomeCliente] = useState('');
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ step: '', checked: 0, total: 0 });
  const [result, setResult] = useState<RastreadorResult | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPrintView, setIsPrintView] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [blockedExpanded, setBlockedExpanded] = useState(true);

  // OS generation state
  const [generatingOS, setGeneratingOS] = useState(false);
  const [confirmEntry, setConfirmEntry] = useState<OrcamentoReadiness | null>(null);
  const [generationResult, setGenerationResult] = useState<{
    success: boolean;
    auvoTaskId?: number;
    osCodigo?: string;
    error?: string;
  } | null>(null);

  const handleGenerateOS = async (entry: OrcamentoReadiness) => {
    setGeneratingOS(true);
    setGenerationResult(null);
    try {
      // Get current user profile for auvo_user_id and gc_usuario_id
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessão expirada');

      const { data: profile } = await supabase
        .from('profiles')
        .select('auvo_user_id, gc_usuario_id')
        .eq('id', user.id)
        .maybeSingle();

      const auvoUserId = (profile as any)?.auvo_user_id;
      if (!auvoUserId) {
        toast.error('Configure seu ID de Usuário Auvo nas Configurações antes de gerar OS.');
        setConfirmEntry(null);
        setGeneratingOS(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('generate-os', {
        body: {
          orcamento: entry.orcamento,
          auvo_user_id: auvoUserId,
          gc_usuario_id: (profile as any)?.gc_usuario_id || undefined,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      setGenerationResult({
        success: true,
        auvoTaskId: data.auvo_task_id,
        osCodigo: data.os_codigo,
      });
      toast.success(`OS #${data.os_codigo} criada com sucesso! Tarefa Auvo: ${data.auvo_task_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setGenerationResult({ success: false, error: msg });
      toast.error(`Erro ao gerar OS: ${msg}`);
    } finally {
      setGeneratingOS(false);
    }
  };

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
        nomeCliente.trim() || undefined,
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

  function getEquipamento(orc: GCOrcamento): string {
    // Try atributos first (campo extra "Equipamento")
    const attr = orc.atributos?.find(a => a.atributo.descricao?.toLowerCase() === 'equipamento');
    if (attr?.atributo.conteudo) return attr.atributo.conteudo;
    // Fallback to equipamentos array
    const eq = orc.equipamentos?.[0]?.equipamento;
    if (!eq?.equipamento) return '';
    const parts = [eq.equipamento, eq.marca, eq.modelo].filter(Boolean);
    return parts.join(' · ');
  }

  const OrcamentoCard = ({ entry, ready }: { entry: OrcamentoReadiness; ready: boolean }) => {
    const expanded = expandedId === entry.orcamento.id;
    const equip = getEquipamento(entry.orcamento);
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
                {equip && (
                  <span
                    className="text-xs text-muted-foreground font-medium truncate max-w-[160px]"
                    title={equip}
                  >
                    {equip}
                  </span>
                )}
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
                <span className="text-xs">{formatDate(e.orcamento.data)} | {e.itensProntos}/{e.totalItens} itens OK</span>
              </div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-0.5 pr-2">Produto</th>
                    <th className="text-right py-0.5 px-2">Precisa</th>
                    <th className="text-right py-0.5 px-2">Disponível</th>
                    <th className="text-right py-0.5 px-2">Total</th>
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
                      <td className="text-center py-0.5 pl-2">{item.pronto ? '✅' : '❌'}</td>
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
        <h1 className="text-xl font-bold mb-1">Rastreador de Orçamentos</h1>
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
          <h1 className="text-lg font-bold text-foreground">Rastreador de Orçamentos</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Selecione as situações e (opcionalmente) filtre por cliente para verificar quais orçamentos podem virar OS.
        </p>

        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
              <Filter className="h-3.5 w-3.5" />
              Filtros
              {filtersOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {(nomeCliente || selectedSituacoes.length > 0) && !filtersOpen && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-1">
                  {selectedSituacoes.length + (nomeCliente ? 1 : 0)}
                </Badge>
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-1">
            <div className="relative">
              <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filtrar por nome do cliente…"
                value={nomeCliente}
                onChange={e => setNomeCliente(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleScan()}
                disabled={scanning}
                className="h-8 text-sm pl-8"
              />
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
          </CollapsibleContent>
        </Collapsible>

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
            <p className="text-sm">Selecione as situações e clique em "Rastrear" para verificar</p>
          </div>
        )}

        {result && (
          <div className="space-y-6 max-w-3xl mx-auto">
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
              {result.totalBloqueados > 0 && (
                <Card className="p-3 text-center border-destructive/50 bg-destructive/5">
                  <p className="text-2xl font-bold text-destructive">{result.totalBloqueados}</p>
                  <p className="text-xs text-muted-foreground">Bloqueados (já OS)</p>
                </Card>
              )}
            </div>

            <p className="text-xs text-muted-foreground text-right">
              Escaneado em {new Date(result.scannedAt).toLocaleString('pt-BR')}
            </p>

            {/* Blocked budgets section */}
            {result.orcamentosBloqueados.length > 0 && (
              <Collapsible open={blockedExpanded} onOpenChange={setBlockedExpanded}>
                <div className="rounded-lg border-2 border-destructive/50 bg-destructive/5">
                  <CollapsibleTrigger asChild>
                    <button className="w-full flex items-center gap-3 p-4 text-left hover:bg-destructive/10 transition-colors rounded-t-lg">
                      <Ban className="h-5 w-5 text-destructive shrink-0" />
                      <div className="flex-1">
                        <h3 className="font-bold text-destructive text-sm">
                          🚫 Bloqueados — já viraram OS
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {result.orcamentosBloqueados.length} orçamento(s) removido(s) do rastreamento
                        </p>
                      </div>
                      <Badge variant="destructive" className="text-sm">{result.orcamentosBloqueados.length}</Badge>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${blockedExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-4 pb-4 space-y-2">
                      {result.orcamentosBloqueados.map(c => (
                        <Card key={c.orcamento_id} className="p-3 border-l-4 border-l-destructive bg-card">
                          <p className="text-sm font-bold text-amber-500">
                            ⚠️ {c.warning}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-sm text-foreground font-medium">#{c.codigo}</span>
                            <span className="text-sm text-muted-foreground">— {c.nome_cliente}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1.5">
                            <Badge
                              variant={c.reason === 'flag' ? 'secondary' : 'outline'}
                              className={c.reason === 'os_index' ? 'border-amber-500 text-amber-500 text-[10px]' : 'text-[10px]'}
                            >
                              {c.reason === 'flag' ? 'Flag automática' : 'OS detectada'}
                            </Badge>
                            {c.link_number && (
                              <span className="text-xs text-muted-foreground">
                                OS #{c.link_number}
                                {c.link_situacao && ` [${c.link_situacao}]`}
                              </span>
                            )}
                          </div>
                          {c.reason === 'os_index' && (
                            <p className="text-[10px] text-amber-500/70 mt-1.5 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              Vínculo baseado em campo digitado manualmente na OS (atributo "Nº Orçamento")
                            </p>
                          )}
                        </Card>
                      ))}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            )}

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
