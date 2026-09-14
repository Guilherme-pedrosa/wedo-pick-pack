import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { purchaseScanStatus } from '../_shared/purchaseScanStatus.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// O agendamento antigo foi desativado pela migration 20260911221000.
// O worker do GitHub executa a varredura completa e publica o snapshot validado.
// Este endereço legado consulta somente o resultado: nunca inicia outra varredura.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const { data, error } = await db.from('compras_snapshots')
      .select('id,created_at,total_produtos_sem_estoque,total_itens_cobertos_pedido,total_orcamentos,duration_ms')
      .eq('status', 'success').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return Response.json(purchaseScanStatus(data), { headers: corsHeaders });
  } catch {
    return Response.json({ error: 'Não foi possível consultar a última varredura de compras. Nenhuma nova varredura foi iniciada.', scan_started: false },
      { status: 503, headers: corsHeaders });
  }
});
