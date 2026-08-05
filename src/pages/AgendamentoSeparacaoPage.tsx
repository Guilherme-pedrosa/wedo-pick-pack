import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Calendar,
  User,
  Search,
  Filter,
  RefreshCw,
  Clock,
  MapPin,
  AlertTriangle,
  UserPlus,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  getAuvoAgenda,
  auvoStatusLabel,
  matchTechnician,
  normalizeName,
  AuvoAgendaTask,
} from '@/api/auvoAgenda';
import { getSeparations, linkTechnicianToSeparation, SeparationRecord } from '@/api/separations';
import { getOS, updateOSStatus, getVenda, updateVendaStatus } from '@/api/gestaoclick';
import { logSystemAction } from '@/lib/systemLog';
import { toast } from 'sonner';

const RETIRADA_TECNICO_STATUS_ID = '7684665';

interface LocalTechnician {
  id: string;
  gc_id: string;
  name: string;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(iso: string | null) {
  if (!iso) return '--:--';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

export default function AgendamentoSeparacaoPage() {
  const [search, setSearch] = useState('');
  const [date, setDate] = useState<string>(todayISO());
  const [selectedTechnician, setSelectedTechnician] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  const [technicians, setTechnicians] = useState<LocalTechnician[]>([]);
  const [linkingTask, setLinkingTask] = useState<string | null>(null);
  const [manualTask, setManualTask] = useState<AuvoAgendaTask | null>(null);
  const [techSearch, setTechSearch] = useState('');

  const {
    data: tasks = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['auvo-agenda', date],
    queryFn: () => getAuvoAgenda(date),
  });

  const { data: separations = [], refetch: refetchSeparations } = useQuery({
    queryKey: ['separations-agendamento'],
    queryFn: () => {
      const from = new Date();
      from.setDate(from.getDate() - 45);
      return getSeparations({ fromDate: from.toISOString(), status: 'valid' });
    },
  });

  useEffect(() => {
    supabase
      .from('technicians')
      .select('id, gc_id, name')
      .eq('active', true)
      .order('name')
      .then(({ data }) => setTechnicians((data || []) as LocalTechnician[]));
  }, []);

  /** Matches an Auvo task to a local separation (by order code, then customer_id_gc, then client name). */
  const findSeparation = (task: AuvoAgendaTask): SeparationRecord | null => {
    // 1. Match by Order Code (OS or Budget)
    const codes = [task.os_code, task.orcamento_code].filter(Boolean) as string[];
    for (const code of codes) {
      const byCode = separations.find((s) => s.order_code === code);
      if (byCode) return byCode;
    }

    // 2. Match by GC Customer ID (if available in Auvo task)
    if (task.customer_id_gc) {
      const byCustomerId = separations.find((s) => s.client_id === task.customer_id_gc);
      if (byCustomerId) return byCustomerId;
    }

    // 3. Match by Client Name
    const client = normalizeName(task.customer_name || '');
    if (!client) return null;
    return (
      separations.find((s) => {
        const sc = normalizeName(s.client_name);
        return sc === client || sc.includes(client) || client.includes(sc);
      }) || null
    );
  };

  const technicianOptions = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => {
      if (t.technician_name) set.add(t.technician_name);
    });
    return Array.from(set).sort();
  }, [tasks]);

  const statusOptions = useMemo(() => {
    const set = new Set<number>();
    tasks.forEach((t) => {
      if (t.status != null) set.add(t.status);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const term = normalizeName(search);
    return tasks.filter((t) => {
      const matchesSearch =
        !term ||
        normalizeName(t.customer_name || '').includes(term) ||
        normalizeName(t.orientation || '').includes(term) ||
        (t.os_code || '').includes(search.trim()) ||
        (t.orcamento_code || '').includes(search.trim());

      const matchesTech =
        selectedTechnician === 'all' ||
        (selectedTechnician === 'none' && !t.technician_name) ||
        t.technician_name === selectedTechnician;

      const matchesStatus = selectedStatus === 'all' || String(t.status ?? '') === selectedStatus;

      return matchesSearch && matchesTech && matchesStatus;
    });
  }, [tasks, search, selectedTechnician, selectedStatus]);

  const doLink = async (task: AuvoAgendaTask, sep: SeparationRecord, tech: LocalTechnician) => {
    setLinkingTask(task.task_id);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      let gcUsuarioId: string | undefined;
      let operatorName = sep.operator_name || 'Operador';
      if (currentUser) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('gc_usuario_id, name')
          .eq('id', currentUser.id)
          .maybeSingle();
        gcUsuarioId = prof?.gc_usuario_id || undefined;
        if (prof?.name) operatorName = prof.name;
      }

      // Prepara a nota do log
      const gcNote = `Técnico vinculado: ${tech.name} (ID ${tech.gc_id}) | Agendamento Auvo tarefa ${task.task_id} | Status: RETIRADA PELO TÉCNICO | por ${operatorName}`;

      // 1. Atualiza status no GC e vincula técnico na Separation (Histórico)
      if (sep.order_type === 'os') {
        const order = await getOS(sep.order_id);
        await updateOSStatus(sep.order_id, order, RETIRADA_TECNICO_STATUS_ID, undefined, gcUsuarioId, gcNote);
      } else {
        const order = await getVenda(sep.order_id);
        await updateVendaStatus(sep.order_id, order, RETIRADA_TECNICO_STATUS_ID, undefined, gcUsuarioId, gcNote);
      }

      const ok = await linkTechnicianToSeparation(sep.id, tech.gc_id, tech.name);
      if (!ok) {
        toast.error('Não foi possível salvar o vínculo do técnico no histórico');
        return;
      }

      // 2. Vincular PEÇAS da separação ao técnico no GC (Ativos do Técnico)
      // Buscamos os itens da separação para registrar o movimento de "Posse do Técnico"
      const { data: sepItemsRaw } = await supabase
        .from('box_items')
        .select('produto_id')
        .eq('separation_id', sep.id);
      
      const itemsCount = (sepItemsRaw || []).length;

      const logDetails = {
        separation_id: sep.id,
        origem: 'agendamento',
        auvo_task_id: task.task_id,
        auvo_technician: task.technician_name,
        technician_name: tech.name,
        technician_gc_id: tech.gc_id,
        client_name: sep.client_name,
        operator_name: operatorName,
        items_count: (sepItems || []).length
      };

      await logSystemAction({
        module: 'separations',
        action: 'vincular_tecnico',
        entityType: sep.order_type,
        entityId: sep.order_id,
        entityName: `${sep.order_type === 'os' ? 'OS' : 'Venda'} #${sep.order_code}`,
        details: logDetails,
      });

      toast.success(`Técnico "${tech.name}" vinculado e peças lincadas à ${sep.order_type === 'os' ? 'OS' : 'Venda'} #${sep.order_code}`);
      setManualTask(null);
      refetchSeparations();
    } catch (err) {
      console.error('Error linking technician from agenda:', err);
      toast.error(`Erro ao vincular técnico: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
    } finally {
      setLinkingTask(null);
    }
  };

  const handleAutoLink = async (task: AuvoAgendaTask) => {
    const sep = findSeparation(task);
    if (!sep) {
      toast.error('Nenhuma separação encontrada para esta tarefa. Conclua a separação antes de vincular.');
      return;
    }
    const suggested = matchTechnician(task.technician_name, technicians);
    if (!suggested) {
      setTechSearch(task.technician_name || '');
      setManualTask(task);
      toast.info('Técnico do Auvo não encontrado no cadastro. Selecione manualmente.');
      return;
    }
    await doLink(task, sep, suggested);
  };

  const filteredTechs = technicians.filter((t) =>
    normalizeName(t.name).includes(normalizeName(techSearch)),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calendar className="h-6 w-6 text-primary" />
          Agendamento e Separação
        </h1>
        <p className="text-muted-foreground text-sm">
          Tarefas de execução do Auvo por data de agendamento, com vinculação automática do técnico à separação.
        </p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Data de agendamento
            </label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <User className="h-3 w-3" /> Técnico (execução)
            </label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={selectedTechnician}
              onChange={(e) => setSelectedTechnician(e.target.value)}
            >
              <option value="all">Todos os técnicos</option>
              <option value="none">Sem técnico (não agendadas)</option>
              {technicianOptions.map((tech) => (
                <option key={tech} value={tech}>{tech}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Filter className="h-3 w-3" /> Situação
            </label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="all">Todas as situações</option>
              {statusOptions.map((s) => (
                <option key={s} value={String(s)}>{auvoStatusLabel(s)}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Search className="h-3 w-3" /> Buscar
            </label>
            <Input
              placeholder="Código OS ou Cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex items-end">
            <Button variant="outline" className="w-full gap-2" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mb-2" />
            <p>Carregando agenda do Auvo...</p>
          </div>
        ) : isError ? (
          <div className="text-center py-16 border rounded-lg bg-destructive/5">
            <AlertTriangle className="h-10 w-10 mx-auto text-destructive/60 mb-2" />
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : 'Erro ao carregar agenda'}
            </p>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="text-center py-20 border rounded-lg bg-muted/20">
            <Filter className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-muted-foreground">Nenhuma tarefa encontrada para os filtros selecionados.</p>
          </div>
        ) : (
          filteredTasks.map((task) => {
            const hasTech = !!task.technician_name;
            const sep = findSeparation(task);
            const linked = !!sep?.technician_name;
            const suggested = matchTechnician(task.technician_name, technicians);

            return (
              <Card
                key={task.task_id}
                className={`p-4 border-l-4 ${
                  !hasTech ? 'bg-yellow-50/60 border-l-yellow-400' : 'border-l-primary'
                }`}
              >
                <div className="flex flex-col md:flex-row justify-between gap-4">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{task.customer_name || 'Cliente não informado'}</span>
                      <Badge variant="secondary">{auvoStatusLabel(task.status)}</Badge>
                      {task.task_type_name && (
                        <Badge variant="outline">{task.task_type_name}</Badge>
                      )}
                      {!hasTech && (
                        <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
                          Não agendada
                        </Badge>
                      )}
                      {linked && (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Técnico vinculado
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {formatTime(task.task_date)}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" /> {task.technician_name || 'Sem técnico de execução'}
                      </span>
                      {task.address && (
                        <span className="flex items-center gap-1 truncate max-w-[320px]">
                          <MapPin className="h-3 w-3 shrink-0" /> {task.address}
                        </span>
                      )}
                      <span>Tarefa #{task.task_id}</span>
                    </div>

                    {task.orientation && (
                      <p className="text-xs text-muted-foreground/80 whitespace-pre-line line-clamp-3 mt-1">
                        {task.orientation}
                      </p>
                    )}

                    <div className="text-xs mt-2">
                      {sep ? (
                        <span className="text-muted-foreground">
                          Separação: <strong>#{sep.order_code}</strong> · {sep.client_name}
                          {sep.technician_name ? ` · Técnico: ${sep.technician_name}` : ' · sem técnico vinculado'}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/70">Sem separação concluída correspondente</span>
                      )}
                    </div>
                  </div>

                  <div className="flex md:flex-col gap-2 md:w-56 shrink-0">
                    <Button
                      className="flex-1"
                      variant={linked ? 'outline' : 'default'}
                      disabled={!sep || !hasTech || linkingTask === task.task_id}
                      onClick={() => handleAutoLink(task)}
                    >
                      {linkingTask === task.task_id ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <UserPlus className="h-4 w-4 mr-2" />
                      )}
                      {linked ? 'Revincular' : 'Vincular técnico'}
                    </Button>
                    {sep && hasTech && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setTechSearch(task.technician_name || '');
                          setManualTask(task);
                        }}
                      >
                        Escolher outro
                      </Button>
                    )}
                    {hasTech && !suggested && (
                      <p className="text-[11px] text-amber-600">
                        Técnico do Auvo sem cadastro local
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      <Dialog open={!!manualTask} onOpenChange={(open) => !open && setManualTask(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular técnico</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Buscar técnico..."
            value={techSearch}
            onChange={(e) => setTechSearch(e.target.value)}
          />
          <div className="max-h-72 overflow-y-auto space-y-1 mt-2">
            {filteredTechs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Nenhum técnico encontrado</p>
            ) : (
              filteredTechs.map((tech) => (
                <button
                  key={tech.id}
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-muted text-sm"
                  disabled={!!linkingTask}
                  onClick={() => {
                    if (!manualTask) return;
                    const sep = findSeparation(manualTask);
                    if (!sep) {
                      toast.error('Nenhuma separação encontrada para esta tarefa.');
                      return;
                    }
                    doLink(manualTask, sep, tech);
                  }}
                >
                  {tech.name}
                  <span className="text-xs text-muted-foreground ml-2">Nº {tech.gc_id}</span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
