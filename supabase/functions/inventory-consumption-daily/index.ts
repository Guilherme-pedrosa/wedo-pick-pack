// Orchestrator: runs the full inventory-consumption-sync loop server-side.
// Triggered daily at 06:00 America/Sao_Paulo by pg_cron. Self-chains if it approaches the
// edge function wall-clock limit so very long syncs still finish.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Stop processing pages after this many ms in a single invocation, then
// re-invoke ourselves to continue with the saved cursor.
const TIME_BUDGET_MS = 100_000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const syncUrl = `${supabaseUrl}/functions/v1/inventory-consumption-sync`;
  const selfUrl = `${supabaseUrl}/functions/v1/inventory-consumption-daily`;

  const callSync = async (cursor: unknown) => {
    const res = await fetch(syncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': anonKey,
      },
      body: JSON.stringify({ action: 'sync_page', cursor }),
    });
    return res.json();
  };

  try {
    const body = await req.json().catch(() => ({}));
    let cursor: unknown = body.cursor ?? null;

    const startedAt = Date.now();

    while (true) {
      const data = await callSync(cursor);

      if (data?.error) {
        console.error('inventory-consumption-daily: sync error', data.error);
        return jsonResp({ error: data.error }, 200);
      }

      if (data?.done) {
        console.log('inventory-consumption-daily: sync complete', data.stats);
        return jsonResp({ done: true, stats: data.stats });
      }

      cursor = data?.cursor ?? cursor;

      // If we're running out of time, re-invoke ourselves (fire-and-forget)
      // to continue the loop with the current cursor.
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        console.log('inventory-consumption-daily: time budget reached, chaining');
        fetch(selfUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
            'apikey': anonKey,
          },
          body: JSON.stringify({ cursor }),
        }).catch((e) => console.error('chain invoke failed', e));

        return jsonResp({ done: false, chained: true });
      }
    }
  } catch (err) {
    console.error('inventory-consumption-daily error:', err);
    return jsonResp({ error: err instanceof Error ? err.message : 'Unknown error' }, 200);
  }
});

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
