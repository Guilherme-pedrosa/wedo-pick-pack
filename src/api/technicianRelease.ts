import { SITUATION_IDS_BY_SCOPE } from './situationScopes';
import {
  OS_CHECKED_AWAITING_EXECUTION_STATUS_ID,
  OS_CHECKED_AWAITING_EXECUTION_STATUS_NAME,
  TECHNICIAN_WITHDRAWAL_STATUS_ID,
} from '../../supabase/functions/_shared/osRite';

const OS_SITUATION_IDS: ReadonlySet<string> = new Set<string>(SITUATION_IDS_BY_SCOPE.os);

/** Situações de OS "aguardando" conhecidas pelo id (ver src/api/agendaControl.ts). */
const OS_WAITING_STATUS_IDS: ReadonlySet<string> = new Set<string>([
  OS_CHECKED_AWAITING_EXECUTION_STATUS_ID, // PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO
  '7213493', // SERVIÇO AGUARDANDO EXECUÇÃO
  '7748831', // AGUARDANDO RETIRADA
]);

export interface TechnicianReleaseStatus {
  id: string;
  name: string;
}

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

/**
 * Situação para a qual a OS volta quando o técnico é desvinculado da separação.
 *
 * Separações antigas gravaram como alvo do Checkout marcadores internos ("partial:<id>"), a
 * situação de estoque da baixa parcial (7347355, que é situação de VENDA) ou situações que não
 * são "aguardando" (EXECUTADO, EM ROTA, RETIRADA PELO TÉCNICO). Devolver a OS para isso a tira
 * do rito, esconde do Checkout/Controle OS ou marca como executada sem técnico. Para OS, só uma
 * situação do catálogo de OS que seja de espera é reaproveitada; qualquer outra coisa cai em
 * PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO, o mesmo destino da devolução por agenda.
 */
export function technicianReleaseStatus(separation: {
  order_type: string;
  target_status_id: string | null | undefined;
  target_status_name?: string | null;
}): TechnicianReleaseStatus {
  const target = String(separation.target_status_id || '').trim();
  const name = String(separation.target_status_name || '').trim();
  if (separation.order_type !== 'os') return { id: target, name };
  const waiting = OS_WAITING_STATUS_IDS.has(target) || /AGUARDANDO/.test(normalized(name));
  if (OS_SITUATION_IDS.has(target) && target !== TECHNICIAN_WITHDRAWAL_STATUS_ID && waiting) {
    return { id: target, name };
  }
  return { id: OS_CHECKED_AWAITING_EXECUTION_STATUS_ID, name: OS_CHECKED_AWAITING_EXECUTION_STATUS_NAME };
}
