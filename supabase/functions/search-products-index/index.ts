import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function looksLikeBarcode(q: string): boolean {
  const digits = q.replace(/\D/g, '');
  return digits === q && [8, 12, 13, 14].includes(digits.length);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase credentials not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const query = (body.query || '').trim();
    const source = body.source || 'ui_search';

    if (!query) {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let results: Record<string, unknown>[] = [];
    let resolvedId: string | null = null;

    if (looksLikeBarcode(query)) {
      // Search by barcode exact match
      const { data } = await supabaseAdmin
        .from('products_index')
        .select('*')
        .eq('codigo_barra', query)
        .limit(1);
      if (data && data.length > 0) {
        results = data;
        resolvedId = data[0].produto_id as string;
      }
    }

    if (results.length === 0) {
      // Search by codigo_interno exact match
      const { data } = await supabaseAdmin
        .from('products_index')
        .select('*')
        .eq('codigo_interno', query)
        .limit(1);
      if (data && data.length > 0) {
        results = data;
        resolvedId = data[0].produto_id as string;
      }
    }

    if (results.length === 0) {
      // Trigram search by name
      const { data } = await supabaseAdmin
        .from('products_index')
        .select('*')
        .ilike('nome', `%${query}%`)
        .order('nome')
        .limit(20);
      if (data && data.length > 0) {
        results = data;
        // If single result, mark as resolved
        if (data.length === 1) resolvedId = data[0].produto_id as string;
      }
    }

    // Log query
    await supabaseAdmin.from('product_queries').insert({
      query,
      source,
      resolved_produto_id: resolvedId,
    });

    return new Response(JSON.stringify({ data: results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('Search error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
