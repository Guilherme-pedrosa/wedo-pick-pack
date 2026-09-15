/**
 * Rito de uma OS no GestãoClick — uma sequência só, para OS gerada pelo generate-os e para as
 * OS auxiliares e definitiva da baixa parcial (regra do Guilherme, 15/09/2026: "quando cria uma
 * OS, tem que ficar a mesma situação do que a geração de qualquer OS"):
 *
 *   PEDIDO EM CONFERÊNCIA (7063581) → Checkout confere → PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO
 *   (7063705) → RETIRADA PELO TÉCNICO (7684665) → executada.
 *
 * Nunca uma situação de venda/reserva (os_stock_status_id 7347355 é situação de VENDA) nem uma
 * situação "de baixa parcial". Os ids são os mesmos de generate-os (GENERATION_RULES.os) e do
 * catálogo de OS em src/api/situationScopes.ts.
 */
export const NORMAL_OS_CREATION_STATUS_ID = '7063581';
export const OS_CHECKED_AWAITING_EXECUTION_STATUS_ID = '7063705';
export const OS_CHECKED_AWAITING_EXECUTION_STATUS_NAME = 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO';
export const TECHNICIAN_WITHDRAWAL_STATUS_ID = '7684665';

/**
 * Situação com que o documento auxiliar da baixa parcial nasce no GC. OS segue o rito fixo,
 * independentemente de partial_writeoff_settings e de flow_mode; venda usa a configuração.
 */
export function partialAuxiliaryCreationStatus(
  documentType: string,
  settings: { venda_waiting_status_id?: string | null } | null | undefined,
): string {
  if (documentType === 'os') return NORMAL_OS_CREATION_STATUS_ID;
  const venda = String(settings?.venda_waiting_status_id || '').trim();
  if (!venda) throw new Error('PARTIAL_STATUS_NOT_CONFIGURED');
  return venda;
}
