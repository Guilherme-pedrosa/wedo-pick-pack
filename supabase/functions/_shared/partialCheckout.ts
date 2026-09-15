import { isCancelledStatus, isExecutedStatus, normalizedStatus } from './partialExecution.ts';
import { assertStatusOnlyChange } from './partialConsolidation.ts';

type Document = Record<string, any>;
/** PEDIDO EM CONFERENCIA, a mesma situação usada por generate-os para uma OS nova. */
export const NORMAL_OS_CREATION_STATUS_ID = '7063581';
export interface PartialCheckoutPolicy {
  type: 'os' | 'venda';
  flowMode?: 'partial_execution' | 'reservation';
  waitingStatusId: string;
  stockStatusId: string;
  cancelStatusId: string;
  conclusionStatusId?: string;
}
export interface PartialCheckoutConfirmation {
  statusId: string;
  statusName: string;
}
export function partialCheckoutConfirmation(document: Document): PartialCheckoutConfirmation {
  return { statusId: String(document.situacao_id), statusName: String(document.nome_situacao || document.situacao_id) };
}

export function partialCheckoutAwaitingHandoff(document: Document, policy: PartialCheckoutPolicy): boolean {
  return policy.type === 'os' &&
    [NORMAL_OS_CREATION_STATUS_ID, policy.waitingStatusId, policy.stockStatusId].filter(Boolean).includes(String(document.situacao_id)) &&
    !isExecutedStatus(document.nome_situacao) && !/RETIRAD|FATURAD/.test(normalizedStatus(document.nome_situacao));
}

export function validatePartialCheckoutDocument(document: Document, policy: PartialCheckoutPolicy): void {
  if (!document?.id || !document.situacao_id || !['0', '1'].includes(String(document.situacao_estoque))) {
    throw new Error('Não foi possível confirmar a situação e o estoque do documento no GestãoClick.');
  }
  if (String(document.situacao_id) === policy.cancelStatusId || isCancelledStatus(document.nome_situacao)) {
    throw new Error('O documento foi cancelado no GestãoClick. A confirmação foi interrompida.');
  }
}

/** Só conferência e reserva podem avançar pelo Checkout. Retirada/execução/faturamento são preservados. */
export async function partialCheckoutTarget(
  document: Document, policy: PartialCheckoutPolicy, getStatuses: () => Promise<Document[]>,
): Promise<string> {
  validatePartialCheckoutDocument(document, policy);
  const current = String(document.situacao_id);
  const stockApplied = String(document.situacao_estoque) === '1';
  if (policy.type !== 'os') {
    if (stockApplied) return current;
    if (!policy.stockStatusId) throw new Error('PARTIAL_STATUS_NOT_CONFIGURED');
    return policy.stockStatusId;
  }
  if (!partialCheckoutAwaitingHandoff(document, policy)) {
    if (stockApplied) return current;
    throw new Error('A OS mudou de situação. Atualize a conferência antes de continuar.');
  }
  const target = String(policy.conclusionStatusId || '7063705').trim();
  const statuses = await getStatuses();
  const status = statuses.find(value => String(value.id) === target);
  const name = normalizedStatus(status?.nome);
  if (!status || target === policy.stockStatusId || target === policy.cancelStatusId ||
      !/AGUARDANDO EXECUCAO/.test(name) || isExecutedStatus(name) || isCancelledStatus(name)) {
    throw new Error('Configure a conclusão de OS para uma situação de aguardando execução. O Checkout não executa o serviço.');
  }
  return target;
}

/** Uma única troca de situação, com releitura antes do PUT e recuperação de resposta ambígua. */
export async function applyPartialCheckoutStatus(options: {
  policy: PartialCheckoutPolicy;
  read: () => Promise<Document>;
  getStatuses: () => Promise<Document[]>;
  validate: (document: Document) => void;
  prepare: (document: Document) => Document;
  put: (document: Document, target: string) => Promise<unknown>;
  alreadyConfirmed: boolean;
}): Promise<Document> {
  const current = await options.read();
  options.validate(current);
  validatePartialCheckoutDocument(current, options.policy);
  if (options.alreadyConfirmed && String(current.situacao_estoque) !== '1') {
    throw new Error('O lote já foi confirmado, mas o estoque mudou no GC. Audite o documento antes de continuar.');
  }
  const target = await partialCheckoutTarget(current, options.policy, options.getStatuses);
  if (target === String(current.situacao_id)) {
    if (String(current.situacao_estoque) !== '1') throw new Error('O GestãoClick não confirmou a baixa de estoque.');
    return current;
  }
  const expected = options.prepare(current);
  let putError: unknown;
  try { await options.put(expected, target); } catch (error) { putError = error; }
  const latest = await options.read();
  options.validate(latest);
  validatePartialCheckoutDocument(latest, options.policy);
  assertStatusOnlyChange(expected, latest);
  if (String(latest.situacao_estoque) !== '1') throw putError || new Error('O GestãoClick não confirmou a baixa de estoque.');
  // Outro operador pode ter avançado a OS após o PUT. Nunca a rebaixe em uma retomada.
  if (await partialCheckoutTarget(latest, options.policy, options.getStatuses) !== String(latest.situacao_id)) {
    throw putError || new Error('O estoque foi baixado, mas a OS ainda não foi encaminhada para execução. Retome a confirmação.');
  }
  return latest;
}
