import { supabase } from "@/integrations/supabase/client";
import { OrderType } from "./types";

export async function checkDocumentExists(type: OrderType, documentId: string): Promise<boolean> {
  const path = type === 'os' 
    ? `/api/ordens_servicos/${encodeURIComponent(documentId)}`
    : `/api/vendas/${encodeURIComponent(documentId)}`;
    
    const { data, error } = await supabase.functions.invoke('gc-proxy', {
      body: { path, method: 'GET' }
    });
    
    // Falha de consulta não prova exclusão e jamais autoriza liberar uma reserva.
    if (error) throw new Error('Não foi possível conferir a existência do documento no GC. Reserva preservada.');
    if (Number(data?._proxy?.gc_http_status || data?.code) === 404) return false;
    if (data?._proxy?.ok !== true || data?.status === 'error' || String(data?.data?.id) !== documentId) {
      throw new Error('Resposta inconclusiva sobre o documento no GC. Reserva preservada.');
    }
    return true;
}
