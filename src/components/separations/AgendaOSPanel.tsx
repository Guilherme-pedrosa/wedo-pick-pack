import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  ExternalLink,
  Filter,
  LayoutGrid,
  Link2Off,
  Loader2,
  MapPin,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  RefreshCw,
  Search,
  User,
  UserPlus,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  classifyAgendaRow,
  datePart,
  GC_REPAIR_LOCATION_ATTRIBUTE_ID,
  getExecutionTaskIds,
  getOsAttributeValue,
  normalizeFilterText,
  type AgendaBucket,
} from '@/api/agendaControl';
import { getOpenAgendaOrders } from '@/api/agendaOrders';
import {
  auvoStatusLabel,
  getAuvoAgenda,
  getAuvoAgendaUsers,
  getAuvoTasksByIds,
  matchTechnician,
  normalizeName,
  updateAuvoAgendaTask,
  type AuvoAgendaTask,
} from '@/api/auvoAgenda';
import { getOS } from '@/api/gestaoclick';
import {
  getSeparations,
  snapshotOrderProducts,
  type SeparationItemSnapshot,
  type SeparationRecord,
} from '@/api/separations';
import { assignSeparationToTechnician } from '@/api/separationAssignment';
import type { GCOrdemServico } from '@/api/types';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';

interface LocalTechnician {
  id: string;
  gc_id: string;
  name: string;
}

interface AgendaOsRow {
  os: GCOrdemServico;
  taskIds: string[];
  task: AuvoAgendaTask | null;
  separation: SeparationRecord | null;
  bucket: AgendaBucket;
  items: SeparationItemSnapshot[];
}

type AgendaFilter = 'all' | AgendaBucket | 'orphan';
type SeparationFilter = 'all' | 'pending' | 'separated' | 'linked';
type ExecutionFilter = 'all' | 'em_andamento' | 'pausada' | 'finalizada' | 'sem_exec';
type ExecutionKey = Exclude<ExecutionFilter, 'all'>;
type RepairLocationFilter = 'all' | 'galpao' | 'cliente' | 'sem_info';

/** Multi-seleção: conjunto vazio = todas. Um status casa se pertencer a qualquer filtro marcado. */
function matchesExecutionFilters(filters: Set<ExecutionKey>, status: string, hasTask: boolean) {
  if (filters.size === 0) return true;
  const checks: Record<ExecutionKey, boolean> = {
    em_andamento: status.includes('andamento') || status.includes('deslocamento') || status.includes('check-in'),
    pausada: status.includes('paus'),
    finalizada: status.includes('finalizada') || status.includes('check-out'),
    sem_exec: !hasTask || !status || status.includes('aberta') || status.includes('agendada'),
  };
  return Array.from(filters).some((key) => checks[key]);
}

const BUCKET_META: Record<AgendaBucket, { label: string; className: string }> = {
  'scheduled-date': {
    label: 'Agendada no dia',
    className: 'border-blue-200 bg-blue-50 text-blue-800',
  },
  available: {
    label: 'Disponível para agendar',
    className: 'border-amber-300 bg-amber-50 text-amber-800',
  },
  'other-date': {
    label: 'Agendada em outra data',
    className: 'border-slate-200 bg-slate-50 text-slate-700',
  },
  'no-task': {
    label: 'Sem tarefa de execução',
    className: 'border-red-200 bg-red-50 text-red-700',
  },
};

function todayISO(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDate(value: string | null | undefined): string {
  const date = datePart(value);
  if (!date) return 'Sem data';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function formatTime(value: string | null | undefined): string {
  const raw = String(value || '');
  const match = raw.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : '--:--';
}

function taskStatus(task: AuvoAgendaTask | null): string {
  return task?.status_description || auvoStatusLabel(task?.status ?? null);
}

function formatMoney(value: string | number | null | undefined): string {
  const number = Number.parseFloat(String(value ?? '0').replace(',', '.'));
  return (Number.isFinite(number) ? number : 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function separatedQuantity(items: SeparationItemSnapshot[]): number {
  return items.reduce((total, item) => {
    const quantity = Number(item.confirmed_quantity || item.expected_quantity || 0);
    return total + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);
}

function equipmentName(os: GCOrdemServico): string {
  return (os.equipamentos || [])
    .map((entry) => entry.equipamento?.equipamento)
    .filter(Boolean)
    .join(', ');
}

function gcOrderUrl(osId: string): string {
  return `https://gestaoclick.com/ordens_servicos/editar/${osId}?retorno=%2Fordens_servicos`;
}

function auvoTaskUrl(taskId: string): string {
  return `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`;
}


export default function AgendaOSPanel() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [agendaDate, setAgendaDate] = useState(todayISO);
  const [dateFilterActive, setDateFilterActive] = useState(false);
  const [agendaFilter, setAgendaFilter] = useState<AgendaFilter>('all');
  const [technicianFilter, setTechnicianFilter] = useState('all');
  const [excludedSituations, setExcludedSituations] = useState<Set<string>>(new Set());
  const [situationSearch, setSituationSearch] = useState('');
  const [executionFilters, setExecutionFilters] = useState<Set<Exclude<ExecutionFilter, 'all'>>>(new Set());
  const [repairLocationFilter, setRepairLocationFilter] = useState<RepairLocationFilter>('all');
  const [separationFilter, setSeparationFilter] = useState<SeparationFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [detailItemsByOsId, setDetailItemsByOsId] = useState<Record<string, SeparationItemSnapshot[]>>({});
  const [loadingItemsId, setLoadingItemsId] = useState<string | null>(null);

  const [scheduleRow, setScheduleRow] = useState<AgendaOsRow | null>(null);
  const [scheduleTaskId, setScheduleTaskId] = useState('');
  const [scheduleDate, setScheduleDate] = useState(agendaDate);
  const [scheduleTime, setScheduleTime] = useState('08:00');
  const [scheduleTechnicianId, setScheduleTechnicianId] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);

  const [assignmentRow, setAssignmentRow] = useState<AgendaOsRow | null>(null);
  const [assignmentTechnicianId, setAssignmentTechnicianId] = useState('');
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const [selectedCalendarEvent, setSelectedCalendarEvent] = useState<AgendaOsRow | null>(null);




  const osQuery = useQuery({
    queryKey: ['agenda-open-orders'],
    queryFn: getOpenAgendaOrders,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const separationsQuery = useQuery({
    queryKey: ['separations', 'agenda-control'],
    queryFn: () => getSeparations({ orderType: 'os', status: 'valid' }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const localTechniciansQuery = useQuery({
    queryKey: ['technicians', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technicians')
        .select('id, gc_id, name')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as LocalTechnician[];
    },
    staleTime: 5 * 60_000,
  });

  const auvoUsersQuery = useQuery({
    queryKey: ['auvo-agenda-users'],
    queryFn: getAuvoAgendaUsers,
    staleTime: 10 * 60_000,
  });

  const orders = useMemo(() => osQuery.data || [], [osQuery.data]);
  const executionTaskIds = useMemo(
    () => Array.from(new Set(orders.flatMap(getExecutionTaskIds))),
    [orders],
  );

  const executionTasksQuery = useQuery({
    queryKey: ['auvo-execution-tasks', executionTaskIds.join(',')],
    queryFn: () => getAuvoTasksByIds(executionTaskIds),
    enabled: executionTaskIds.length > 0,
    staleTime: 60_000,
  });

  const dayTasksQuery = useQuery({
    queryKey: ['auvo-agenda', agendaDate],
    queryFn: () => getAuvoAgenda(agendaDate),
    staleTime: 30_000,
  });

  const allTasksById = useMemo(() => {
    const map = new Map<string, AuvoAgendaTask>();
    for (const task of dayTasksQuery.data || []) map.set(task.task_id, task);
    for (const task of executionTasksQuery.data || []) map.set(task.task_id, task);
    return map;
  }, [dayTasksQuery.data, executionTasksQuery.data]);

  const separationByOrderId = useMemo(() => {
    const map = new Map<string, SeparationRecord>();
    for (const separation of separationsQuery.data || []) {
      if (!map.has(separation.order_id)) map.set(separation.order_id, separation);
    }
    return map;
  }, [separationsQuery.data]);

  const rows = useMemo<AgendaOsRow[]>(() => orders.map((os) => {
    const taskIds = getExecutionTaskIds(os);
    const tasks = taskIds.map((id) => allTasksById.get(id)).filter((task): task is AuvoAgendaTask => !!task);
    const task = tasks.find((candidate) => datePart(candidate.task_date) === agendaDate) || tasks[0] || null;
    const separation = separationByOrderId.get(os.id) || null;
    const storedItems = Array.isArray(separation?.items) ? separation.items : [];
    const items = storedItems.length > 0
      ? storedItems
      : (detailItemsByOsId[os.id] || snapshotOrderProducts(os.produtos));
    return {
      os,
      taskIds,
      task,
      separation,
      items,
      bucket: classifyAgendaRow({
        taskId: taskIds[0] || null,
        taskDate: task?.task_date || null,
        technicianId: task?.technician_id || null,
        selectedDate: agendaDate,
      }),
    };
  }), [agendaDate, allTasksById, detailItemsByOsId, orders, separationByOrderId]);

  const referencedTaskIds = useMemo(() => new Set(orders.flatMap(getExecutionTaskIds)), [orders]);
  const orphanTasks = useMemo(() => {
    const map = new Map<string, AuvoAgendaTask>();
    for (const task of dayTasksQuery.data || []) {
      if (!referencedTaskIds.has(task.task_id)) map.set(task.task_id, task);
    }
    return Array.from(map.values()).filter((task) => !referencedTaskIds.has(task.task_id));
  }, [dayTasksQuery.data, referencedTaskIds]);

  const situationOptions = useMemo(() => {
    const options = new Map<string, string>();
    orders.forEach((order) => options.set(order.situacao_id, order.nome_situacao));
    return Array.from(options.entries()).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [orders]);

  const visibleSituationOptions = useMemo(() => {
    const term = normalizeFilterText(situationSearch);
    if (!term) return situationOptions;
    return situationOptions.filter(([, name]) => normalizeFilterText(name).includes(term));
  }, [situationOptions, situationSearch]);

  const technicianOptions = useMemo(() => {
    const names = new Set<string>();
    allTasksById.forEach((task) => task.technician_name && names.add(task.technician_name));
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [allTasksById]);

  const filteredRows = useMemo(() => {
    const term = normalizeName(search);
    return rows.filter((row) => {
      const { os, task, separation, bucket } = row;
      const matchesSearch = !term
        || normalizeName(os.nome_cliente).includes(term)
        || normalizeName(os.nome_tecnico || '').includes(term)
        || normalizeName(task?.technician_name || '').includes(term)
        || normalizeName(equipmentName(os)).includes(term)
        || String(os.codigo).includes(search.trim())
        || row.taskIds.some((id) => id.includes(search.trim()));
      const matchesAgenda = agendaFilter === 'all' || agendaFilter === bucket;
      const matchesDate = !dateFilterActive || datePart(task?.task_date) === agendaDate;
      const matchesTechnician = technicianFilter === 'all'
        || (technicianFilter === 'none' && !task?.technician_name)
        || task?.technician_name === technicianFilter;
      const matchesSituation = !excludedSituations.has(String(os.situacao_id));
      const matchesSeparation = separationFilter === 'all'
        || (separationFilter === 'pending' && !separation)
        || (separationFilter === 'separated' && !!separation && !separation.technician_name)
        || (separationFilter === 'linked' && !!separation?.technician_name);
      const executionStatus = normalizeFilterText(task ? taskStatus(task) : '');
      const matchesExecution = matchesExecutionFilters(executionFilters, executionStatus, !!task);
      const repairLocation = normalizeFilterText(
        getOsAttributeValue(os, GC_REPAIR_LOCATION_ATTRIBUTE_ID),
      );
      const matchesRepairLocation = repairLocationFilter === 'all'
        || (repairLocationFilter === 'galpao' && repairLocation.includes('galpao'))
        || (repairLocationFilter === 'cliente' && repairLocation.includes('cliente'))
        || (repairLocationFilter === 'sem_info' && !repairLocation);
      return matchesSearch
        && matchesAgenda
        && matchesDate
        && matchesTechnician
        && matchesSituation
        && matchesSeparation
        && matchesExecution
        && matchesRepairLocation;
    }).sort((a, b) => {
      const bucketOrder: AgendaBucket[] = ['scheduled-date', 'available', 'other-date', 'no-task'];
      const bucketDiff = bucketOrder.indexOf(a.bucket) - bucketOrder.indexOf(b.bucket);
      if (bucketDiff !== 0) return bucketDiff;
      const timeDiff = String(a.task?.task_date || '').localeCompare(String(b.task?.task_date || ''));
      if (timeDiff !== 0) return timeDiff;
      return String(b.os.codigo).localeCompare(String(a.os.codigo), 'pt-BR', { numeric: true });
    });
  }, [
    agendaDate,
    agendaFilter,
    dateFilterActive,
    excludedSituations,
    executionFilter,
    repairLocationFilter,
    rows,
    search,
    separationFilter,
    technicianFilter,
  ]);

  const filteredOrphans = useMemo(() => {
    if (agendaFilter !== 'all' && agendaFilter !== 'orphan') return [];
    if (separationFilter !== 'all') return [];
    if (excludedSituations.size > 0 || repairLocationFilter !== 'all') return [];
    const term = normalizeName(search);
    return orphanTasks.filter((task) => {
      const matchesSearch = !term
        || normalizeName(task.customer_name || '').includes(term)
        || normalizeName(task.technician_name || '').includes(term)
        || normalizeName(task.orientation || '').includes(term)
        || task.task_id.includes(search.trim());
      const matchesTechnician = technicianFilter === 'all'
        || (technicianFilter === 'none' && !task.technician_name)
        || task.technician_name === technicianFilter;
      const status = normalizeFilterText(taskStatus(task));
      const matchesExecution = executionFilter === 'all'
        || (executionFilter === 'em_andamento' && (
          status.includes('andamento') || status.includes('deslocamento') || status.includes('check-in')
        ))
        || (executionFilter === 'pausada' && status.includes('paus'))
        || (executionFilter === 'finalizada' && (status.includes('finalizada') || status.includes('check-out')))
        || (executionFilter === 'sem_exec' && (!status || status.includes('aberta') || status.includes('agendada')));
      return matchesSearch && matchesTechnician && matchesExecution;
    });
  }, [
    agendaFilter,
    excludedSituations.size,
    executionFilter,
    orphanTasks,
    repairLocationFilter,
    search,
    separationFilter,
    technicianFilter,
  ]);

  const isResolvingExecutionTasks = executionTaskIds.length > 0 && executionTasksQuery.isLoading;

  const counts = useMemo(() => ({
    total: rows.length,
    scheduled: rows.filter((row) => row.bucket === 'scheduled-date').length,
    available: rows.filter((row) => row.bucket === 'available' && (
      !isResolvingExecutionTasks || !!row.task
    )).length,
    separated: rows.filter((row) => !!row.separation && !row.separation.technician_name).length,
    linked: rows.reduce((total, row) => (
      row.separation?.technician_name
        ? total + (separatedQuantity(row.items) || row.separation.items_confirmed || row.separation.items_total)
        : total
    ), 0),
    orphans: orphanTasks.length,
  }), [isResolvingExecutionTasks, orphanTasks.length, rows]);

  const isLoading = osQuery.isLoading
    || separationsQuery.isLoading
    || localTechniciansQuery.isLoading
    || auvoUsersQuery.isLoading
    || dayTasksQuery.isLoading;
  const isRefreshing = isLoading
    || isResolvingExecutionTasks
    || manualRefreshing
    || osQuery.isFetching
    || separationsQuery.isFetching
    || dayTasksQuery.isFetching
    || executionTasksQuery.isFetching;

  const refreshAll = async () => {
    setManualRefreshing(true);
    try {
      // Zera o cache do GC/Auvo para forçar leitura nova (não só revalidação).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agenda-open-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['auvo-agenda'] }),
        queryClient.invalidateQueries({ queryKey: ['auvo-execution-tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['auvo-agenda-users'] }),
        queryClient.invalidateQueries({ queryKey: ['separations'] }),
        queryClient.invalidateQueries({ queryKey: ['technicians'] }),
      ]);
      await Promise.all([
        osQuery.refetch(),
        separationsQuery.refetch(),
        dayTasksQuery.refetch(),
        localTechniciansQuery.refetch(),
        auvoUsersQuery.refetch(),
        executionTaskIds.length > 0 ? executionTasksQuery.refetch() : Promise.resolve(),
      ]);
      // As tarefas de execução dependem das OS recém-carregadas.
      await queryClient.refetchQueries({ queryKey: ['auvo-execution-tasks'], type: 'active' });
      toast.success('Agenda atualizada (GestãoClick + Auvo)');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível atualizar a agenda');
    } finally {
      setManualRefreshing(false);
    }
  };


  const loadRowItems = async (row: AgendaOsRow): Promise<SeparationItemSnapshot[]> => {
    if (row.items.length > 0) return row.items;
    if (detailItemsByOsId[row.os.id]) return detailItemsByOsId[row.os.id];
    setLoadingItemsId(row.os.id);
    try {
      const detail = await getOS(row.os.id);
      const items = snapshotOrderProducts(detail.produtos);
      setDetailItemsByOsId((current) => ({ ...current, [row.os.id]: items }));
      return items;
    } finally {
      setLoadingItemsId(null);
    }
  };

  const toggleItems = async (row: AgendaOsRow) => {
    if (!expandedRows.has(row.os.id) && row.items.length === 0) {
      try {
        await loadRowItems(row);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Não foi possível carregar as peças da OS');
        return;
      }
    }
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(row.os.id)) next.delete(row.os.id);
      else next.add(row.os.id);
      return next;
    });
  };

  const openSchedule = (row: AgendaOsRow) => {
    if (row.taskIds.length === 0) {
      toast.error('Esta OS não possui o atributo Tarefa Execução (73344) no GestãoClick.');
      return;
    }
    const taskId = row.task?.task_id && row.taskIds.includes(row.task.task_id)
      ? row.task.task_id
      : row.taskIds[0];
    const task = allTasksById.get(taskId) || row.task;
    setScheduleRow(row);
    setScheduleTaskId(taskId);
    setScheduleDate(datePart(task?.task_date) || agendaDate);
    setScheduleTime(formatTime(task?.task_date) === '--:--' ? '08:00' : formatTime(task?.task_date));
    setScheduleTechnicianId(task?.technician_id ? String(task.technician_id) : '');
  };

  const saveSchedule = async () => {
    if (!scheduleRow || !scheduleTaskId || !scheduleDate || !scheduleTime || !scheduleTechnicianId) {
      toast.error('Informe tarefa, data, horário e técnico.');
      return;
    }
    setSavingSchedule(true);
    try {
      await updateAuvoAgendaTask({
        taskId: scheduleTaskId,
        scheduledAt: `${scheduleDate}T${scheduleTime}:00`,
        technicianId: Number(scheduleTechnicianId),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['auvo-execution-tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['auvo-agenda'] }),
      ]);
      toast.success(`Visita da OS #${scheduleRow.os.codigo} atualizada no Auvo.`);
      setScheduleRow(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao atualizar a visita');
    } finally {
      setSavingSchedule(false);
    }
  };

  const openAssignment = async (row: AgendaOsRow) => {
    if (!row.separation) {
      toast.error('Separe e confira as peças desta OS antes de vinculá-las ao técnico.');
      return;
    }
    let items = row.items;
    if (items.length === 0) {
      try {
        items = await loadRowItems(row);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Não foi possível carregar as peças da OS');
        return;
      }
    }
    if (items.length === 0) return toast.error('Não há peças registradas nesta separação.');
    const suggested = matchTechnician(row.task?.technician_name || null, localTechniciansQuery.data || []);
    setAssignmentRow({ ...row, items });
    setAssignmentTechnicianId(suggested?.gc_id || row.separation.technician_gc_id || '');
  };

  const saveAssignment = async () => {
    if (!assignmentRow?.separation || !assignmentTechnicianId) {
      toast.error('Escolha o técnico que receberá as peças.');
      return;
    }
    const technician = (localTechniciansQuery.data || []).find((item) => item.gc_id === assignmentTechnicianId);
    if (!technician) {
      toast.error('Técnico não encontrado no cadastro do Pick & Pack.');
      return;
    }
    setSavingAssignment(true);
    try {
      await assignSeparationToTechnician({
        separation: assignmentRow.separation,
        technician,
        items: assignmentRow.items,
        auvoTaskId: assignmentRow.task?.task_id || assignmentRow.taskIds[0] || null,
      });
      await queryClient.invalidateQueries({ queryKey: ['separations'] });
      toast.success(`${separatedQuantity(assignmentRow.items)} peça(s) da OS #${assignmentRow.os.codigo} vinculada(s) a ${technician.name}.`);
      setAssignmentRow(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao vincular as peças');
    } finally {
      setSavingAssignment(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Calendar className="h-6 w-6 text-primary" />
            Agendamento e Separação
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            As mesmas situações e regras operacionais do Controle OS, com agenda do Auvo e histórico real das peças separadas — tudo carregado pelo próprio Pick & Pack.
          </p>
          {osQuery.data && (
            <p className="mt-1 text-xs font-medium text-emerald-700">
              Fonte ativa: GestãoClick + Auvo + separações do Pick & Pack
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border bg-muted p-1">
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="h-8 px-3 text-xs"
            >
              <LayoutGrid className="mr-2 h-3.5 w-3.5" />
              Lista
            </Button>
            <Button
              variant={viewMode === 'calendar' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('calendar')}
              className="h-8 px-3 text-xs"
            >
              <Calendar className="mr-2 h-3.5 w-3.5" />
              Calendário
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={isRefreshing} className="gap-2 h-10">
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            Atualizar tudo
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <SummaryButton label="OS abertas" value={counts.total} active={agendaFilter === 'all'} onClick={() => setAgendaFilter('all')} />
        <SummaryButton label="Agenda do dia" value={counts.scheduled} active={agendaFilter === 'scheduled-date'} onClick={() => setAgendaFilter('scheduled-date')} tone="blue" />
        <SummaryButton label="Disponíveis" value={counts.available} active={agendaFilter === 'available'} onClick={() => setAgendaFilter('available')} tone="amber" />
        <SummaryButton label="Separadas sem vínculo" value={counts.separated} active={separationFilter === 'separated'} onClick={() => setSeparationFilter(separationFilter === 'separated' ? 'all' : 'separated')} tone="green" />
        <SummaryButton label="Peças vinculadas" value={counts.linked} active={separationFilter === 'linked'} onClick={() => setSeparationFilter(separationFilter === 'linked' ? 'all' : 'linked')} tone="violet" />
        <SummaryButton label="Tarefas sem OS" value={counts.orphans} active={agendaFilter === 'orphan'} onClick={() => setAgendaFilter('orphan')} tone="red" />
      </div>

      <Card className="space-y-4 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <FilterField label="Data da tarefa de execução" icon={Calendar}>
            <div className="space-y-1">
              <Input
                type="date"
                value={agendaDate}
                onChange={(event) => {
                  setAgendaDate(event.target.value);
                  if (event.target.value) setDateFilterActive(true);
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={dateFilterActive}
                    onChange={(event) => setDateFilterActive(event.target.checked)}
                  />
                  Filtrar apenas esta data
                </label>
                {dateFilterActive && (
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => setDateFilterActive(false)}
                  >
                    Limpar
                  </button>
                )}
              </div>
            </div>
          </FilterField>
          <FilterField label="Técnico da execução" icon={User}>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={technicianFilter} onChange={(event) => setTechnicianFilter(event.target.value)}>
              <option value="all">Todos</option>
              <option value="none">Sem técnico</option>
              {technicianOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </FilterField>
          <FilterField label="Agenda" icon={Clock}>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={agendaFilter} onChange={(event) => setAgendaFilter(event.target.value as AgendaFilter)}>
              <option value="all">Todas</option>
              <option value="scheduled-date">Agendadas no dia</option>
              <option value="available">Disponíveis para agendar</option>
              <option value="other-date">Agendadas em outra data</option>
              <option value="no-task">Sem tarefa execução</option>
              <option value="orphan">Tarefas Auvo sem OS</option>
            </select>
          </FilterField>
          <FilterField label="Separação" icon={PackageCheck}>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={separationFilter} onChange={(event) => setSeparationFilter(event.target.value as SeparationFilter)}>
              <option value="all">Todas</option>
              <option value="pending">Aguardando separação</option>
              <option value="separated">Separada, sem vínculo</option>
              <option value="linked">Peças vinculadas</option>
            </select>
          </FilterField>
          <FilterField label="Buscar" icon={Search}>
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="OS, cliente, tarefa…" />
          </FilterField>
        </div>

        <div className="border-t pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filtros operacionais do Controle OS</p>
          <div className="flex flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Filter className="h-3.5 w-3.5" />
                  Situação
                  {excludedSituations.size > 0 && (
                    <Badge variant="secondary" className="ml-1 text-[10px]">{excludedSituations.size} ocultas</Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="start">
                <div className="space-y-2">
                  <Input
                    value={situationSearch}
                    onChange={(event) => setSituationSearch(event.target.value)}
                    placeholder="Buscar situação…"
                    className="h-8 text-xs"
                  />
                  <div className="flex items-center gap-2 pb-1">
                    <Checkbox
                      checked={excludedSituations.size === 0}
                      onCheckedChange={(checked) => {
                        setExcludedSituations(checked
                          ? new Set()
                          : new Set(situationOptions.map(([id]) => id)));
                      }}
                    />
                    <span className="text-xs font-medium">Todas</span>
                  </div>
                  <ScrollArea className="h-52">
                    <div className="space-y-1.5 pr-3">
                      {visibleSituationOptions.map(([id, name]) => (
                        <label key={id} className="flex cursor-pointer items-center gap-2">
                          <Checkbox
                            checked={!excludedSituations.has(id)}
                            onCheckedChange={() => {
                              setExcludedSituations((current) => {
                                const next = new Set(current);
                                if (next.has(id)) next.delete(id);
                                else next.add(id);
                                return next;
                              });
                            }}
                          />
                          <span className="text-xs">{name}</span>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </PopoverContent>
            </Popover>

            {([
              ['all', 'Todas'],
              ['em_andamento', '🔄 Em andamento'],
              ['pausada', '⏸ Pausada'],
              ['finalizada', '✅ Finalizada'],
              ['sem_exec', 'Sem execução'],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                variant={executionFilter === value ? 'default' : 'outline'}
                size="sm"
                className="h-8 text-xs"
                onClick={() => setExecutionFilter(value)}
              >
                {label}
              </Button>
            ))}

            <span className="mx-1 h-6 w-px bg-border" />

            {([
              ['all', 'Local: todos'],
              ['galpao', '🏭 Galpão'],
              ['cliente', '🏢 Cliente'],
              ['sem_info', 'Sem local'],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                variant={repairLocationFilter === value ? 'default' : 'outline'}
                size="sm"
                className="h-8 text-xs"
                onClick={() => setRepairLocationFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {osQuery.isError && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Não foi possível carregar as OS do GestãoClick.</p>
          <p className="mt-1">{osQuery.error instanceof Error ? osQuery.error.message : 'Falha ao consultar as OS no Pick & Pack'}</p>
        </Card>
      )}

      {!isLoading && isResolvingExecutionTasks && (
        <Card className="border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>As OS já estão disponíveis. Atualizando técnico, data e status de {executionTaskIds.length} tarefas do Auvo em segundo plano…</span>
          </div>
        </Card>
      )}

      {executionTasksQuery.isError && (
        <Card className="border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Algumas tarefas do Auvo não responderam. As OS continuam disponíveis; use “Atualizar tudo” para tentar novamente.
        </Card>
      )}

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mb-2 h-7 w-7 animate-spin" />
          <p className="text-sm">Carregando OS, agenda do Auvo e separações…</p>
        </div>
      ) : (
        <div className="space-y-3">
          {viewMode === 'calendar' ? (
            <Card className="p-4">
              <FullCalendar
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                initialView="dayGridMonth"
                headerToolbar={{
                  left: 'prev,next today',
                  center: 'title',
                  right: 'dayGridMonth,timeGridWeek,timeGridDay',
                }}
                locale="pt-br"
                height="auto"
                events={filteredRows.filter(r => r.task?.task_date).map(row => ({
                  id: row.os.id,
                  title: `OS #${row.os.codigo} - ${row.os.nome_cliente.split(' ')[0]}`,
                  start: row.task?.task_date || '',
                  backgroundColor: row.bucket === 'scheduled-date' ? '#3B82F6' : '#94A3B8',
                  borderColor: row.bucket === 'scheduled-date' ? '#2563EB' : '#64748B',
                  extendedProps: { row }
                }))}
                eventClick={(info) => {
                  setSelectedCalendarEvent(info.event.extendedProps.row);
                }}
              />
              
              {selectedCalendarEvent && (
                <Dialog open={!!selectedCalendarEvent} onOpenChange={(open) => !open && setSelectedCalendarEvent(null)}>
                  <DialogContent className="max-w-4xl">
                    <DialogHeader>
                      <DialogTitle>Detalhes da OS #{selectedCalendarEvent.os.codigo}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <AgendaRowContent 
                        row={selectedCalendarEvent}
                        expanded={true}
                        onToggleItems={() => toggleItems(selectedCalendarEvent)}
                        onSchedule={() => openSchedule(selectedCalendarEvent)}
                        onLink={() => openAssignment(selectedCalendarEvent)}
                        isLoadingItems={loadingItemsId === selectedCalendarEvent.os.id}
                        detailItems={detailItemsByOsId[selectedCalendarEvent.os.id]}
                        isResolvingExecutionTasks={isResolvingExecutionTasks}
                        referencedTaskIds={referencedTaskIds}
                      />
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </Card>
          ) : (
            <>
              {filteredRows.map((row) => (
                <AgendaRowContent 
                  key={row.os.id}
                  row={row}
                  expanded={expandedRows.has(row.os.id)}
                  onToggleItems={() => toggleItems(row)}
                  onSchedule={() => openSchedule(row)}
                  onLink={() => openAssignment(row)}
                  isLoadingItems={loadingItemsId === row.os.id}
                  detailItems={detailItemsByOsId[row.os.id]}
                  isResolvingExecutionTasks={isResolvingExecutionTasks}
                  referencedTaskIds={referencedTaskIds}
                />
              ))}
            </>
          )}
        </div>
      )}

      {!isLoading && (
        <div className="space-y-3">
          {filteredOrphans.map((task) => (
            <Card key={`orphan-${task.task_id}`} className="border-l-4 border-l-red-400 bg-red-50/30 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700"><Link2Off className="mr-1 h-3 w-3" />Tarefa Auvo sem OS aberta</Badge>
                    <Badge variant="secondary">Tarefa #{task.task_id}</Badge>
                    {/^\s*entrega parcial/i.test(task.orientation || '') && (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Entrega parcial</Badge>
                    )}

                    <Badge variant="outline">{taskStatus(task)}</Badge>
                  </div>
                  <p className="font-semibold">{task.customer_name || 'Cliente não informado no Auvo'}</p>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <span><Clock className="mr-1 inline h-3 w-3" />{formatDate(task.task_date)} {formatTime(task.task_date)}</span>
                    <span><User className="mr-1 inline h-3 w-3" />{task.technician_name || 'Sem técnico'}</span>
                    {task.address && <span><MapPin className="mr-1 inline h-3 w-3" />{task.address}</span>}
                  </div>
                  {task.orientation && <p className="line-clamp-2 max-w-4xl text-xs text-muted-foreground">{task.orientation}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
                  <p className="max-w-sm text-xs text-red-700">Esta tarefa é exibida para conferência, mas não pode receber peças: nenhum atributo 73344 de uma OS aberta aponta para ela.</p>
                  <Button asChild variant="outline" size="sm">
                    <a href={auvoTaskUrl(task.task_id)} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />Abrir no Auvo
                    </a>
                  </Button>
                </div>
              </div>
            </Card>
          ))}

          {filteredRows.length === 0 && filteredOrphans.length === 0 && (
            <div className="rounded-lg border bg-muted/20 py-16 text-center">
              <ClipboardList className="mx-auto mb-2 h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Nenhum registro encontrado para os filtros aplicados.</p>
            </div>
          )}
        </div>
      )}

      <Dialog open={!!scheduleRow} onOpenChange={(open) => !open && !savingSchedule && setScheduleRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Agendar visita {scheduleRow ? `— OS #${scheduleRow.os.codigo}` : ''}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {scheduleRow && scheduleRow.taskIds.length > 1 && (
              <FilterField label="Tarefa de execução" icon={ClipboardList}>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={scheduleTaskId} onChange={(event) => {
                  const id = event.target.value;
                  const task = allTasksById.get(id);
                  setScheduleTaskId(id);
                  setScheduleDate(datePart(task?.task_date) || agendaDate);
                  setScheduleTime(formatTime(task?.task_date) === '--:--' ? '08:00' : formatTime(task?.task_date));
                  setScheduleTechnicianId(task?.technician_id ? String(task.technician_id) : '');
                }}>
                  {scheduleRow.taskIds.map((id) => <option key={id} value={id}>Tarefa #{id}</option>)}
                </select>
              </FilterField>
            )}
            <div className="grid grid-cols-2 gap-3">
              <FilterField label="Data" icon={Calendar}><Input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /></FilterField>
              <FilterField label="Horário" icon={Clock}><Input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} /></FilterField>
            </div>
            <FilterField label="Técnico no Auvo" icon={User}>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={scheduleTechnicianId} onChange={(event) => setScheduleTechnicianId(event.target.value)}>
                <option value="">Selecione o técnico</option>
                {(auvoUsersQuery.data || []).map((technician) => <option key={technician.user_id} value={technician.user_id}>{technician.name}</option>)}
              </select>
            </FilterField>
            <p className="rounded-md bg-blue-50 p-3 text-xs text-blue-800">Esta ação altera a data, o horário e o técnico diretamente na tarefa de execução do Auvo. O vínculo das peças é feito separadamente e continua sendo uma escolha sua.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleRow(null)} disabled={savingSchedule}>Cancelar</Button>
            <Button onClick={saveSchedule} disabled={savingSchedule || !scheduleTechnicianId || !scheduleDate || !scheduleTime}>{savingSchedule && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar no Auvo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assignmentRow} onOpenChange={(open) => !open && !savingAssignment && setAssignmentRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Vincular peças ao técnico {assignmentRow ? `— OS #${assignmentRow.os.codigo}` : ''}</DialogTitle></DialogHeader>
          {assignmentRow && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-sm font-semibold">{assignmentRow.os.nome_cliente}</p>
                <p className="mt-1 text-xs text-muted-foreground">Sugestão do Auvo: <strong className="text-foreground">{assignmentRow.task?.technician_name || 'nenhuma'}</strong>. Você pode escolher outro técnico abaixo.</p>
              </div>
              <FilterField label="Técnico que receberá as peças" icon={UserPlus}>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={assignmentTechnicianId} onChange={(event) => setAssignmentTechnicianId(event.target.value)}>
                  <option value="">Selecione o técnico</option>
                  {(localTechniciansQuery.data || []).map((technician) => <option key={technician.id} value={technician.gc_id}>{technician.name}</option>)}
                </select>
              </FilterField>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Peças que serão vinculadas ({separatedQuantity(assignmentRow.items)} unidade(s) em {assignmentRow.items.length} item(ns))</p>
                <div className="max-h-56 overflow-y-auto rounded-md border">
                  {assignmentRow.items.map((item, index) => (
                    <div key={`${item.product_id}-${item.variation_id}-${index}`} className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-b-0">
                      <div className="min-w-0"><p className="truncate font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.code || 'Sem código'}</p></div>
                      <Badge variant="secondary">{item.confirmed_quantity} {item.unit}</Badge>
                    </div>
                  ))}
                </div>
              </div>
              <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">Ao confirmar, estas peças ficam registradas no histórico da separação sob responsabilidade do técnico escolhido e a OS muda para “Retirada pelo técnico”.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignmentRow(null)} disabled={savingAssignment}>Cancelar</Button>
            <Button onClick={saveAssignment} disabled={savingAssignment || !assignmentTechnicianId}>{savingAssignment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Vincular {assignmentRow ? separatedQuantity(assignmentRow.items) : 0} peça(s)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryButton({ label, value, active, onClick, tone = 'default' }: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  tone?: 'default' | 'blue' | 'amber' | 'green' | 'violet' | 'red';
}) {
  const tones = {
    default: 'text-foreground',
    blue: 'text-blue-700',
    amber: 'text-amber-700',
    green: 'text-emerald-700',
    violet: 'text-violet-700',
    red: 'text-red-700',
  };
  return (
    <button type="button" onClick={onClick} className={cn('rounded-lg border bg-card p-3 text-left transition hover:border-primary/50 hover:shadow-sm', active && 'border-primary ring-1 ring-primary/20')}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold', tones[tone])}>{value}</p>
    </button>
  );
}

function FilterField({ label, icon: Icon, children }: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Icon className="h-3 w-3" />{label}</label>
      {children}
    </div>
  );
}

function ItemsPanel({ items, technicianName }: { items: SeparationItemSnapshot[]; technicianName: string | null }) {
  return (
    <div className="border-t bg-muted/20 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Peças da separação</p>
        {technicianName && <p className="text-xs font-medium text-violet-700"><User className="mr-1 inline h-3 w-3" />Responsável: {technicianName}</p>}
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item, index) => (
          <div key={`${item.product_id}-${item.variation_id}-${index}`} className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
            <div className="min-w-0"><p className="truncate text-xs font-medium">{item.name}</p><p className="text-[11px] text-muted-foreground">{item.code || 'Sem código'}</p></div>
            <Badge variant="secondary" className="shrink-0">{item.confirmed_quantity} {item.unit}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}


function AgendaRowContent({ 
  row, 
  expanded, 
  onToggleItems, 
  onSchedule, 
  onLink, 
  isLoadingItems, 
  detailItems,
  isResolvingExecutionTasks,
  referencedTaskIds
}: { 
  row: AgendaOsRow; 
  expanded: boolean; 
  onToggleItems: () => void; 
  onSchedule: () => void; 
  onLink: () => void; 
  isLoadingItems: boolean;
  detailItems?: SeparationItemSnapshot[];
  isResolvingExecutionTasks: boolean;
  referencedTaskIds: Set<string>;
}) {
  const linked = !!row.separation?.technician_name;
  const awaitingTask = isResolvingExecutionTasks && row.taskIds.length > 0 && !row.task;
  
  return (
    <Card className={cn('overflow-hidden border-l-4', 
      row.bucket === 'scheduled-date' && 'border-l-blue-500', 
      row.bucket === 'available' && 'border-l-amber-500', 
      row.bucket === 'other-date' && 'border-l-slate-400', 
      row.bucket === 'no-task' && 'border-l-red-400'
    )}>
      <div className="p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-primary text-primary-foreground">OS #{row.os.codigo}</Badge>
              <Badge variant="outline">{row.os.nome_situacao}</Badge>
              {awaitingTask ? (
                <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />Consultando Auvo
                </Badge>
              ) : (
                <Badge variant="outline" className={BUCKET_META[row.bucket].className}>{BUCKET_META[row.bucket].label}</Badge>
              )}
              {row.separation ? (
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                  <PackageCheck className="mr-1 h-3 w-3" /> {separatedQuantity(row.items) || row.separation.items_confirmed || row.separation.items_total} peça(s) separada(s)
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  <PackageSearch className="mr-1 h-3 w-3" /> Aguardando separação
                </Badge>
              )}
              {linked && (
                <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Peças com {row.separation?.technician_name}
                </Badge>
              )}
            </div>

            <div>
              <p className="font-semibold text-foreground">{row.os.nome_cliente || 'Cliente não informado no GC'}</p>
              {equipmentName(row.os) && <p className="mt-0.5 text-xs text-muted-foreground"><Wrench className="mr-1 inline h-3 w-3" />{equipmentName(row.os)}</p>}
            </div>

            <div className="grid gap-x-5 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
              <span><strong className="text-foreground">Téc. OS:</strong> {row.os.nome_tecnico || '—'}</span>
              <span><strong className="text-foreground">Téc. execução:</strong> {row.task?.technician_name || 'Sem técnico'}</span>
              <span><strong className="text-foreground">Tarefa:</strong> {row.taskIds.length ? row.taskIds.join(' / ') : '73344 ausente'}</span>
              <span><strong className="text-foreground">Execução:</strong> {row.task ? `${formatDate(row.task.task_date)} ${formatTime(row.task.task_date)}` : 'Sem agenda'}</span>
              <span><strong className="text-foreground">Data OS:</strong> {formatDate(row.os.data_entrada || row.os.data)}</span>
              <span><strong className="text-foreground">Status Auvo:</strong> {row.task ? taskStatus(row.task) : '—'}</span>
              <span><strong className="text-foreground">Valor:</strong> {formatMoney(row.os.valor_total)}</span>
              <span><strong className="text-foreground">Separação:</strong> {row.separation ? formatDate(row.separation.concluded_at) : 'Pendente'}</span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2 xl:max-w-[420px] xl:justify-end">
            <Button variant="outline" size="sm" onClick={onToggleItems} disabled={isLoadingItems}>
              {isLoadingItems ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PackageOpen className="mr-1.5 h-3.5 w-3.5" />}
              Peças ({row.items.length || row.separation?.items_total || 'carregar'})
              {expanded ? <ChevronUp className="ml-1 h-3.5 w-3.5" /> : <ChevronDown className="ml-1 h-3.5 w-3.5" />}
            </Button>
            {!row.separation && (
              <Button asChild variant="outline" size="sm"><Link to="/checkout"><PackageSearch className="mr-1.5 h-3.5 w-3.5" />Separar</Link></Button>
            )}
            <Button variant="outline" size="sm" onClick={onSchedule} disabled={row.taskIds.length === 0}>
              <Calendar className="mr-1.5 h-3.5 w-3.5" />{row.task ? 'Alterar agenda' : 'Agendar visita'}
            </Button>
            {row.separation && (
              <Button size="sm" onClick={onLink}>
                <UserPlus className="mr-1.5 h-3.5 w-3.5" />{linked ? 'Alterar vínculo' : 'Vincular peças'}
              </Button>
            )}
            <Button asChild variant="ghost" size="icon" title="Abrir OS no GestãoClick"><a href={gcOrderUrl(row.os.id)} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>
            {(row.task?.task_id || row.taskIds[0]) && (
              <Button asChild variant="ghost" size="icon" title="Abrir tarefa no Auvo">
                <a href={auvoTaskUrl(row.task?.task_id || row.taskIds[0])} target="_blank" rel="noreferrer"><Calendar className="h-4 w-4" /></a>
              </Button>
            )}
          </div>
        </div>
      </div>

      {expanded && row.items.length > 0 && <ItemsPanel items={row.items} technicianName={row.separation?.technician_name || null} />}
    </Card>
  );
}
