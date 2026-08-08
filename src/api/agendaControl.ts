import type { GCOrdemServico } from '@/api/types';
import type { AuvoAgendaTask } from '@/api/auvoAgenda';
import type { SeparationRecord, SeparationItemSnapshot } from '@/api/separations';

export interface AgendaOsRow {
  os: GCOrdemServico;
  taskIds: string[];
  task: AuvoAgendaTask | null;
  separation: SeparationRecord | null;
  bucket: AgendaBucket;
  items: SeparationItemSnapshot[];
}

export const GC_EXECUTION_TASK_ATTRIBUTE_ID = '73344';
export const GC_REPAIR_LOCATION_ATTRIBUTE_ID = '68658';

/** Mesmo recorte de processo da tela Controle OS, carregado pelo Pick & Pack. */
export const OPEN_AGENDA_OS_SITUATIONS = [
  { id: '7063579', label: 'AGUARDANDO COMPRA DE PEÇAS' },
  { id: '7063580', label: 'AGUARDANDO CHEGADA DE PEÇAS' },
  { id: '7659440', label: 'AGUARDANDO FABRICAÇÃO' },
  { id: '7063581', label: 'PEDIDO EM CONFERÊNCIA' },
  { id: '7063705', label: 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO' },
  { id: '7213493', label: 'SERVIÇO AGUARDANDO EXECUÇÃO' },
  { id: '7684665', label: 'RETIRADA PELO TÉCNICO' },
  { id: '7748831', label: 'AGUARDANDO RETIRADA' },
  { id: '8219136', label: 'EM ROTA' },
  { id: '7116099', label: 'EXECUTADO – AG. NEGOCIAÇÃO' },
] as const;

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
  return parseTaskIds(getOsAttributeValue(os, GC_EXECUTION_TASK_ATTRIBUTE_ID));
}

export function getOsAttributeValue(
  os: Pick<GCOrdemServico, 'atributos'>,
  attributeId: string,
): string {
  const attribute = attributeParts(os.atributos).find((entry) =>
    String(entry.atributo_id ?? entry.id ?? '').trim() === attributeId,
  );
  return String(attribute?.conteudo ?? attribute?.valor ?? '').trim();
}

export function normalizeFilterText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
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
