import { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listOSMultiStatus } from '@/api/gestaoclick';
import { getSeparations, linkTechnicianToSeparation, SeparationRecord } from '@/api/separations';
import {
  getAuvoTasksByIds,
  auvoStatusLabel,
  matchTechnician,
  normalizeName,
  getExecTaskIdsFromOS,
  AuvoAgendaTask,
} from '@/api/auvoAgenda';
import { useCheckoutStore } from '@/store/checkoutStore';
import { GCOrdemServico } from '@/api/types';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Calendar,
  User,
  Filter,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle2,
  UserPlus,
  PackageCheck,
  PackageSearch,
  Clock,
  ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

interface TechnicianRow {
  id: string;
  gc_id: string;
  name: string;
}

interface AgendaRow {
  os: GCOrdemServico;
  task: AuvoAgendaTask | null;
  separation: SeparationRecord | null;
  suggested: TechnicianRow | null;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTimeStr(iso: string | null) {
  if (!iso) return '--:--';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

function formatMoney(value: string | number | undefined) {
  const n = typeof value === 'number' ? value : parseFloat(String(value || '0').replace(',', '.'));
  if (isNaN(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function AgendaOSPanel() {
  const queryClient = useQueryClient();
  const config = useCheckoutStore((s) => s.config);

  const [agendaDate, setAgendaDate] = useState<string>(todayISO);
  const [techFilter, setTechFilter] = useState('all');
  const [situacaoFilter, setSituacaoFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [technicians, setTechnicians] = useState<TechnicianRow[]>([]);

  useEffect(() => {
    supabase
      .from('technicians')
      .select('id, gc_id, name')
      .eq('active', true)
      .order('name')
      .then(({ data }) => setTechnicians((data || []) as TechnicianRow[]));
  }, []);

  // 1) Fila de OS — mesma origem do Controle OS (GestãoClick / syncgc)
  const {
    data: osQueue,
    isLoading: loadingOS,
    refetch: refetchOS,
  } = useQuery({
    queryKey: ['agenda-os-queue', config.osStatusToShow.join(',')],
    queryFn: () => listOSMultiStatus(config.osStatusToShow),
    staleTime: 60_000,
  });

  const orders = useMemo(() => osQueue?.data || [], [osQueue]);

  // 2) IDs da TAREFA DE EXECUÇÃO lidos do próprio campo da OS no GC (atributo 73344).
  //    É a OS que aponta para a tarefa do Auvo — nunca o contrário.
  const execTaskByOS = useMemo(() => {
    const map = new Map<string, string>();
    orders.forEach((os) => {
      const ids = getExecTaskIdsFromOS((os as GCOrdemServico).atributos);
      if (ids.length > 0) map.set(os.id, ids[0]);
    });
    return map;
  }, [orders]);

  const execTaskIds = useMemo(
    () => Array.from(new Set(execTaskByOS.values())).sort(),
    [execTaskByOS],
  );

  // 3) Tarefas do Auvo buscadas exatamente pelos IDs gravados nas OS
  const {
    data: tasks = [],
    isLoading: loadingAgenda,
    refetch: refetchAgenda,
  } = useQuery({
    queryKey: ['auvo-tasks-by-id', execTaskIds.join(',')],
    queryFn: () => getAuvoTasksByIds(execTaskIds),
    enabled: execTaskIds.length > 0,
  });

  // 4) Histórico de separações (para saber o que já foi separado / vinculado)
  const {
    data: separations = [],
    isLoading: loadingSeps,
    refetch: refetchSeps,
  } = useQuery({
    queryKey: ['separations', 'agenda'],
    queryFn: () => getSeparations({ orderType: 'os', status: 'valid' }),
    refetchInterval: 60_000,
  });

  const rows = useMemo<AgendaRow[]>(() => {
    const taskById = new Map<string, AuvoAgendaTask>();
    tasks.forEach((t) => taskById.set(String(t.task_id).trim(), t));

    return orders.map((os) => {
      const execId = execTaskByOS.get(os.id) || null;
      const task = execId ? taskById.get(execId) || null : null;
      const separation =
        separations.find((s) => s.order_type === 'os' && (s.order_id === os.id || s.order_code === os.codigo)) || null;
      const suggested = matchTechnician(task?.technician_name || null, technicians);
      return { os, task, separation, suggested, execTaskId: execId };
    });
  }, [orders, tasks, separations, technicians, execTaskByOS]);

  const situacaoOptions = useMemo(() => {
    const map = new Map<string, string>();
    orders.forEach((o) => map.set(o.situacao_id, o.nome_situacao));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [orders]);

  const techOptions = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => t.technician_name && set.add(t.technician_name));
    return Array.from(set).sort();
  }, [tasks]);

  const filteredRows = useMemo(() => {
    const term = normalizeName(search);
    return rows
      .filter(({ os, task }) => {
        // Data de agendamento = data da TAREFA DE EXECUÇÃO no Auvo.
        // OS sem tarefa de execução aparecem sempre (destacadas em amarelo).
        const taskDay = task?.task_date ? String(task.task_date).slice(0, 10) : null;
        const matchesDate = !taskDay || taskDay === agendaDate;
        if (task && !matchesDate) return false;

        const matchesTech =
          techFilter === 'all' ||
          (techFilter === 'none' && !task?.technician_name) ||
          task?.technician_name === techFilter;

        const matchesSituacao = situacaoFilter === 'all' || os.situacao_id === situacaoFilter;

        const matchesSearch =
          !term ||
          normalizeName(os.nome_cliente).includes(term) ||
          String(os.codigo).includes(search.trim()) ||
          normalizeName(task?.technician_name || '').includes(term);

        return matchesTech && matchesSituacao && matchesSearch;
      })
      .sort((a, b) => {
        // Agendadas primeiro por horário; não agendadas no fim
        if (!!a.task !== !!b.task) return a.task ? -1 : 1;
        const at = a.task?.task_date || '';
        const bt = b.task?.task_date || '';
        if (at !== bt) return at.localeCompare(bt);
        return String(a.os.codigo).localeCompare(String(b.os.codigo), 'pt-BR', { numeric: true });
      });
  }, [rows, search, techFilter, situacaoFilter, agendaDate]);


  const scheduledCount = filteredRows.filter((r) => r.task).length;
  const unscheduledCount = filteredRows.length - scheduledCount;

  const isLoading = loadingOS || loadingAgenda || loadingSeps;

  const refreshAll = () => {
    refetchOS();
    refetchAgenda();
    refetchSeps();
  };

  const handleLink = async (row: AgendaRow) => {
    if (!row.separation) {
      toast.error('OS ainda não separada — conclua a separação no Controle OS antes de vincular.');
      return;
    }
    const tech = row.suggested;
    if (!tech) {
      toast.error('Nenhum técnico local corresponde ao técnico de execução do Auvo.');
      return;
    }
    setLinkingId(row.os.id);
    const ok = await linkTechnicianToSeparation(row.separation.id, tech.gc_id, tech.name);
    setLinkingId(null);
    if (ok) {
      toast.success(`Técnico ${tech.name} vinculado à OS #${row.os.codigo}`);
      queryClient.invalidateQueries({ queryKey: ['separations'] });
    } else {
      toast.error('Não foi possível vincular o técnico.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Agendamento — Controle OS + Auvo
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {filteredRows.length} OS na fila · {scheduledCount} agendada(s) · {unscheduledCount} sem agendamento
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={isLoading} className="gap-2">
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          Atualizar
        </Button>
      </div>

      <Card className="p-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Data de agendamento
            </label>
            <Input type="date" value={agendaDate} onChange={(e) => setAgendaDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <User className="h-3 w-3" /> Técnico (execução Auvo)
            </label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={techFilter}
              onChange={(e) => setTechFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="none">Sem técnico (não agendadas)</option>
              {techOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Filter className="h-3 w-3" /> Situação da OS (GC)
            </label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={situacaoFilter}
              onChange={(e) => setSituacaoFilter(e.target.value)}
            >
              <option value="all">Todas</option>
              {situacaoOptions.map(([id, nome]) => (
                <option key={id} value={id}>{nome}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Search className="h-3 w-3" /> Buscar
            </label>
            <Input placeholder="OS, cliente ou técnico" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin mb-2" />
          <p className="text-sm">Carregando fila de OS e agenda…</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="text-center py-16 border rounded-lg bg-muted/20">
          <ClipboardList className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-muted-foreground text-sm">Nenhuma OS encontrada para os filtros aplicados.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRows.map((row) => {
            const { os, task, separation, suggested } = row;
            const scheduled = !!task?.technician_name;
            const linked = !!separation?.technician_name;
            return (
              <Card
                key={os.id}
                className={cn(
                  'p-4 border-l-4',
                  scheduled ? 'border-l-primary' : 'bg-yellow-50/70 border-l-yellow-400'
                )}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm">OS #{os.codigo}</span>
                      <Badge variant="secondary">{os.nome_situacao}</Badge>
                      {!scheduled && (
                        <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
                          Não agendada
                        </Badge>
                      )}
                      {separation ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                          <PackageCheck className="h-3 w-3 mr-1" /> Separada
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-muted text-muted-foreground">
                          <PackageSearch className="h-3 w-3 mr-1" /> Aguardando separação
                        </Badge>
                      )}
                      {linked && (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> {separation?.technician_name}
                        </Badge>
                      )}
                    </div>

                    <p className="text-sm font-medium truncate">{os.nome_cliente}</p>

                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                      <span>{formatMoney(os.valor_total)}</span>
                      {task ? (
                        <>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {formatTimeStr(task.task_date)} · Tarefa #{task.task_id}
                          </span>
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" /> {task.technician_name || 'Sem técnico'}
                          </span>
                          <span>{auvoStatusLabel(task.status)}</span>
                        </>
                      ) : (
                        <span>Sem tarefa de execução no Auvo em {agendaDate.split('-').reverse().join('/')}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {!separation && (
                      <Button asChild variant="outline" size="sm" className="gap-1.5">
                        <Link to="/checkout">
                          <PackageSearch className="h-3.5 w-3.5" /> Separar
                        </Link>
                      </Button>
                    )}
                    {separation && !linked && (
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={!suggested || linkingId === os.id}
                        onClick={() => handleLink(row)}
                        title={suggested ? `Vincular ${suggested.name}` : 'Técnico do Auvo não cadastrado localmente'}
                      >
                        {linkingId === os.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <UserPlus className="h-3.5 w-3.5" />
                        )}
                        {suggested ? `Vincular ${suggested.name.split(' ')[0]}` : 'Vincular técnico'}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
