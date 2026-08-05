import { supabase } from '@/integrations/supabase/client';

export interface AuvoAgendaTask {
  task_id: string;
  task_date: string | null;
  task_end_date: string | null;
  task_type: number | null;
  task_type_name: string | null;
  status: number | null;
  status_description: string | null;
  checkin_date: string | null;
  technician_id: number | null;
  technician_name: string | null;
  customer_id: number | null;
  customer_name: string | null;
  address: string;
  orientation: string;
}

export interface AuvoAgendaUser {
  user_id: number;
  name: string;
  login: string;
}

export const AUVO_STATUS_LABEL: Record<number, string> = {
  1: 'Aberta',
  2: 'Em deslocamento',
  3: 'Check-in',
  4: 'Check-out',
  5: 'Finalizada',
  6: 'Cancelada',
  7: 'Pausada',
};

export function auvoStatusLabel(status: number | null): string {
  if (status == null) return 'Sem status';
  return AUVO_STATUS_LABEL[status] ?? `Status ${status}`;
}

function assertFunctionResult(data: unknown, fallback: string): Record<string, unknown> {
  if (!data || typeof data !== 'object') throw new Error(fallback);
  const result = data as Record<string, unknown>;
  if (result.error) throw new Error(String(result.error));
  return result;
}

export async function getAuvoAgenda(startDate: string, endDate?: string): Promise<AuvoAgendaTask[]> {
  const { data, error } = await supabase.functions.invoke('auvo-agenda', {
    body: { start_date: startDate, end_date: endDate || startDate },
  });

  if (error) {
    console.error('Error fetching Auvo agenda:', error);
    throw new Error('Não foi possível carregar a agenda do Auvo');
  }
  const result = assertFunctionResult(data, 'Resposta vazia do Auvo');
  return (Array.isArray(result.items) ? result.items : []) as AuvoAgendaTask[];
}

export async function getAuvoTasksByIds(taskIds: string[]): Promise<AuvoAgendaTask[]> {
  const unique = Array.from(new Set(taskIds.filter((id) => /^\d+$/.test(id))));
  if (unique.length === 0) return [];

  const { data, error } = await supabase.functions.invoke('auvo-agenda', {
    body: { action: 'tasks-by-id', task_ids: unique },
  });
  if (error) throw new Error(error.message || 'Não foi possível consultar as tarefas de execução');
  const result = assertFunctionResult(data, 'Resposta vazia do Auvo');
  return (Array.isArray(result.items) ? result.items : []) as AuvoAgendaTask[];
}

export async function getAuvoAgendaUsers(): Promise<AuvoAgendaUser[]> {
  const { data, error } = await supabase.functions.invoke('auvo-agenda', {
    body: { action: 'list-users' },
  });
  if (error) throw new Error(error.message || 'Não foi possível carregar os técnicos do Auvo');
  const result = assertFunctionResult(data, 'Resposta vazia do Auvo');
  return (Array.isArray(result.items) ? result.items : []) as AuvoAgendaUser[];
}

export async function updateAuvoAgendaTask(input: {
  taskId: string;
  scheduledAt: string;
  technicianId: number;
}): Promise<AuvoAgendaTask> {
  const { data, error } = await supabase.functions.invoke('auvo-agenda', {
    body: {
      action: 'update-task',
      task_id: input.taskId,
      scheduled_at: input.scheduledAt,
      technician_id: input.technicianId,
    },
  });
  if (error) throw new Error(error.message || 'Não foi possível atualizar a tarefa no Auvo');
  const result = assertFunctionResult(data, 'Resposta vazia do Auvo');
  if (!result.item || typeof result.item !== 'object') throw new Error('O Auvo não confirmou a tarefa atualizada');
  return result.item as AuvoAgendaTask;
}

/** Normalizes a name for fuzzy matching (accents, case, extra spaces). */
export function normalizeName(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Finds the local technician that best matches the Auvo execution technician name. */
export function matchTechnician<T extends { name: string }>(
  auvoName: string | null,
  technicians: T[],
): T | null {
  if (!auvoName) return null;
  const target = normalizeName(auvoName);
  if (!target) return null;

  const exact = technicians.find((t) => normalizeName(t.name) === target);
  if (exact) return exact;

  const contains = technicians.find((t) => {
    const n = normalizeName(t.name);
    return n.includes(target) || target.includes(n);
  });
  if (contains) return contains;

  // First + last name token match
  const targetTokens = target.split(' ').filter((t) => t.length > 2);
  if (targetTokens.length === 0) return null;
  return (
    technicians.find((t) => {
      const tokens = normalizeName(t.name).split(' ').filter((x) => x.length > 2);
      if (tokens.length === 0) return false;
      const shared = tokens.filter((x) => targetTokens.includes(x));
      return shared.length >= Math.min(2, Math.min(tokens.length, targetTokens.length));
    }) || null
  );
}
