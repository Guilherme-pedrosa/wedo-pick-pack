import { supabase } from '@/integrations/supabase/client';

export interface AuvoAgendaTask {
  task_id: string;
  task_date: string | null;
  task_type: number | null;
  task_type_name: string | null;
  status: number | null;
  checkin_date: string | null;
  technician_id: number | null;
  technician_name: string | null;
  customer_id: number | null;
  customer_name: string | null;
  address: string;
  orientation: string;
  orcamento_code: string | null;
  os_code: string | null;
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

export async function getAuvoAgenda(startDate: string, endDate?: string): Promise<AuvoAgendaTask[]> {
  const { data, error } = await supabase.functions.invoke('auvo-agenda', {
    body: { start_date: startDate, end_date: endDate || startDate },
  });

  if (error) {
    console.error('Error fetching Auvo agenda:', error);
    throw new Error('Não foi possível carregar a agenda do Auvo');
  }
  if ((data as any)?.error) {
    throw new Error((data as any).error);
  }
  return ((data as any)?.items || []) as AuvoAgendaTask[];
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
