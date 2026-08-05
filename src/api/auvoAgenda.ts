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
  customer_id_gc: string | null;
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

/**
 * Busca tarefas do Auvo pelos IDs extraídos do campo "TAREFA EXECUÇÃO" (atributo 73344)
 * da OS no GestãoClick — mesmo vínculo usado no Auvo GC Sync.
 */
export async function getAuvoTasksByIds(taskIds: string[]): Promise<AuvoAgendaTask[]> {
  if (taskIds.length === 0) return [];
  const { data, error } = await supabase.functions.invoke('auvo-agenda', {
    body: { task_ids: taskIds },
  });

  if (error) {
    console.error('Error fetching Auvo tasks by id:', error);
    throw new Error('Não foi possível carregar as tarefas do Auvo');
  }
  if ((data as any)?.error) {
    throw new Error((data as any).error);
  }
  return ((data as any)?.items || []) as AuvoAgendaTask[];
}

/** IDs de atributos personalizados da OS no GestãoClick. */
export const GC_ATRIBUTO_TAREFA_EXEC = '73344';
export const GC_ATRIBUTO_TAREFA_OS = '73343';

/** Lê um atributo personalizado da OS do GC (formato aninhado ou plano). */
export function extractGcAtributo(
  atributos: unknown[] | undefined,
  atributoId: string,
  nameHints: string[] = [],
): string | null {
  if (!Array.isArray(atributos)) return null;
  for (const raw of atributos) {
    const nested: any = (raw as any)?.atributo || raw;
    if (!nested) continue;
    const id = String(nested.atributo_id ?? nested.id ?? '');
    const nome = normalizeName(String(nested.nome ?? nested.atributo ?? ''));
    const matchesId = id === atributoId;
    const matchesName = nameHints.length > 0 && nameHints.some((h) => nome.includes(normalizeName(h)));
    if (matchesId || matchesName) {
      const value = String(nested.conteudo ?? nested.valor ?? '').trim();
      if (value) return value;
    }
  }
  return null;
}

/** Extrai os IDs de tarefa Auvo (o campo pode conter múltiplos separados por / , ;). */
export function parseAuvoTaskIds(value: string | null): string[] {
  if (!value) return [];
  return [...new Set((value.match(/\d{4,}/g) || []).map(String))];
}

/** Retorna o(s) ID(s) da TAREFA DE EXECUÇÃO gravada na OS do GC. */
export function getExecTaskIdsFromOS(atributos: unknown[] | undefined): string[] {
  const exec = parseAuvoTaskIds(
    extractGcAtributo(atributos, GC_ATRIBUTO_TAREFA_EXEC, ['tarefa execucao', 'execução', 'execucao']),
  );
  if (exec.length > 0) return exec;
  // Fallback: OS criada e executada na mesma tarefa (73343)
  return parseAuvoTaskIds(extractGcAtributo(atributos, GC_ATRIBUTO_TAREFA_OS, ['tarefa os']));
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
