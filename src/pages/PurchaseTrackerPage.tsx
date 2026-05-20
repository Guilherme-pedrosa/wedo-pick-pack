import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getStatusCompras } from '@/api/compras';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, RefreshCw, ChevronDown, ShoppingCart, AlertTriangle, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const STORAGE_KEY = 'wedo-purchase-tracker-situacoes';

interface SituacaoHist {
  data: string;
  situacao: string;
  funcionario?: string;
}

interface CompraRow {
  id: string;
  codigo: string;
  nome_fornecedor: string;
  situacao_id: string;
  nome_situacao: string;
  data_emissao: string;
  valor_total: string;
  ultima_alteracao: string | null; // ISO/GC date string
  previsao_chegada: string | null; // dd/mm/yyyy from campos_extras
  historico: SituacaoHist[];
}

/** Accepts "dd/mm/yyyy" or "yyyy-mm-dd" → Date at local midnight */
function parseFlexibleDate(s: string): Date | null {
  if (!s) return null;
  const t = s.trim();
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

function parseGCDate(s: string): Date | null {
  if (!s) return null;
  // "2026-05-20" or "2026-05-20 11:42:33"
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function fmtDate(s: string | null): string {
  const d = s ? parseGCDate(s) : null;
  if (!d) return '—';
  return d.toLocaleDateString('pt-BR');
}

function fmtDateTime(s: string | null): string {
  const d = s ? parseGCDate(s) : null;
  if (!d) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtCurrency(v: string | number): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function fetchComprasRaw(situacaoId: string, pagina: number) {
  const path = `/api/compras?pagina=${pagina}&situacao_id=${situacaoId}`;
  const { data, error } = await supabase.functions.invoke('gc-proxy', {
    body: { path, method: 'GET' },
  });
  if (error) throw new Error(error.message || 'Erro de conexão');
  const resp = data as any;
  if (resp?._proxy?.ok === false) throw new Error('Falha ao consultar GestãoClick');
  return resp as { data: any[]; meta: { pagina_atual: number; total_paginas: number; total_registros: number } };
}

function extractRow(raw: any): CompraRow {
  const c = raw?.Compra ?? raw;
  const historico: SituacaoHist[] = (c?.situacoes || [])
    .map((w: any) => w?.situacao)
    .filter(Boolean)
    .map((s: any) => ({
      data: String(s.data ?? ''),
      situacao: String(s.situacao ?? ''),
      funcionario: String(s.funcionario ?? ''),
    }))
    .sort((a: SituacaoHist, b: SituacaoHist) => {
      const da = parseGCDate(a.data)?.getTime() ?? 0;
      const db = parseGCDate(b.data)?.getTime() ?? 0;
      return db - da; // newest first
    });

  const ultima = historico[0]?.data ?? null;

  // Extract "DATA DA CHEGADA DAS PEÇAS" from campos_extras
  let previsao: string | null = null;
  const extras = c?.campos_extras || [];
  for (const w of extras) {
    const e = w?.extras ?? w;
    const desc = String(e?.descricao ?? '').toUpperCase();
    if (desc.includes('CHEGADA') && desc.includes('PE')) {
      const v = String(e?.conteudo ?? '').trim();
      if (v) { previsao = v; break; }
    }
  }

  return {
    id: String(c?.id ?? ''),
    codigo: String(c?.codigo ?? ''),
    nome_fornecedor: String(c?.nome_fornecedor ?? ''),
    situacao_id: String(c?.situacao_id ?? ''),
    nome_situacao: String(c?.nome_situacao ?? ''),
    data_emissao: String(c?.data_emissao ?? ''),
    valor_total: String(c?.valor_total ?? '0'),
    ultima_alteracao: ultima,
    previsao_chegada: previsao,
    historico,
  };
}

export default function PurchaseTrackerPage() {
  const [statuses, setStatuses] = useState<{ id: string; nome: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ step: '', checked: 0, total: 0 });
  const [rows, setRows] = useState<CompraRow[]>([]);
  const [lastScanAt, setLastScanAt] = useState<Date | null>(null);

  // Load statuses + persisted selection
  useEffect(() => {
    (async () => {
      try {
        const s = await getStatusCompras();
        setStatuses(s.map(x => ({ id: String(x.id), nome: String(x.nome) })));
      } catch (e: any) {
        toast.error('Erro ao carregar situações', { description: e.message });
      } finally {
        setLoadingStatuses(false);
      }
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setSelected(parsed.map(String));
        }
      } catch {/* ignore */}
    })();
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(selected)); } catch {/* ignore */}
  }, [selected]);

  const toggle = (id: string) =>
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handleScan = async () => {
    if (selected.length === 0) {
      toast.warning('Selecione ao menos uma situação');
      return;
    }
    setScanning(true);
    setRows([]);
    try {
      const collected: CompraRow[] = [];
      for (let i = 0; i < selected.length; i++) {
        const sid = selected[i];
        const stName = statuses.find(s => s.id === sid)?.nome ?? sid;
        let page = 1;
        let totalPages = 1;
        while (page <= totalPages) {
          setProgress({ step: `Buscando "${stName}" — página ${page}`, checked: i, total: selected.length });
          const res = await fetchComprasRaw(sid, page);
          totalPages = res.meta?.total_paginas ?? 1;
          for (const item of res.data || []) {
            const row = extractRow(item);
            // Client-side filter (GC may ignore situacao_id)
            if (selected.includes(row.situacao_id)) collected.push(row);
          }
          page++;
          if (page <= totalPages) await new Promise(r => setTimeout(r, 400));
        }
      }
      // Dedup by id
      const map = new Map<string, CompraRow>();
      for (const r of collected) map.set(r.id, r);
      const final = [...map.values()];

      // Sort by arrival overdue DESC, then by days-in-current-status DESC
      const now = new Date();
      const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const arrOverdue = (r: CompraRow): number => {
        const p = r.previsao_chegada ? parseFlexibleDate(r.previsao_chegada) : null;
        return p ? daysBetween(p, today0) : -Infinity;
      };
      const stuckDays = (r: CompraRow): number => {
        const d = r.ultima_alteracao ? parseGCDate(r.ultima_alteracao) : null;
        return d ? daysBetween(d, now) : -1;
      };
      final.sort((a, b) => (arrOverdue(b) - arrOverdue(a)) || (stuckDays(b) - stuckDays(a)));

      setRows(final);
      setLastScanAt(new Date());
      toast.success(`${final.length} pedido(s) carregado(s)`);
    } catch (e: any) {
      toast.error('Erro no escaneamento', { description: e.message });
    } finally {
      setScanning(false);
      setProgress({ step: '', checked: 0, total: 0 });
    }
  };

  const now = useMemo(() => new Date(), [rows]);
  const today0 = useMemo(() => new Date(now.getFullYear(), now.getMonth(), now.getDate()), [now]);

  const summary = useMemo(() => {
    let warn = 0, crit = 0, atrasoChegada = 0;
    for (const r of rows) {
      // Stuck-in-status signal
      if (r.ultima_alteracao) {
        const d = parseGCDate(r.ultima_alteracao);
        if (d) {
          const days = daysBetween(d, now);
          if (days > 30) crit++;
          else if (days > 15) warn++;
        }
      }
      // Arrival overdue signal
      if (r.previsao_chegada) {
        const p = parseFlexibleDate(r.previsao_chegada);
        if (p && daysBetween(p, today0) > 0) atrasoChegada++;
      }
    }
    return { warn, crit, atrasoChegada };
  }, [rows, now, today0]);


  const selectedLabels = selected
    .map(id => statuses.find(s => s.id === id)?.nome)
    .filter(Boolean) as string[];

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShoppingCart className="h-6 w-6 text-primary" />
          Acompanhamento de Pedidos de Compra
        </h1>
        <p className="text-sm text-muted-foreground">
          Selecione as situações que deseja acompanhar e veja há quantos dias cada pedido está parado naquela etapa.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1 min-w-0">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Situações dos pedidos
            </label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal" disabled={loadingStatuses}>
                  <span className="truncate text-left">
                    {loadingStatuses
                      ? 'Carregando situações…'
                      : selected.length === 0
                        ? 'Escolha uma ou mais situações'
                        : selected.length === 1
                          ? selectedLabels[0]
                          : `${selected.length} situações selecionadas`}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[420px] p-0" align="start">
                <ScrollArea className="max-h-[360px]">
                  <div className="p-2">
                    {statuses.map(s => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm"
                      >
                        <Checkbox
                          checked={selected.includes(s.id)}
                          onCheckedChange={() => toggle(s.id)}
                        />
                        <span className="flex-1">{s.nome}</span>
                      </label>
                    ))}
                    {statuses.length === 0 && !loadingStatuses && (
                      <div className="p-3 text-sm text-muted-foreground">Nenhuma situação encontrada</div>
                    )}
                  </div>
                </ScrollArea>
                {selected.length > 0 && (
                  <div className="border-t p-2 flex justify-between">
                    <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                      Limpar
                    </Button>
                    <span className="text-xs text-muted-foreground self-center pr-1">
                      {selected.length} selecionada(s)
                    </span>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
          <Button onClick={handleScan} disabled={scanning || selected.length === 0} className="md:w-auto w-full">
            {scanning ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Buscando…</>
            ) : (
              <><RefreshCw className="h-4 w-4" /> Atualizar</>
            )}
          </Button>
        </CardContent>
      </Card>

      {scanning && (
        <div className="text-sm text-muted-foreground italic">
          {progress.step} {progress.total > 0 && `(${progress.checked + 1}/${progress.total} situações)`}
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">{rows.length} pedido(s)</Badge>
          {summary.warn > 0 && (
            <Badge className="bg-red-200 text-red-900 hover:bg-red-200 border-red-300 gap-1">
              <AlertTriangle className="h-3 w-3" /> {summary.warn} parados +15 dias
            </Badge>
          )}
          {summary.crit > 0 && (
            <Badge className="bg-red-500 text-white hover:bg-red-500 gap-1">
              <Flame className="h-3 w-3" /> {summary.crit} parados +30 dias
            </Badge>
          )}
          {summary.atrasoChegada > 0 && (
            <Badge className="bg-amber-500 text-white hover:bg-amber-500 gap-1">
              <AlertTriangle className="h-3 w-3" /> {summary.atrasoChegada} com chegada atrasada
            </Badge>
          )}
          {lastScanAt && (
            <span className="text-xs text-muted-foreground ml-auto">
              Atualizado em {lastScanAt.toLocaleString('pt-BR')}
            </span>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[90px]">Código</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Situação atual</TableHead>
                <TableHead className="w-[110px]">Pedido em</TableHead>
                <TableHead className="w-[160px]">Última alteração</TableHead>
                <TableHead className="w-[120px] text-right">Dias parado</TableHead>
                <TableHead className="w-[120px]">Previsão chegada</TableHead>
                <TableHead className="w-[140px] text-right">Atraso chegada</TableHead>
                <TableHead className="w-[110px] text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !scanning && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                    {selected.length === 0
                      ? 'Selecione as situações e clique em "Atualizar" para começar.'
                      : 'Nenhum pedido encontrado para as situações selecionadas.'}
                  </TableCell>
                </TableRow>
              )}
              {rows.map(r => {
                const lastDate = r.ultima_alteracao ? parseGCDate(r.ultima_alteracao) : null;
                const days = lastDate ? daysBetween(lastDate, now) : null;
                const prevDate = r.previsao_chegada ? parseFlexibleDate(r.previsao_chegada) : null;
                const overdueDays = prevDate ? daysBetween(prevDate, today0) : null; // >0 = atrasado
                const isArrCrit = overdueDays !== null && overdueDays > 30;
                const isArrWarn = overdueDays !== null && overdueDays > 0 && !isArrCrit;
                const isStuckCrit = days !== null && days > 30;
                const isStuckWarn = days !== null && days > 15 && !isStuckCrit;
                const isCrit = isArrCrit || isStuckCrit;
                const isWarn = !isCrit && (isArrWarn || isStuckWarn);
                return (
                  <TableRow
                    key={r.id}
                    className={cn(
                      isCrit && 'row-delay-crit',
                      isWarn && 'row-delay-warn',
                    )}
                  >
                    <TableCell className="font-mono text-xs font-semibold">{r.codigo || '—'}</TableCell>
                    <TableCell className="text-sm">{r.nome_fornecedor || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">{r.nome_situacao || '—'}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{fmtDate(r.data_emissao)}</TableCell>
                    <TableCell className="text-sm">{fmtDateTime(r.ultima_alteracao)}</TableCell>
                    <TableCell className="text-right">
                      {days === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={cn(
                            'font-semibold tabular-nums',
                            isStuckCrit && 'text-red-900',
                            isStuckWarn && 'text-red-800',
                          )}
                        >
                          {days} {days === 1 ? 'dia' : 'dias'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {prevDate ? prevDate.toLocaleDateString('pt-BR') : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {overdueDays === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : overdueDays > 0 ? (
                        <span className={cn('font-semibold tabular-nums', isArrCrit ? 'text-red-900' : 'text-red-800')}>
                          +{overdueDays} {overdueDays === 1 ? 'dia' : 'dias'}
                        </span>
                      ) : overdueDays === 0 ? (
                        <span className="font-medium text-amber-700 tabular-nums">hoje</span>
                      ) : (
                        <span className="text-muted-foreground tabular-nums">em {Math.abs(overdueDays)}d</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{fmtCurrency(r.valor_total)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground space-y-1">
        <p>• Linhas em <span className="inline-block px-1.5 rounded bg-red-200 text-red-900">vermelho claro</span> indicam pedidos parados há mais de <strong>15 dias</strong> na situação atual.</p>
        <p>• Linhas <span className="inline-block px-1.5 rounded bg-red-500 text-white">cintilando em vermelho</span> indicam pedidos parados há mais de <strong>30 dias</strong> — atenção urgente.</p>
        <p>• "Última alteração" é a data em que o pedido entrou na situação atual (extraído do histórico de situações do GestãoClick).</p>
      </div>
    </div>
  );
}
