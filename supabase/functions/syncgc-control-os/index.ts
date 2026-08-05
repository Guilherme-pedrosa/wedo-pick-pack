import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_SYNCGC_URL = 'https://bysljmkwkxrkovsaodxv.supabase.co/functions/v1/pick-pack-controle-os';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  try {
    const authorization = req.headers.get('Authorization') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) throw new Error('Credenciais internas do Pick & Pack não configuradas');

    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) return json({ error: 'Sessão do Pick & Pack inválida' }, 401);

    const integrationKey = Deno.env.get('SYNCGC_INTEGRATION_KEY');
    const integrationUrl = Deno.env.get('SYNCGC_CONTROL_OS_URL') || DEFAULT_SYNCGC_URL;
    if (!integrationKey) return json({ error: 'Integração com o Controle OS ainda não foi configurada' }, 503);

    const body = await req.json().catch(() => ({}));
    const response = await fetch(integrationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-integration-key': integrationKey,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { payload = { error: text || 'Resposta inválida do Sync GC' }; }

    return json(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('[syncgc-control-os]', message);
    return json({ error: message }, 500);
  }
});
