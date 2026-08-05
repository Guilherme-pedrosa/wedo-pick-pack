import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getStatusOS, listOSMultiStatus } from '@/api/gestaoclick';
import { getSeparations, linkTechnicianToSeparation, SeparationRecord } from '@/api/separations';
import { getAuvoAgenda, getAuvoTasksByIds, auvoStatusLabel, matchTechnician, normalizeName, getExecTaskIdsFromOS, AuvoAgendaTask } from '@/api/auvoAgenda';
import { useCheckoutStore } from '@/store/checkoutStore';
import { GCOrdemServico } from '@/api/types';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Calendar, User, Filter, Search, RefreshCw, Loader2, CheckCircle2, UserPlus, PackageCheck, PackageSearch, Clock, ClipboardList, ChevronDown, ArrowUpDown, ExternalLink, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

interface TechnicianRow { id: string; gc_id: string; name: string }
interface AgendaRow { key: string; os: GCOrdemServico | null; task: AuvoAgendaTask | null; separation: SeparationRecord | null; suggested: TechnicianRow | null; execTaskId: string | null; taskWithoutGC: boolean }
type SortField = 'codigo' | 'cliente' | 'horario' | 'valor';

function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function formatTimeStr(iso: string | null) { if (!iso) return '--:--'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function formatDate(value: string | null | undefined) { if (!value) return 'Sem data'; const date = new Date(value); if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('pt-BR'); const [year, month, day] = value.slice(0, 10).split('-'); return day && month && year ? `${day}/${month}/${year}` : value; }
function formatMoney(value: string | number | undefined) { const n = typeof value === 'number' ? value : Number(String(value || '0').replace(',', '.')); return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

export default function AgendaOSPanel() {
  const queryClient = useQueryClient();
  const config = useCheckoutStore((s) => s.config);
  const [agendaDate, setAgendaDate] = useState(todayISO);
  const [techFilter, setTechFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('horario');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [technicians, setTechnicians] = useState<TechnicianRow[]>([]);

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search), 300); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => { supabase.from('technicians').select('id, gc_id, name').eq('active', true).order('name').then(({ data }) => setTechnicians((data || []) as TechnicianRow[])); }, []);

  const osQuery = useQuery({ queryKey: ['agenda-os-queue', config.osStatusToShow.join(',')], queryFn: () => listOSMultiStatus(config.osStatusToShow), staleTime: 30_000, refetchOnWindowFocus: false });
  const statusQuery = useQuery({ queryKey: ['statuses', 'os'], queryFn: getStatusOS, staleTime: 5 * 60_000, refetchOnWindowFocus: false });
  const orders = useMemo(() => osQuery.data?.data || [], [osQuery.data]);
  const execTaskByOS = useMemo(() => { const map = new Map<string, string>(); orders.forEach((os) => { const taskId = getExecTaskIdsFromOS(os.atributos)[0]; if (taskId) map.set(os.id, taskId); }); return map; }, [orders]);
  const execTaskIds = useMemo(() => [...new Set(execTaskByOS.values())].sort(), [execTaskByOS]);
  const linkedTasksQuery = useQuery({ queryKey: ['auvo-tasks-by-id', execTaskIds.join(',')], queryFn: () => getAuvoTasksByIds(execTaskIds), enabled: execTaskIds.length > 0 });
  const dailyTasksQuery = useQuery({ queryKey: ['auvo-agenda', agendaDate], queryFn: () => getAuvoAgenda(agendaDate) });
  const separationsQuery = useQuery({ queryKey: ['separations', 'agenda'], queryFn: () => getSeparations({ orderType: 'os', status: 'valid' }), refetchInterval: 60_000 });

  const allTasks = useMemo(() => { const map = new Map<string, AuvoAgendaTask>(); (linkedTasksQuery.data || []).forEach((task) => map.set(String(task.task_id), task)); (dailyTasksQuery.data || []).forEach((task) => map.set(String(task.task_id), task)); return [...map.values()]; }, [linkedTasksQuery.data, dailyTasksQuery.data]);
  const rows = useMemo<AgendaRow[]>(() => {
    const taskById = new Map(allTasks.map((task) => [String(task.task_id).trim(), task]));
    const referencedTaskIds = new Set(execTaskByOS.values());
    const osRows = orders.map((os): AgendaRow => {
      const execTaskId = execTaskByOS.get(os.id) || null;
      const task = execTaskId ? taskById.get(execTaskId) || null : null;
      const separation = (separationsQuery.data || []).find((item) => item.order_type === 'os' && (item.order_id === os.id || item.order_code === os.codigo)) || null;
      return { key: `os:${os.id}`, os, task, separation, execTaskId, taskWithoutGC: false, suggested: matchTechnician(task?.technician_name || null, technicians) };
    });
    const taskOnlyRows = (dailyTasksQuery.data || []).filter((task) => !referencedTaskIds.has(String(task.task_id))).map((task): AgendaRow => ({ key: `task:${task.task_id}`, os: null, task, separation: null, execTaskId: String(task.task_id), taskWithoutGC: true, suggested: matchTechnician(task.technician_name, technicians) }));
    return [...osRows, ...taskOnlyRows];
  }, [allTasks, dailyTasksQuery.data, execTaskByOS, orders, separationsQuery.data, technicians]);
  const techOptions = useMemo(() => [...new Set(allTasks.map((task) => task.technician_name).filter((name): name is string => Boolean(name)))].sort(), [allTasks]);
  const filteredRows = useMemo(() => {
    const term = normalizeName(debouncedSearch);
    return rows.filter((row) => {
      const taskDay = row.task?.task_date?.slice(0, 10) || null;
      if (row.task && taskDay !== agendaDate) return false;
      if (techFilter === 'none' && row.task?.technician_name) return false;
      if (techFilter !== 'all' && techFilter !== 'none' && row.task?.technician_name !== techFilter) return false;
      if (statusFilter !== 'all' && row.os?.situacao_id !== statusFilter) return false;
      if (!term) return true;
      return normalizeName([row.os?.codigo, row.os?.nome_cliente, row.task?.task_id, row.task?.customer_name, row.task?.technician_name].filter(Boolean).join(' ')).includes(term);
    }).sort((a, b) => {
      if (sortField === 'cliente') return (a.os?.nome_cliente || a.task?.customer_name || '').localeCompare(b.os?.nome_cliente || b.task?.customer_name || '');
      if (sortField === 'valor') return Number(b.os?.valor_total || 0) - Number(a.os?.valor_total || 0);
      if (sortField === 'codigo') return (a.os?.codigo || a.task?.task_id || '').localeCompare(b.os?.codigo || b.task?.task_id || '', 'pt-BR', { numeric: true });
      return (a.task?.task_date || '9999').localeCompare(b.task?.task_date || '9999');
    });
  }, [rows, debouncedSearch, agendaDate, techFilter, statusFilter, sortField]);

  useEffect(() => { if (selectedKey && !filteredRows.some((row) => row.key === selectedKey)) { setSelectedKey(null); setDetailOpen(false); } }, [filteredRows, selectedKey]);
  const selected = filteredRows.find((row) => row.key === selectedKey) || null;
  const isLoading = osQuery.isLoading || dailyTasksQuery.isLoading || separationsQuery.isLoading;
  const isFetching = osQuery.isFetching || linkedTasksQuery.isFetching || dailyTasksQuery.isFetching || separationsQuery.isFetching;
  const taskOnlyCount = filteredRows.filter((row) => row.taskWithoutGC).length;
  const unscheduledCount = filteredRows.filter((row) => row.os && !row.task?.technician_name).length;
  const refreshAll = () => { void Promise.all([osQuery.refetch(), linkedTasksQuery.refetch(), dailyTasksQuery.refetch(), separationsQuery.refetch(), statusQuery.refetch()]); };
  const handleLink = async (row: AgendaRow) => {
    if (!row.os || !row.separation) return toast.error('Conclua a separação desta OS antes de vincular.');
    if (!row.suggested) return toast.error('O técnico da tarefa não corresponde a um técnico cadastrado.');
    setLinkingId(row.key);
    const ok = await linkTechnicianToSeparation(row.separation.id, row.suggested.gc_id, row.suggested.name);
    setLinkingId(null);
    if (!ok) return toast.error('Não foi possível vincular o técnico.');
    toast.success(`${row.suggested.name} vinculado à OS #${row.os.codigo}`);
    await queryClient.invalidateQueries({ queryKey: ['separations'] });
  };

  return (
    <div className="flex min-h-[680px] h-[calc(100vh-10rem)] overflow-hidden border border-border bg-background">
      <aside className="flex w-full md:w-[360px] shrink-0 flex-col border-r border-border bg-card">
        <div className="sticky top-0 z-10 space-y-2 border-b border-border bg-card p-3">
          <Button className="w-full gap-2" disabled><ClipboardList className="h-4 w-4" /> Ordens de Serviço + Agenda</Button>
          <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
            <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-full justify-between px-2 text-xs"><span className="flex items-center gap-1.5"><Filter className="h-3.5 w-3.5" /> Filtros</span><ChevronDown className={cn('h-3.5 w-3.5 transition-transform', filtersOpen && 'rotate-180')} /></Button></CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-1">
              <div className="relative"><Calendar className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input type="date" value={agendaDate} onChange={(event) => setAgendaDate(event.target.value)} className="pl-9" /></div>
              <Select value={techFilter} onValueChange={setTechFilter}><SelectTrigger><SelectValue placeholder="Todos os técnicos" /></SelectTrigger><SelectContent><SelectItem value="all">Todos os técnicos</SelectItem><SelectItem value="none">Sem técnico / não agendada</SelectItem>{techOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger><SelectValue placeholder="Todas as situações" /></SelectTrigger><SelectContent><SelectItem value="all">Todas as situações da OS</SelectItem>{(statusQuery.data || []).map((status) => <SelectItem key={status.id} value={status.id}>{status.nome}</SelectItem>)}</SelectContent></Select>
              <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="OS, tarefa, cliente ou técnico…" className="pl-9" /></div>
              <div className="flex items-center gap-1.5"><ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><Select value={sortField} onValueChange={(value) => setSortField(value as SortField)}><SelectTrigger className="h-7 flex-1 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="horario">Horário do agendamento</SelectItem><SelectItem value="codigo">Código</SelectItem><SelectItem value="cliente">Cliente (A–Z)</SelectItem><SelectItem value="valor">Valor (maior)</SelectItem></SelectContent></Select></div>
            </CollapsibleContent>
          </Collapsible>
          <Button variant="outline" className="w-full gap-2" onClick={refreshAll} disabled={isFetching}><RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} /> Atualizar</Button>
          <p className="text-center text-xs text-muted-foreground">{filteredRows.length} registros · {unscheduledCount} não agendadas · {taskOnlyCount} tarefas sem GC</p>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {isLoading && <div className="py-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Carregando…</div>}
          {!isLoading && filteredRows.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">Nenhum registro encontrado</div>}
          {filteredRows.map((row) => {
            const client = row.os?.nome_cliente || row.task?.customer_name || 'Cliente não identificado';
            const unscheduled = Boolean(row.os && !row.task?.technician_name);
            return <Card key={row.key} onClick={() => { setSelectedKey(row.key); setDetailOpen(true); }} className={cn('cursor-pointer border-l-4 p-3 transition-all hover:shadow-md', selectedKey === row.key && 'border-l-primary bg-accent', selectedKey !== row.key && row.taskWithoutGC && 'border-l-destructive bg-destructive/5', selectedKey !== row.key && unscheduled && 'border-l-warning bg-warning/10', selectedKey !== row.key && !row.taskWithoutGC && !unscheduled && 'border-l-transparent')}>
              <div className="mb-1 flex items-start justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><Badge>{row.os ? 'OS' : 'AUVO'}</Badge><span className="truncate text-sm font-semibold">#{row.os?.codigo || row.task?.task_id}</span></div>{row.taskWithoutGC ? <Badge variant="destructive">Sem GC</Badge> : unscheduled ? <Badge className="bg-warning text-warning-foreground">Não agendada</Badge> : <Badge variant="secondary">{formatTimeStr(row.task?.task_date || null)}</Badge>}</div>
              <p className="truncate text-sm font-medium text-foreground">{client}</p><div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground"><span className="truncate">{row.task?.technician_name || row.os?.nome_situacao || 'Sem técnico'}</span>{row.os && row.task && <><span>·</span><span className="truncate">{row.os.nome_situacao}</span></>}</div>
            </Card>;
          })}
        </div>
      </aside>
      <section className="hidden min-w-0 flex-1 flex-col overflow-y-auto bg-background p-5 md:flex">{!selected ? <div className="m-auto text-center text-muted-foreground"><ClipboardList className="mx-auto mb-3 h-10 w-10 opacity-30" />Selecione uma OS ou tarefa</div> : <AgendaDetails row={selected} linking={linkingId === selected.key} onLink={() => handleLink(selected)} />}</section>
      {selected && detailOpen && <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40 md:hidden" onClick={() => setDetailOpen(false)}><Card className="max-h-[80vh] overflow-y-auto rounded-b-none p-3 shadow-xl" onClick={(event) => event.stopPropagation()}><div className="mb-2 flex justify-end"><Button variant="ghost" size="sm" onClick={() => setDetailOpen(false)}><X className="mr-1 h-4 w-4" />Fechar</Button></div><AgendaDetails row={selected} compact linking={linkingId === selected.key} onLink={() => handleLink(selected)} /></Card></div>}
    </div>
  );
}

function AgendaDetails({ row, compact = false, linking, onLink }: { row: AgendaRow; compact?: boolean; linking: boolean; onLink: () => void }) {
  const { os, task, separation, suggested, taskWithoutGC, execTaskId } = row;
  return <div className={cn('w-full space-y-5', !compact && 'mx-auto max-w-3xl')}>
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4"><div><div className="flex flex-wrap items-center gap-2"><h2>{os ? `OS #${os.codigo}` : `Tarefa Auvo #${task?.task_id}`}</h2>{taskWithoutGC && <Badge variant="destructive">Tarefa sem OS no GC</Badge>}{os && !task?.technician_name && <Badge className="bg-warning text-warning-foreground">Não agendada</Badge>}</div><p className="mt-1 text-base font-medium text-foreground">{os?.nome_cliente || task?.customer_name || 'Cliente não identificado'}</p></div>{os && <span className="text-lg font-bold text-foreground">{formatMoney(os.valor_total)}</span>}</div>
    <div className={cn('grid gap-3', compact ? 'grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3')}><Info icon={Calendar} label="Data" value={formatDate(task?.task_date || os?.data)} /><Info icon={Clock} label="Horário" value={task ? formatTimeStr(task.task_date) : 'Sem agendamento'} /><Info icon={User} label="Técnico de execução" value={task?.technician_name || 'Sem técnico'} />{!compact && <Info icon={ClipboardList} label="Situação da OS" value={os?.nome_situacao || 'Sem OS no GC'} />}{!compact && <Info icon={CheckCircle2} label="Status da tarefa" value={task ? auvoStatusLabel(task.status) : 'Tarefa não localizada'} />}{!compact && <Info icon={PackageCheck} label="Separação" value={separation ? (separation.technician_name ? `Vinculada a ${separation.technician_name}` : 'Concluída, sem vínculo') : 'Aguardando separação'} />}</div>
    {!compact && taskWithoutGC && <div className="flex gap-3 border border-destructive/30 bg-destructive/5 p-3 text-sm"><AlertTriangle className="h-5 w-5 shrink-0 text-destructive" /><div><strong>Tarefa trazida diretamente da agenda do Auvo.</strong><p>Ela não está referenciada pelo campo TAREFA EXECUÇÃO de nenhuma OS exibida no Controle OS.</p></div></div>}
    {!compact && os && !task && <div className="border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">{execTaskId ? `A tarefa #${execTaskId}, informada na OS, não foi localizada no Auvo.` : 'A OS não possui o campo TAREFA EXECUÇÃO preenchido no GC.'}</div>}
    {!compact && task?.orientation && <div><h3 className="mb-1 text-sm">Orientação da tarefa</h3><p className="whitespace-pre-wrap border-l-2 border-primary pl-3">{task.orientation}</p></div>}
    <div className="flex flex-wrap gap-2">{os && !separation && <Button asChild variant="outline"><Link to="/checkout"><PackageSearch className="mr-2 h-4 w-4" />Separar no Controle OS</Link></Button>}{os && separation && !separation.technician_name && <Button onClick={onLink} disabled={!suggested || linking}>{linking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}{suggested ? `Vincular ${suggested.name}` : 'Técnico não cadastrado'}</Button>}{task && <Button asChild variant="outline"><a href={`https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${task.task_id}`} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Abrir tarefa</a></Button>}</div>
  </div>;
}
function Info({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: string }) { return <div className="border-b border-border pb-2"><span className="flex items-center gap-1 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</span><p className="mt-1 font-medium text-foreground">{value}</p></div>; }