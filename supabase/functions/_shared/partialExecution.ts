export type GcRecord = Record<string, any>;

export interface ConsolidationOperation {
  flow_mode?: 'partial_execution' | 'reservation';
  id: string; budget_id: string; budget_code: string; status: string;
  budget_snapshot: GcRecord;
  definitive_document_id: string | null; definitive_document_code: string | null;
  consolidation_stage?: string | null; execution_documents?: ExecutionDocument[];
  batches: Array<{ id: string; confirmed_at: string | null; auxiliary_document_id: string | null; auvo_task_id: string | null; auvo_task_requested?: boolean | null }>;
}

export function normalizedStatus(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
}

export function isExecutedStatus(value: unknown): boolean {
  const status = normalizedStatus(value);
  // Situações históricas do GC que também significam serviço já executado.
  // Conferência, retirada e espera por execução continuam comprometendo estoque.
  return /^EXECUTAD[AO]\b/.test(status) || [
    'CHAMADO FECHADO - FATURADO',
    'IMP CIGAM FATURADO TOTAL',
    'FINANCEIRO SEPARADO / BAIXA CIGAM',
  ].includes(status);
}

export function isCancelledStatus(value: unknown): boolean {
  return /^(?:PEDIDO )?CANCELAD[AO]\b/.test(normalizedStatus(value));
}

export interface ExecutionDocument {
  batchId: string;
  documentId: string;
  documentCode: string;
  statusId: string;
  statusName: string;
  executed: boolean;
  stockApplied: boolean;
}

/** A conferência/retirada não equivale à execução do serviço. */
export function executionDocument(batchId: string, document: GcRecord): ExecutionDocument {
  if (!document?.id || !document.nome_situacao || !['0', '1'].includes(String(document.situacao_estoque))) {
    throw new Error('Não foi possível validar execução e estoque da OS auxiliar.');
  }
  return {
    batchId, documentId: String(document.id), documentCode: String(document.codigo || document.id),
    statusId: String(document.situacao_id), statusName: String(document.nome_situacao),
    executed: isExecutedStatus(document.nome_situacao), stockApplied: String(document.situacao_estoque) === '1',
  };
}

export function requireExecutedDocuments(documents: ExecutionDocument[]): void {
  if (!documents.length) throw new Error('A operação não tem OS parciais confirmadas para consolidar.');
  const pending = documents.filter(d => !d.executed || !d.stockApplied);
  if (pending.length) {
    throw new Error(`Aguardando execução/baixa: ${pending.map(d => `OS #${d.documentCode} (${d.statusName})`).join('; ')}.`);
  }
}

export function consolidationReference(budgetCode: string, definitiveCode: string): string {
  return `Baixa parcial do orçamento #${budgetCode} finalizada na OS #${definitiveCode}. Histórico e tarefas Auvo preservados e referenciados na OS definitiva.`;
}

export function appendUniqueNote(current: unknown, note: string): string {
  const text = String(current || '');
  return text.includes(note) ? text : [text, note].filter(Boolean).join('\n');
}
