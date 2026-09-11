export const DEFAULT_CREATE_PARTIAL_AUVO_TASK = true;

export interface PartialAuvoChoice {
  auvo_task_requested?: boolean | null;
  auvo_task_id?: string | null;
  status?: string;
  auxiliary_document_id?: string | null;
}

export function canRequestPartialAuvoTask(batch: PartialAuvoChoice, operation: { status?: string; definitive_document_id?: string | null }): boolean {
  return !batch.auvo_task_id && !!batch.auxiliary_document_id
    && ['awaiting_checkout', 'confirmed'].includes(batch.status || '')
    && !['completed', 'cancelled', 'consolidating'].includes(operation.status || '')
    && !operation.definitive_document_id;
}

/** NULL identifies historical lots, whose previous behavior is preserved. */
export function wantsPartialAuvoTask(batch: PartialAuvoChoice, flowMode?: string): boolean {
  return batch.auvo_task_requested ?? flowMode !== 'reservation';
}

export function assertRequestedAuvoTasksLinked(batches: PartialAuvoChoice[]): void {
  if (batches.some(b => !['cancelled', 'failed'].includes(b.status || '') && b.auvo_task_requested === true && !b.auvo_task_id)) {
    throw new Error('A tarefa Auvo solicitada para uma OS parcial ainda está pendente. Gere a tarefa no histórico antes de consolidar.');
  }
}
