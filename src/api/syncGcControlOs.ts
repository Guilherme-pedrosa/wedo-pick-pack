import { supabase } from '@/integrations/supabase/client';

export interface SyncGcControlTask {
  task_id: string;
  customer_name: string | null;
  technician_name: string | null;
  technician_id: string | null;
  task_date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  orientation: string | null;
  address: string | null;
  auvo_link: string | null;
}

export interface SyncGcControlOrder {
  gc_os_id: string;
  gc_os_code: string;
  client_name: string | null;
  situation_id: string | null;
  situation_name: string | null;
  situation_color: string | null;
  total_value: number;
  seller_name: string | null;
  os_technician_name: string | null;
  os_date: string | null;
  expected_exit_date: string | null;
  gc_link: string | null;
  equipment_name: string | null;
  equipment_serial: string | null;
  os_task_ids: string[];
  execution_task_ids: string[];
  execution_tasks: SyncGcControlTask[];
  source_updated_at: string | null;
}

export interface SyncGcControlOsResponse {
  orders: SyncGcControlOrder[];
  orphan_tasks: SyncGcControlTask[];
  source: 'syncgc.controle-os';
  source_rows: number;
  generated_at: string;
}

export async function getSyncGcControlOs(date: string): Promise<SyncGcControlOsResponse> {
  const { data, error } = await supabase.functions.invoke('syncgc-control-os', {
    body: { start_date: date, end_date: date },
  });
  if (error) throw new Error(error.message || 'Não foi possível carregar o Controle OS do Sync GC');
  if (!data || typeof data !== 'object') throw new Error('O Sync GC retornou uma resposta vazia');
  const result = data as Record<string, unknown>;
  if (result.error) throw new Error(String(result.error));
  if (result.source !== 'syncgc.controle-os') {
    throw new Error('O Sync GC retornou uma fonte de dados inesperada');
  }
  return data as unknown as SyncGcControlOsResponse;
}
