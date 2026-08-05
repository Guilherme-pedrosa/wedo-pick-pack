import type { GCOrdemServico } from '@/api/types';

export const GC_EXECUTION_TASK_ATTRIBUTE_ID = '73344';

function attributeParts(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Record<string, unknown>;
      const nested = record.atributo;
      return nested && typeof nested === 'object'
        ? nested as Record<string, unknown>
        : record;
    })
    .filter((entry): entry is Record<string, unknown> => !!entry);
}

export function parseTaskIds(value: unknown): string[] {
  return Array.from(new Set(
    String(value ?? '')
      .split(/[/,;\s]+/)
      .map((id) => id.trim())
      .filter((id) => /^\d+$/.test(id)),
  ));
}

/** Only attribute 73344 is the execution visit that can be scheduled. */
export function getExecutionTaskIds(os: Pick<GCOrdemServico, 'atributos'>): string[] {
  const attribute = attributeParts(os.atributos).find((entry) =>
    String(entry.atributo_id ?? entry.id ?? '').trim() === GC_EXECUTION_TASK_ATTRIBUTE_ID,
  );

  return parseTaskIds(attribute?.conteudo ?? attribute?.valor ?? '');
}

export function datePart(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw.startsWith('0001-01-01')) return '';
  return raw.slice(0, 10);
}

export type AgendaBucket = 'scheduled-date' | 'available' | 'other-date' | 'no-task';

export function classifyAgendaRow(input: {
  taskId: string | null;
  taskDate: string | null;
  technicianId: number | null;
  selectedDate: string;
}): AgendaBucket {
  if (!input.taskId) return 'no-task';
  const scheduledDate = datePart(input.taskDate);
  if (!scheduledDate || !input.technicianId) return 'available';
  if (scheduledDate === input.selectedDate) return 'scheduled-date';
  return 'other-date';
}
