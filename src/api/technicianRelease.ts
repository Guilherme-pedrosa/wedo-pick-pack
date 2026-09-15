import { SITUATION_IDS_BY_SCOPE } from './situationScopes';
import {
  OS_CHECKED_AWAITING_EXECUTION_STATUS_ID,
  OS_CHECKED_AWAITING_EXECUTION_STATUS_NAME,
  TECHNICIAN_WITHDRAWAL_STATUS_ID,
} from '../../supabase/functions/_shared/osRite';

const OS_SITUATION_IDS: ReadonlySet<string> = new Set<string>(SITUATION_IDS_BY_SCOPE.os);

export interface TechnicianReleaseStatus {
  id: string;
  name: string;
}

/**
 * Situação para a qual a OS volta quando o técnico é desvinculado da separação.
 *
 * Separações antigas gravaram como alvo do Checkout marcadores internos ("partial:<id>") ou a
 * situação de estoque da baixa parcial (7347355, que é situação de VENDA). Devolver a OS para
 * isso a tira do rito e a esconde do Checkout e do Controle OS. Para OS, só uma situação do
 * próprio catálogo de OS (e que não seja a de retirada) é reaproveitada; qualquer outra coisa
 * cai em PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO, o mesmo destino da devolução por agenda.
 */
export function technicianReleaseStatus(separation: {
  order_type: string;
  target_status_id: string | null | undefined;
  target_status_name?: string | null;
}): TechnicianReleaseStatus {
  const target = String(separation.target_status_id || '').trim();
  const name = String(separation.target_status_name || '').trim();
  if (separation.order_type !== 'os') return { id: target, name };
  if (OS_SITUATION_IDS.has(target) && target !== TECHNICIAN_WITHDRAWAL_STATUS_ID) return { id: target, name };
  return { id: OS_CHECKED_AWAITING_EXECUTION_STATUS_ID, name: OS_CHECKED_AWAITING_EXECUTION_STATUS_NAME };
}
