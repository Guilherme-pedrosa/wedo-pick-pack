import { getOS, updateOSStatus } from '@/api/gestaoclick';
import {
  linkTechnicianToSeparation,
  type SeparationItemSnapshot,
  type SeparationRecord,
} from '@/api/separations';
import { supabase } from '@/integrations/supabase/client';
import { logSystemAction } from '@/lib/systemLog';

const RETIRADA_TECNICO_STATUS_ID = '7684665';

export interface AssignmentTechnician {
  gc_id: string;
  name: string;
}

/**
 * Links the separation and its immutable item snapshot to a technician.
 * The GC status change remains part of the same business operation used by
 * the separation history screen.
 */
export async function assignSeparationToTechnician(input: {
  separation: SeparationRecord;
  technician: AssignmentTechnician;
  items: SeparationItemSnapshot[];
  auvoTaskId?: string | null;
}): Promise<void> {
  const { separation, technician, items, auvoTaskId } = input;
  if (separation.order_type !== 'os') {
    throw new Error('O agendamento aceita apenas separações de OS');
  }
  if (items.length === 0) {
    throw new Error('A separação não possui peças para vincular');
  }

  const { data: { user } } = await supabase.auth.getUser();
  let gcUsuarioId: string | undefined;
  let operatorName = separation.operator_name || 'Operador';
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('gc_usuario_id, name')
      .eq('id', user.id)
      .maybeSingle();
    gcUsuarioId = profile?.gc_usuario_id || undefined;
    if (profile?.name) operatorName = profile.name;
  }

  const previousTechnicianName = separation.technician_name;
  const previousTechnicianGcId = separation.technician_gc_id;
  const itemSummary = items
    .slice(0, 8)
    .map((item) => `${item.code || item.name} x${item.confirmed_quantity}`)
    .join(', ');
  const extraItems = Math.max(0, items.length - 8);
  const piecesQuantity = items.reduce((total, item) => total + Number(item.confirmed_quantity || item.expected_quantity || 0), 0);
  const gcNote = [
    `Técnico vinculado às peças separadas: ${technician.name} (ID ${technician.gc_id})`,
    auvoTaskId ? `Tarefa Auvo ${auvoTaskId}` : null,
    `Peças: ${itemSummary}${extraItems ? ` +${extraItems} item(ns)` : ''}`,
    `Status: RETIRADA PELO TÉCNICO`,
    `por ${operatorName}`,
  ].filter(Boolean).join(' | ');

  const order = await getOS(separation.order_id);
  await updateOSStatus(
    separation.order_id,
    order,
    RETIRADA_TECNICO_STATUS_ID,
    undefined,
    gcUsuarioId,
    gcNote,
  );

  const linked = await linkTechnicianToSeparation(
    separation.id,
    technician.gc_id,
    technician.name,
    items,
  );
  if (!linked) {
    throw new Error('O status mudou no GC, mas o vínculo das peças não foi salvo');
  }

  await logSystemAction({
    module: 'separations',
    action: 'vincular_tecnico',
    entityType: 'os',
    entityId: separation.order_id,
    entityName: `OS #${separation.order_code}`,
    details: {
      separation_id: separation.id,
      client_name: separation.client_name,
      operator_name: operatorName,
      technician_name: technician.name,
      technician_gc_id: technician.gc_id,
      previous_technician_name: previousTechnicianName || null,
      previous_technician_gc_id: previousTechnicianGcId || null,
      auvo_task_id: auvoTaskId || null,
      items_count: items.length,
      pieces_quantity: piecesQuantity,
      items,
      new_status: 'RETIRADA PELO TÉCNICO',
      new_status_id: RETIRADA_TECNICO_STATUS_ID,
    },
  });
}
