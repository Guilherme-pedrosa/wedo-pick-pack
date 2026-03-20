import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStatusOrcamentos } from '@/api/compras';
import { rastrearOrcamentos, RastreadorResult, OrcamentoReadiness, ConflictInfo, OSReservedInfo } from '@/api/rastreador';
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
import { logSystemAction } from '@/lib/systemLog';

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
  const [auvoCustomerIdInput, setAuvoCustomerIdInput] = useState('');
  const [auvoCustomerLookup, setAuvoCustomerLookup] = useState<{ loading: boolean; name?: string; error?: string }>({ loading: false });
  const [manualEquipamento, setManualEquipamento] = useState('');
  const [generatedOrcIds, setGeneratedOrcIds] = useState<Set<string>>(new Set());
  const [generationResult, setGenerationResult] = useState<{
    success: boolean;
    auvoTaskId?: number | string;
    osCodigo?: string;
    error?: string;
    duplicate?: boolean;
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
        .select('auvo_user_id, gc_usuario_id, name')
        .eq('id', user.id)
        .maybeSingle();

      const auvoUserId = (profile as any)?.auvo_user_id;
      if (!auvoUserId) {
        toast.error('Configure seu ID de Usuário Auvo nas Configurações antes de gerar OS.');
        setConfirmEntry(null);
        setGeneratingOS(false);
        return;
      }

      // Cliente é sempre obrigatório: ou vem de uma tarefa OS válida, ou vem de ID informado e verificado
      const sourceTaskId = getSourceTaskOsId(entry.orcamento);
      const hasValidSourceTask = parsePositiveInt(sourceTaskId) !== null;
      const typedCustomerId = parsePositiveInt(auvoCustomerIdInput);

      if (!hasValidSourceTask && !typedCustomerId) {
        toast.error('Informe um código de cliente Auvo válido antes de gerar a OS.');
        setGeneratingOS(false);
        return;
      }

      if (!hasValidSourceTask && !auvoCustomerLookup.name) {
        toast.error('Clique em "Verificar" para validar o cliente Auvo antes de confirmar.');
        setGeneratingOS(false);
        return;
      }

      // Equipment is optional (warning only, not blocking)
      const equipFromOrc = getEquipamento(entry.orcamento);

      const bodyPayload: Record<string, unknown> = {
        orcamento: entry.orcamento,
        auvo_user_id: auvoUserId,
        gc_usuario_id: (profile as any)?.gc_usuario_id || undefined,
      };

      // Sempre manda fallback de cliente se digitado; backend usa só se necessário
      if (typedCustomerId) {
        bodyPayload.auvo_customer_id = typedCustomerId;
      }

      // If equipment was manually provided, include it
      if (!equipFromOrc && manualEquipamento.trim()) {
        bodyPayload.manual_equipamento = manualEquipamento.trim();
      }

      const { data, error } = await supabase.functions.invoke('generate-os', {
        body: bodyPayload,
      });

      // Handle 409 duplicate from edge function (non-2xx returns error object)
      if (error) {
        // Try to parse the response body for duplicate info
        let errorBody: any = null;
        try {
          if (error.context?.body) {
            const reader = error.context.body.getReader?.();
            if (reader) {
              const { value } = await reader.read();
              errorBody = JSON.parse(new TextDecoder().decode(value));
            }
          }
        } catch { /* ignore parse errors */ }

        if (!errorBody) errorBody = data;

        if (errorBody?.duplicate) {
          setGenerationResult({
            success: false,
            error: errorBody.error,
            osCodigo: errorBody.existing?.os_codigo,
            auvoTaskId: errorBody.existing?.auvo_task_id,
            duplicate: true,
          });
          toast.error(errorBody.error);
          return;
        }
        throw new Error(errorBody?.error || error.message);
      }
      if (data?.duplicate) {
        setGenerationResult({
          success: false,
          error: data.error,
          osCodigo: data.existing?.os_codigo,
          auvoTaskId: data.existing?.auvo_task_id,
          duplicate: true,
        });
        toast.error(data.error);
        return;
      }
      if (data?.error) throw new Error(data.error);

      setGenerationResult({
        success: true,
        auvoTaskId: data.auvo_task_id,
        osCodigo: data.os_codigo,
      });
      setGeneratedOrcIds(prev => new Set(prev).add(entry.orcamento.id));

      // Log successful generation
      await (supabase.from("os_generation_logs") as any).insert({
        orcamento_codigo: entry.orcamento.codigo,
        orcamento_id: entry.orcamento.id,
        nome_cliente: entry.orcamento.nome_cliente,
        os_id: String(data.os_id || ''),
        os_codigo: String(data.os_codigo || ''),
        auvo_task_id: String(data.auvo_task_id || ''),
        operator_id: user!.id,
        operator_name: (profile as any)?.name || user!.email || '',
        valor_total: Number(entry.orcamento.valor_total || 0),
        equipamento: getEquipamento(entry.orcamento) || null,
        warnings: data.warnings || null,
        success: true,
      });

      logSystemAction({ module: "rastreador", action: "OS gerada", entityType: "OS", entityId: String(data.os_id || ''), entityName: `OS #${data.os_codigo} - ${entry.orcamento.nome_cliente}`, details: { orcamento_codigo: entry.orcamento.codigo, auvo_task_id: data.auvo_task_id } });
      toast.success(`OS #${data.os_codigo} criada com sucesso! Tarefa Auvo: ${data.auvo_task_id}`);
      if (data.warnings?.length) {
        for (const w of data.warnings) {
          toast.warning(w, { duration: 8000 });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setGenerationResult({ success: false, error: msg });

      // Log failed generation
      const { data: { user: failUser } } = await supabase.auth.getUser();
      if (failUser) {
        await (supabase.from("os_generation_logs") as any).insert({
          orcamento_codigo: entry.orcamento.codigo,
          orcamento_id: entry.orcamento.id,
          nome_cliente: entry.orcamento.nome_cliente,
          operator_id: failUser.id,
          operator_name: failUser.email || '',
          valor_total: Number(entry.orcamento.valor_total || 0),
          equipamento: getEquipamento(entry.orcamento) || null,
          error_message: msg,
          success: false,
        });
      }

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

  function getSourceTaskOsId(orc: GCOrcamento): string {
    const found = orc.atributos?.find((a: any) => {
      const attr = a?.atributo || a;
      const attrId = String(attr?.atributo_id || attr?.id || '');
      const content = String(attr?.conteudo ?? '').trim();
      return (attrId === '73341' || (attr?.descricao || '').toLowerCase().includes('tarefa os')) && content !== '';
    });

    const attr: any = (found as any)?.atributo || found;
    return String(attr?.conteudo ?? '').trim();
  }

  function parsePositiveInt(value: string): number | null {
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.trunc(parsed);
  }

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
    const isGenerating = generatingOS && confirmEntry?.orcamento.id === entry.orcamento.id;
    const alreadyGenerated = generatedOrcIds.has(entry.orcamento.id);
    const hasConflict = entry.temComprometido;
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
                {hasConflict && (
                  <Badge variant="outline" className="text-[10px] px-1.5 border-red-500 text-red-500">
                    ⚠ Comprometido
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate max-w-[250px]">
                {entry.orcamento.nome_cliente}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {ready && alreadyGenerated && (
              <Badge variant="outline" className="text-[10px] px-1.5 border-green-500 text-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" /> OS Gerada
              </Badge>
            )}
            {ready && !alreadyGenerated && (
              <Button
                variant="outline"
                size="sm"
                className={`h-6 text-[10px] px-2 gap-1 ${hasConflict ? 'border-amber-500 text-amber-600 hover:bg-amber-50' : 'border-green-500 text-green-600 hover:bg-green-50'}`}
                onClick={(e) => { e.stopPropagation(); setConfirmEntry(entry); setGenerationResult(null); setAuvoCustomerIdInput(''); setAuvoCustomerLookup({ loading: false }); }}
                disabled={isGenerating}
              >
                {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                Gerar OS
              </Button>
            )}
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
                  <span className="truncate">
                    {item.codigo_produto && <span className="font-mono text-muted-foreground">[{item.codigo_produto}]</span>}{' '}
                    {item.nome_produto}
                  </span>
                  {item.comprometido && (
                    <span className="text-[10px] text-red-500 font-medium shrink-0" title="Este item é disputado por outros orçamentos/OSs">⚠</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                  <span>Precisa: {item.qtd_necessaria}</span>
                  <span>|</span>
                  <span className={`font-medium ${item.pronto ? (item.comprometido ? 'text-amber-600' : 'text-green-600') : 'text-red-500'}`}>
                    Disp: {item.estoque_disponivel}
                  </span>
                </div>
              </div>
            ))}
            {hasConflict && (
              <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700">
                ⚠ Itens comprometidos: se esta OS for gerada, outros orçamentos/OSs que precisam das mesmas peças poderão ficar sem estoque.
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
                      <td className="py-0.5 pr-2">{item.codigo_produto && <span className="font-mono">[{item.codigo_produto}]</span>} {item.nome_produto}</td>
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
                        <span className="font-medium">{c.codigo_produto && `[${c.codigo_produto}] `}{c.nome_produto}</span> — Estoque: {c.estoque_total}, Demanda: {c.demanda_total}
                <div className="ml-4">
                  {c.orcamentos_envolvidos.map(o => {
                    const isOS = o.id.startsWith('os-');
                    return (
                      <div key={o.id} className={isOS ? 'font-medium' : ''}>
                        {isOS ? '🔧' : '📋'} {isOS ? o.codigo : `#${o.codigo}`} — {o.nome_cliente} — precisa {o.qtd}
                        {isOS && ' (OS pendente)'}
                      </div>
                    );
                  })}
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
                    Peças disputadas por múltiplos orçamentos ou reservadas por OSs pendentes — o estoque não atende todos.
                  </p>
                  <div className="space-y-2">
                    {result.conflitos.map(c => (
                      <Card key={c.produto_key} className="p-3 border-l-4 border-l-red-500">
                        <p className="font-medium text-sm">
                          {c.codigo_produto && <span className="font-mono text-muted-foreground">[{c.codigo_produto}]</span>}{' '}
                          {c.nome_produto}
                        </p>
                        <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                          <span>Estoque: <strong className="text-foreground">{c.estoque_total}</strong></span>
                          <span>Demanda total: <strong className="text-red-500">{c.demanda_total}</strong></span>
                        </div>
                        <div className="mt-2 space-y-0.5">
                          {c.orcamentos_envolvidos.map(o => {
                            const isOS = o.id.startsWith('os-');
                            return (
                              <div key={o.id} className={`text-xs ${isOS ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
                                {isOS ? '🔧' : '📋'} {isOS ? o.codigo : `#${o.codigo}`} — {o.nome_cliente} — precisa {o.qtd}
                                {isOS && <span className="text-[10px] ml-1">(reservado, sem mov. estoque)</span>}
                              </div>
                            );
                          })}
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

      {/* Confirmation Dialog */}
      <Dialog open={!!confirmEntry} onOpenChange={(open) => { if (!open) { setConfirmEntry(null); setGenerationResult(null); setManualEquipamento(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gerar OS + Tarefa Auvo</DialogTitle>
            <DialogDescription>
              Confirme a geração da OS e tarefa de execução.
            </DialogDescription>
          </DialogHeader>

          {confirmEntry && !generationResult && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border p-3 space-y-1.5">
                <p className="text-sm font-semibold">Orçamento #{confirmEntry.orcamento.codigo}</p>
                <p className="text-xs text-muted-foreground">{confirmEntry.orcamento.nome_cliente}</p>
                {getEquipamento(confirmEntry.orcamento) && (
                  <p className="text-xs text-muted-foreground">🔧 {getEquipamento(confirmEntry.orcamento)}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {confirmEntry.totalItens} produto(s) • R$ {Number(confirmEntry.orcamento.valor_total || 0).toFixed(2)}
                </p>
              </div>

              {/* Conflict warning */}
              {confirmEntry.temComprometido && (
                <div className="rounded-lg border border-red-500/50 bg-red-500/5 p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <span className="text-xs font-semibold text-red-700">Estoque comprometido</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Um ou mais itens deste orçamento são disputados por outros orçamentos ou OSs pendentes.
                    Se gerar esta OS, os demais pedidos que precisam das mesmas peças poderão ficar sem estoque.
                  </p>
                  <div className="text-xs space-y-0.5">
                    {confirmEntry.itens.filter(i => i.comprometido).map((item, idx) => (
                      <div key={idx} className="text-red-600">
                        ⚠ {item.codigo_produto && `[${item.codigo_produto}] `}{item.nome_produto} — Precisa: {item.qtd_necessaria}, Estoque: {item.estoque_total}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cliente Auvo: sempre permitir fallback manual + validação */}
              {(() => {
                const sourceTaskId = getSourceTaskOsId(confirmEntry.orcamento);
                const hasValidSourceTask = parsePositiveInt(sourceTaskId) !== null;

                const handleLookup = async () => {
                  const customerId = parsePositiveInt(auvoCustomerIdInput);
                  if (!customerId) {
                    setAuvoCustomerLookup({ loading: false, error: 'Informe um código de cliente válido.' });
                    return;
                  }

                  setAuvoCustomerLookup({ loading: true });
                  try {
                    const { data, error } = await supabase.functions.invoke('auvo-lookup-customer', {
                      body: { customer_id: customerId },
                    });
                    if (error) throw new Error('Falha na consulta');
                    if (data?.error) throw new Error(data.error);
                    setAuvoCustomerLookup({ loading: false, name: data.name });
                  } catch (e: any) {
                    setAuvoCustomerLookup({ loading: false, error: e.message || 'Erro ao consultar' });
                  }
                };

                return (
                  <div className={`rounded-lg border p-3 space-y-2 ${hasValidSourceTask ? 'border-border bg-muted/40' : 'border-amber-500/50 bg-amber-500/5'}`}>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className={`h-4 w-4 ${hasValidSourceTask ? 'text-muted-foreground' : 'text-amber-600'}`} />
                      <span className={`text-xs font-semibold ${hasValidSourceTask ? 'text-foreground' : 'text-amber-700'}`}>
                        {hasValidSourceTask ? `Tarefa OS de origem detectada (#${sourceTaskId})` : 'Cliente obrigatório'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {hasValidSourceTask
                        ? 'Se a tarefa de origem não tiver cliente no Auvo, informe um código abaixo como fallback.'
                        : 'Este orçamento não tem tarefa OS válida para clonar cliente. Informe e valide o cliente no Auvo para continuar.'}
                    </p>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="Código do cliente (Auvo)"
                        value={auvoCustomerIdInput}
                        onChange={(e) => { setAuvoCustomerIdInput(e.target.value); setAuvoCustomerLookup({ loading: false }); }}
                        className="h-8 text-sm flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs px-3"
                        disabled={!parsePositiveInt(auvoCustomerIdInput) || auvoCustomerLookup.loading}
                        onClick={handleLookup}
                      >
                        {auvoCustomerLookup.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                        <span className="ml-1">Verificar</span>
                      </Button>
                    </div>
                    {auvoCustomerLookup.name && (
                      <div className="flex items-center gap-2 rounded border border-green-500/50 bg-green-500/5 p-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        <span className="text-xs font-medium text-green-700">{auvoCustomerLookup.name}</span>
                      </div>
                    )}
                    {auvoCustomerLookup.error && (
                      <div className="flex items-center gap-2 rounded border border-destructive/50 bg-destructive/5 p-2">
                        <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                        <span className="text-xs text-destructive">{auvoCustomerLookup.error}</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Show equipment input when no equipment detected */}
              {(() => {
                if (!confirmEntry) return null;
                const hasEquip = !!getEquipamento(confirmEntry.orcamento);
                if (!hasEquip) {
                  return (
                    <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        <span className="text-xs font-semibold text-amber-700">Sem equipamento detectado (opcional)</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Este orçamento não possui equipamento vinculado. Você pode informar abaixo ou prosseguir sem:
                      </p>
                      <Input
                        type="text"
                        placeholder="Ex: PASS THROUGH QUENTE (opcional)"
                        value={manualEquipamento}
                        onChange={(e) => setManualEquipamento(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                  );
                }
                return null;
              })()}

              <div className="text-xs text-muted-foreground space-y-1">
                <p>O sistema irá:</p>
                <ol className="list-decimal list-inside space-y-0.5 ml-1">
                  <li>Criar tarefa no Auvo (sem técnico, sem data)</li>
                  <li>Criar OS no GestãoClick com o nº da tarefa</li>
                  <li>Vincular nº do orçamento e tarefa de execução</li>
                </ol>
              </div>
            </div>
          )}

          {generationResult?.success && (
            <div className="rounded-lg border border-green-500/50 bg-green-500/5 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span className="font-semibold text-sm text-green-600">Gerado com sucesso!</span>
              </div>
              <p className="text-sm">OS: <strong>#{generationResult.osCodigo}</strong></p>
              <p className="text-sm">Tarefa Auvo: <strong>#{generationResult.auvoTaskId}</strong></p>
            </div>
          )}

          {generationResult?.error && (
            <div className={`rounded-lg border p-4 space-y-2 ${generationResult.duplicate ? 'border-amber-500/50 bg-amber-500/5' : 'border-destructive/50 bg-destructive/5'}`}>
              <div className="flex items-center gap-2">
                <AlertTriangle className={`h-5 w-5 ${generationResult.duplicate ? 'text-amber-600' : 'text-destructive'}`} />
                <span className={`font-semibold text-sm ${generationResult.duplicate ? 'text-amber-600' : 'text-destructive'}`}>
                  {generationResult.duplicate ? 'OS já gerada!' : 'Erro na geração'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{generationResult.error}</p>
              {generationResult.duplicate && generationResult.osCodigo && (
                <p className="text-sm font-medium">OS existente: <strong>#{generationResult.osCodigo}</strong></p>
              )}
            </div>
          )}

          <DialogFooter>
            {!generationResult && (
              <>
                <Button variant="outline" onClick={() => setConfirmEntry(null)} disabled={generatingOS}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => confirmEntry && handleGenerateOS(confirmEntry)}
                  disabled={generatingOS || (() => {
                    if (!confirmEntry) return true;
                    const sourceTaskId = getSourceTaskOsId(confirmEntry.orcamento);
                    const hasValidSourceTask = parsePositiveInt(sourceTaskId) !== null;
                    const hasValidatedManualCustomer = !!parsePositiveInt(auvoCustomerIdInput) && !!auvoCustomerLookup.name;
                    const hasCustomer = hasValidSourceTask || hasValidatedManualCustomer;
                    return !hasCustomer;
                  })()}
                  className="gap-2"
                >
                  {generatingOS ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  {generatingOS ? 'Gerando...' : 'Confirmar'}
                </Button>
              </>
            )}
            {generationResult && (
              <Button onClick={() => { setConfirmEntry(null); setGenerationResult(null); }}>
                Fechar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
