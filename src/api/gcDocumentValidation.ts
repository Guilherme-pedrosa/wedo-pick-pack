import { supabase } from "@/integrations/supabase/client";
import { OrderType } from "./types";

export async function checkDocumentExists(type: OrderType, documentId: string): Promise<boolean> {
  const path = type === 'os' 
    ? `/api/ordens_servicos/${encodeURIComponent(documentId)}`
    : `/api/vendas/${encodeURIComponent(documentId)}`;
    
  try {
    const { data, error } = await supabase.functions.invoke('gestaoclick-proxy', {
      body: { path, method: 'GET' }
    });
    
    if (error) return false;
    // GC returns 200 with status=error for not found sometimes, or actual 404
    if (data?.status === 'error' || data?.code === 404) return false;
    
    return !!(data?.data?.id || data?.id);
  } catch (e) {
    console.error("Error checking GC document:", e);
    return false;
  }
}
