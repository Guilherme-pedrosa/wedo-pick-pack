const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GC_API_URL = 'https://api.gestaoclick.com';
const RATE_LIMIT_MS = 350;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const gcAccess = Deno.env.get('GC_ACCESS_TOKEN')!;
  const gcSecret = Deno.env.get('GC_SECRET_TOKEN')!;

  if (!gcAccess || !gcSecret) {
    return jsonResp({ error: 'GC credentials not configured' }, 500);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const cursor = body.cursor || { page: 1, stockMap: {} };
    const page = cursor.page;
    const stockMap: Record<string, number> = cursor.stockMap || {};

    await sleep(RATE_LIMIT_MS);

    const params = new URLSearchParams({
      pagina: String(page),
      order: 'ASC',
    });

    const url = `${GC_API_URL}/api/produtos?${params}`;
    const res = await fetch(url, {
      headers: {
        'access-token': gcAccess,
        'secret-access-token': gcSecret,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (res.status === 429) {
      // Rate limited — return same cursor to retry
      return jsonResp({
        done: false,
        cursor,
        retry: true,
        progress: { page, totalPages: 0, productsLoaded: Object.keys(stockMap).length },
      });
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`GC API error ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const products = data?.data || [];
    const meta = data?.meta || {};
    const totalPages = meta.total_paginas || 1;
    const totalRegistros = meta.total_registros || 0;

    for (const p of products) {
      const id = String(p.id);
      const estoque = parseFloat(String(p.estoque || '0'));
      stockMap[id] = isNaN(estoque) ? 0 : estoque;
    }

    const nextPage = page + 1;
    const done = nextPage > totalPages;

    return jsonResp({
      done,
      cursor: done ? null : { page: nextPage, stockMap },
      stockMap: done ? stockMap : undefined,
      progress: {
        page,
        totalPages,
        totalRegistros,
        productsLoaded: Object.keys(stockMap).length,
      },
    });
  } catch (err) {
    console.error('bulk-stock-fetch error:', err);
    return jsonResp({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
