import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Triggers a full inventory consumption sync.
 * This is useful for debugging missing consumption data.
 * @param lookbackDays Optional number of days for a fast incremental sync.
 * The daily job still reconciles the complete configured window.
 */
export async function triggerManualSync(lookbackDays?: number) {
  const toastId = toast.loading('Iniciando sincronização completa de consumo...');
  
  try {
    let cursor: any = null;
    let stats: any = { os_debited: 0, vendas_debited: 0, pecas_created: 0 };

    while (true) {
      const { data, error } = await supabase.functions.invoke('inventory-consumption-sync', {
        body: { 
          action: 'sync_page', 
          cursor,
          lookback_days: lookbackDays,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.progress) {
        toast.loading(
          `Sincronizando: ${data.progress.taskIndex + 1}/${data.progress.totalTasks} · Pág ${data.progress.page}/${data.progress.totalPages}`,
          { id: toastId }
        );
      }

      if (data?.retry) {
        await new Promise(r => setTimeout(r, 2000));
        cursor = data.cursor;
        continue;
      }

      if (data?.done) {
        stats = data.stats || cursor?.stats || stats;
        toast.success(`Sincronização concluída! ${stats.os_debited} OSs, ${stats.vendas_debited} vendas.`, { id: toastId });
        break;
      }

      cursor = data.cursor;
      await new Promise(r => setTimeout(r, 300));
    }
    
    return stats;
  } catch (err) {
    console.error('Manual sync failed:', err);
    toast.error('Erro na sincronização: ' + (err instanceof Error ? err.message : 'Erro desconhecido'), { id: toastId });
    throw err;
  }
}
