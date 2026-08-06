import { describe, expect, it } from 'vitest';
import type { AuvoAgendaTask } from '@/api/auvoAgenda';
import type { GCOrdemServico } from '@/api/types';
import {
  summarizeGenerationLogs,
  summarizeIntegrationOperations,
  summarizeSyncRuns,
} from '@/api/operationsDashboard';

type GenerationLog = Parameters<typeof summarizeGenerationLogs>[0][number];
type SyncRun = Parameters<typeof summarizeSyncRuns>[0][number];

function generation(overrides: Partial<GenerationLog>): GenerationLog {
  return {
    id: 'log',
    auvo_task_id: null,
    created_at: '2026-08-06T12:00:00.000Z',
    equipamento: null,
    error_message: null,
    nome_cliente: 'Cliente',
    operator_id: 'operator',
    operator_name: 'Operador',
    orcamento_codigo: '100',
    orcamento_id: 'budget-100',
    os_codigo: null,
    os_id: null,
    success: true,
    valor_total: 100,
    warnings: null,
    ...overrides,
  };
}

function syncRun(overrides: Partial<SyncRun>): SyncRun {
  return {
    id: 'run',
    errors_count: 0,
    fetched_count: 0,
    finished_at: null,
    notes: null,
    run_type: 'incremental',
    started_at: '2026-08-06T10:00:00.000Z',
    status: 'running',
    total_count: 0,
    upsert_count: 0,
    ...overrides,
  };
}

function task(overrides: Partial<AuvoAgendaTask>): AuvoAgendaTask {
  return {
    task_id: '10',
    task_date: '2026-08-06T09:00:00',
    task_end_date: null,
    task_type: null,
    task_type_name: null,
    status: 1,
    status_description: 'Aberta',
    checkin_date: null,
    technician_id: 1,
    technician_name: 'Técnico',
    customer_id: null,
    customer_name: 'Cliente',
    address: '',
    orientation: '',
    ...overrides,
  };
}

function order(taskIds: string): GCOrdemServico {
  return {
    id: crypto.randomUUID(),
    codigo: '100',
    atributos: [{ atributo: { id: '73344', conteudo: taskIds } }],
  } as unknown as GCOrdemServico;
}

describe('operations dashboard summaries', () => {
  it('keeps only failures that do not have a later success for the same budget', () => {
    const summary = summarizeGenerationLogs([
      generation({ id: 'old-failure', success: false, created_at: '2026-08-05T10:00:00.000Z' }),
      generation({ id: 'new-success', success: true, created_at: '2026-08-06T11:00:00.000Z' }),
      generation({ id: 'pending-failure', orcamento_id: 'budget-200', orcamento_codigo: '200', success: false }),
    ], new Date('2026-08-06T00:00:00.000Z'));

    expect(summary.todaySuccess).toBe(1);
    expect(summary.weekSuccess).toBe(1);
    expect(summary.unresolvedFailures.map((log) => log.id)).toEqual(['pending-failure']);
  });

  it('flags only old incremental runs as stalled and preserves the last successful full run', () => {
    const summary = summarizeSyncRuns([
      syncRun({ id: 'stalled', started_at: '2026-08-06T10:00:00.000Z' }),
      syncRun({ id: 'recent', started_at: '2026-08-06T11:40:00.000Z' }),
      syncRun({ id: 'full', run_type: 'full', status: 'success', started_at: '2026-08-06T09:00:00.000Z', finished_at: '2026-08-06T09:01:00.000Z' }),
    ], new Date('2026-08-06T12:00:00.000Z'));

    expect(summary.stalledIncrementals.map((run) => run.id)).toEqual(['stalled']);
    expect(summary.latestIncremental?.id).toBe('recent');
    expect(summary.latestSuccessfulFull?.id).toBe('full');
  });

  it('crosses open GC orders with Auvo schedule and assignee gaps', () => {
    const summary = summarizeIntegrationOperations(
      [order('10'), order('20'), order('')],
      [task({ task_id: '10' }), task({ task_id: '20', task_date: null, technician_id: null })],
      [task({ task_id: '10', status: 1 }), task({ task_id: '30', status: 3 }), task({ task_id: '40', status: 5 })],
      '2026-08-06',
    );

    expect(summary.openOrders).toBe(3);
    expect(summary.ordersWithoutExecutionTask).toBe(1);
    expect(summary.tasksWithoutDate).toBe(1);
    expect(summary.tasksWithoutTechnician).toBe(1);
    expect(summary.agendaOpen).toBe(1);
    expect(summary.agendaInProgress).toBe(1);
    expect(summary.agendaFinished).toBe(1);
  });
});
