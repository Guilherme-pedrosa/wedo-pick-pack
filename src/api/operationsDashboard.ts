import { getExecutionTaskIds } from '@/api/agendaControl';
import { getOpenAgendaOrders } from '@/api/agendaOrders';
import { getAuvoAgenda, getAuvoTasksByIds, type AuvoAgendaTask } from '@/api/auvoAgenda';
import type { GCOrdemServico } from '@/api/types';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Separation = Tables<'separations'>;
type SyncRun = Tables<'sync_runs'>;
type GenerationLog = Tables<'os_generation_logs'>;
type SystemLog = Tables<'system_logs'>;

export interface GenerationSummary {
  todaySuccess: number;
  weekSuccess: number;
  weekValue: number;
  unresolvedFailures: GenerationLog[];
}

export interface SyncSummary {
  latestIncremental: SyncRun | null;
  latestSuccessfulFull: SyncRun | null;
  stalledIncrementals: SyncRun[];
}

export interface CloudOperationsDashboard {
  separations: {
    today: number;
    week: number;
    weekItems: number;
    returns30d: number;
    recent: Separation[];
  };
  purchases: {
    shortageProducts: number;
    budgets: number;
    estimatedValue: number;
    coveredItems: number;
    healthyProducts: number;
    scannedAt: string | null;
  } | null;
  purchaseTracker: {
    status: string;
    errorMessage: string | null;
    critical: number;
    overdue: number;
    warning: number;
    total: number;
    scannedAt: string;
  } | null;
  generations: GenerationSummary;
  partialWriteoff: {
    active: number;
    awaitingBalance: number;
    reconciliationRequired: number;
    awaitingCheckoutBatches: number;
  };
  assets: {
    activeBoxes: number;
    boxesPendingConference: number;
    activeToolboxes: number;
    unassignedToolboxes: number;
  };
  sync: SyncSummary;
  gcStatusChangesWeek: number;
  activity: SystemLog[];
  refreshedAt: string;
}

export interface IntegrationOperationsDashboard {
  openOrders: number;
  executionTaskRefs: number;
  resolvedExecutionTasks: number;
  ordersWithoutExecutionTask: number;
  tasksWithoutDate: number;
  tasksWithoutTechnician: number;
  linkedTasksScheduledToday: number;
  agendaToday: number;
  agendaOpen: number;
  agendaInProgress: number;
  agendaFinished: number;
  agendaUnassigned: number;
  refreshedAt: string;
}

function localDayStart(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function assertResult(error: { message: string } | null, label: string): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export function summarizeGenerationLogs(
  logs: GenerationLog[],
  todayStart: Date,
): GenerationSummary {
  const ordered = [...logs].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const latestByBudget = new Map<string, GenerationLog>();
  for (const log of ordered) {
    const key = log.orcamento_id || log.orcamento_codigo;
    if (!latestByBudget.has(key)) latestByBudget.set(key, log);
  }

  const successful = logs.filter((log) => log.success);
  return {
    todaySuccess: successful.filter((log) => new Date(log.created_at) >= todayStart).length,
    weekSuccess: successful.length,
    weekValue: successful.reduce((sum, log) => sum + Number(log.valor_total || 0), 0),
    unresolvedFailures: Array.from(latestByBudget.values())
      .filter((log) => !log.success)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
  };
}

export function summarizeSyncRuns(runs: SyncRun[], now: Date): SyncSummary {
  const ordered = [...runs].sort((a, b) =>
    new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );
  const stalledBefore = now.getTime() - 45 * 60 * 1000;
  return {
    latestIncremental: ordered.find((run) => run.run_type === 'incremental') || null,
    latestSuccessfulFull: ordered.find((run) =>
      run.run_type === 'full' && run.status === 'success' && Boolean(run.finished_at),
    ) || null,
    stalledIncrementals: ordered.filter((run) =>
      run.run_type === 'incremental' &&
      run.status === 'running' &&
      new Date(run.started_at).getTime() < stalledBefore,
    ),
  };
}

function isBusinessActivity(log: SystemLog): boolean {
  const action = log.action.trim().toLocaleLowerCase('pt-BR');
  if (action.startsWith('acessou ')) return false;
  return !['auth', 'navigation', 'dashboard', 'admin'].includes(log.module);
}

export async function getCloudOperationsDashboard(
  now = new Date(),
): Promise<CloudOperationsDashboard> {
  const todayStart = localDayStart(now);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6);
  const monthStart = new Date(todayStart);
  monthStart.setDate(monthStart.getDate() - 29);

  const [
    weekSeparationsResult,
    recentSeparationsResult,
    returnsResult,
    comprasResult,
    trackerResult,
    generationResult,
    partialOperationsResult,
    partialBatchesResult,
    boxesResult,
    toolboxesResult,
    syncRunsResult,
    activityResult,
  ] = await Promise.all([
    supabase
      .from('separations')
      .select('id, order_code, client_name, items_total, items_confirmed, concluded_at, operator_name, order_type, invalidated, invalidated_at, invalidated_reason, created_at, equipment_name, items, observations, order_id, started_at, status_id, status_name, target_status_id, target_status_name, technician_gc_id, technician_name, total_value, user_id, client_id')
      .eq('invalidated', false)
      .gte('concluded_at', weekStart.toISOString())
      .order('concluded_at', { ascending: false }),
    supabase
      .from('separations')
      .select('*')
      .eq('invalidated', false)
      .order('concluded_at', { ascending: false })
      .limit(8),
    supabase
      .from('separations')
      .select('id', { count: 'exact', head: true })
      .eq('invalidated', true)
      .gte('invalidated_at', monthStart.toISOString()),
    supabase
      .from('compras_snapshots')
      .select('*')
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('purchase_tracker_snapshots')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('os_generation_logs')
      .select('*')
      .gte('created_at', weekStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('partial_writeoff_operations')
      .select('status')
      .neq('status', 'completed'),
    supabase
      .from('partial_writeoff_batches')
      .select('status')
      .eq('status', 'awaiting_checkout'),
    supabase
      .from('boxes')
      .select('status, verified, needs_replenish')
      .eq('status', 'active'),
    supabase
      .from('toolboxes')
      .select('status, technician_gc_id')
      .eq('status', 'active'),
    supabase
      .from('sync_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(60),
    supabase
      .from('system_logs')
      .select('*')
      .gte('created_at', weekStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(150),
  ]);

  assertResult(weekSeparationsResult.error, 'Separações da semana');
  assertResult(recentSeparationsResult.error, 'Separações recentes');
  assertResult(returnsResult.error, 'Devoluções');
  assertResult(comprasResult.error, 'Compras');
  assertResult(trackerResult.error, 'Acompanhamento de compras');
  assertResult(generationResult.error, 'Gerações');
  assertResult(partialOperationsResult.error, 'Baixa parcial');
  assertResult(partialBatchesResult.error, 'Lotes de baixa parcial');
  assertResult(boxesResult.error, 'Caixas');
  assertResult(toolboxesResult.error, 'Maletas');
  assertResult(syncRunsResult.error, 'Sincronização de produtos');
  assertResult(activityResult.error, 'Atividade operacional');

  const weekSeparations = (weekSeparationsResult.data || []) as Separation[];
  const todaySeparations = weekSeparations.filter(
    (row) => new Date(row.concluded_at) >= todayStart,
  );
  const generations = summarizeGenerationLogs(
    (generationResult.data || []) as GenerationLog[],
    todayStart,
  );
  const sync = summarizeSyncRuns((syncRunsResult.data || []) as SyncRun[], now);
  const activeOperations = partialOperationsResult.data || [];
  const boxes = boxesResult.data || [];
  const toolboxes = toolboxesResult.data || [];
  const activity = ((activityResult.data || []) as SystemLog[])
    .filter(isBusinessActivity)
    .slice(0, 10);
  const compras = comprasResult.data;
  const tracker = trackerResult.data;

  return {
    separations: {
      today: todaySeparations.length,
      week: weekSeparations.length,
      weekItems: weekSeparations.reduce((sum, row) => sum + row.items_confirmed, 0),
      returns30d: returnsResult.count || 0,
      recent: (recentSeparationsResult.data || []) as Separation[],
    },
    purchases: compras ? {
      shortageProducts: compras.total_produtos_sem_estoque,
      budgets: compras.total_orcamentos,
      estimatedValue: Number(compras.estimativa_total || 0),
      coveredItems: compras.total_itens_cobertos_pedido,
      healthyProducts: compras.total_produtos_ok,
      scannedAt: compras.created_at,
    } : null,
    purchaseTracker: tracker ? {
      status: tracker.status,
      errorMessage: tracker.error_message,
      critical: tracker.crit_count,
      overdue: tracker.arrival_overdue_count,
      warning: tracker.warn_count,
      total: tracker.total,
      scannedAt: tracker.created_at,
    } : null,
    generations,
    partialWriteoff: {
      active: activeOperations.length,
      awaitingBalance: activeOperations.filter((row) => row.status === 'awaiting_balance').length,
      reconciliationRequired: activeOperations.filter((row) => row.status === 'reconciliation_required').length,
      awaitingCheckoutBatches: partialBatchesResult.data?.length || 0,
    },
    assets: {
      activeBoxes: boxes.length,
      boxesPendingConference: boxes.filter((row) => !row.verified).length,
      activeToolboxes: toolboxes.length,
      unassignedToolboxes: toolboxes.filter((row) => !row.technician_gc_id).length,
    },
    sync,
    gcStatusChangesWeek: (activityResult.data || []).filter(
      (row) => row.module === 'separations' && row.action === 'gc_status_change',
    ).length,
    activity,
    refreshedAt: now.toISOString(),
  };
}

export function summarizeIntegrationOperations(
  orders: GCOrdemServico[],
  linkedTasks: AuvoAgendaTask[],
  todayTasks: AuvoAgendaTask[],
  selectedDate: string,
): IntegrationOperationsDashboard {
  const executionTaskIds = Array.from(new Set(orders.flatMap(getExecutionTaskIds)));
  const linkedById = new Map(linkedTasks.map((task) => [task.task_id, task]));
  const resolved = executionTaskIds
    .map((taskId) => linkedById.get(taskId))
    .filter((task): task is AuvoAgendaTask => Boolean(task));

  return {
    openOrders: orders.length,
    executionTaskRefs: executionTaskIds.length,
    resolvedExecutionTasks: resolved.length,
    ordersWithoutExecutionTask: orders.filter((order) => getExecutionTaskIds(order).length === 0).length,
    tasksWithoutDate: resolved.filter((task) => !task.task_date || task.task_date.startsWith('0001-01-01')).length,
    tasksWithoutTechnician: resolved.filter((task) => !task.technician_id).length,
    linkedTasksScheduledToday: resolved.filter((task) => task.task_date?.slice(0, 10) === selectedDate).length,
    agendaToday: todayTasks.length,
    agendaOpen: todayTasks.filter((task) => task.status === 1).length,
    agendaInProgress: todayTasks.filter((task) => [2, 3, 4, 7].includes(task.status || 0)).length,
    agendaFinished: todayTasks.filter((task) => task.status === 5).length,
    agendaUnassigned: todayTasks.filter((task) => !task.technician_id).length,
    refreshedAt: new Date().toISOString(),
  };
}

export async function getIntegrationOperationsDashboard(
  selectedDate = localDateKey(new Date()),
): Promise<IntegrationOperationsDashboard> {
  const [orders, todayTasks] = await Promise.all([
    getOpenAgendaOrders(),
    getAuvoAgenda(selectedDate),
  ]);
  const executionTaskIds = Array.from(new Set(orders.flatMap(getExecutionTaskIds)));
  const linkedTasks = await getAuvoTasksByIds(executionTaskIds);
  return summarizeIntegrationOperations(orders, linkedTasks, todayTasks, selectedDate);
}
