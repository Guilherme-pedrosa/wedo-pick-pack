import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GC_API_URL = 'https://api.gestaoclick.com';
const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 1100;

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeForFingerprint(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim().toLowerCase();
}

function onlyDigits(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).replace(/\D/g, '');
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function computeFingerprintInput(p: Record<string, unknown>): string {
  return [
    normalizeForFingerprint(p.id ?? p.produto_id),
    normalizeForFingerprint(p.nome),
    normalizeForFingerprint(p.codigo_interno),
    onlyDigits(p.codigo_barra),
    String(!!p.possui_variacao),
    String(p.ativo !== false && p.ativo !== '0' && p.ativo !== 'false'),
  ].join('|');
}

async function gcFetch(
  path: string,
  accessToken: string,
  secretToken: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${GC_API_URL}${path}`, {
    headers: {
      'access-token': accessToken,
      'secret-access-token': secretToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`GC API ${res.status}: ${body.slice(0, 300)}`);
  }
  return JSON.parse(body);
}

async function listProductsPage(
  page: number,
  accessToken: string,
  secretToken: string,
): Promise<{ data: Record<string, unknown>[]; meta: { total_paginas: number; total_registros: number } }> {
  const res = await gcFetch(`/api/produtos?pagina=${page}`, accessToken, secretToken);
  return {
    data: (res.data as Record<string, unknown>[]) || [],
    meta: (res.meta as { total_paginas: number; total_registros: number }) || { total_paginas: 1, total_registros: 0 },
  };
}

async function getProductDetail(
  produtoId: string,
  accessToken: string,
  secretToken: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await gcFetch(`/api/produtos/${produtoId}`, accessToken, secretToken);
    return (res.data as Record<string, unknown>) || null;
  } catch {
    return null;
  }
}

// Helper to update progress in sync_runs
async function updateProgress(
  supabaseAdmin: ReturnType<typeof createClient>,
  runId: string,
  processed: number,
  total: number,
) {
  await supabaseAdmin
    .from('sync_runs')
    .update({
      fetched_count: processed,
      total_count: total,
    })
    .eq('id', runId);
}

async function syncFull(
  supabaseAdmin: ReturnType<typeof createClient>,
  accessToken: string,
  secretToken: string,
) {
  const { data: run } = await supabaseAdmin
    .from('sync_runs')
    .insert({ run_type: 'full', status: 'running', total_count: 0 })
    .select('id')
    .single();
  const runId = run!.id;

  let processedCount = 0;
  let upsertCount = 0;
  let errorsCount = 0;
  const notes: string[] = [];

  try {
    // First pass: collect all products from listing pages
    let page = 1;
    let totalPages = 1;
    let totalRegistros = 0;
    const allProducts: Record<string, unknown>[] = [];

    while (page <= totalPages) {
      const pageBatch: number[] = [];
      for (let i = 0; i < BATCH_SIZE && page + i <= totalPages; i++) {
        pageBatch.push(page + i);
      }

      const results = await Promise.all(
        pageBatch.map((p) => listProductsPage(p, accessToken, secretToken).catch((e) => {
          errorsCount++;
          notes.push(`Page ${p} error: ${e.message}`);
          return { data: [], meta: { total_paginas: totalPages, total_registros: totalRegistros } };
        })),
      );

      for (const r of results) {
        allProducts.push(...r.data);
        if (r.meta.total_paginas > totalPages) totalPages = r.meta.total_paginas;
        if (r.meta.total_registros > totalRegistros) totalRegistros = r.meta.total_registros;
      }

      page += pageBatch.length;

      // Update progress during page fetching
      await updateProgress(supabaseAdmin, runId, allProducts.length, totalRegistros);

      if (page <= totalPages) await wait(BATCH_DELAY_MS);
    }

    const totalProducts = allProducts.length;
    await updateProgress(supabaseAdmin, runId, 0, totalProducts);

    // Bulk upsert in batches of 100 - skip individual fingerprint checks
    const UPSERT_BATCH = 100;
    for (let i = 0; i < allProducts.length; i += UPSERT_BATCH) {
      const batch = allProducts.slice(i, i + UPSERT_BATCH);
      const rows = [];

      for (const product of batch) {
        try {
          const fpInput = computeFingerprintInput(product);
          const fp = await sha256(fpInput);
          const produtoId = String(product.id);
          const hasVariacao = !!(product.variacoes && (product.variacoes as unknown[]).length > 0);
          const isAtivo = product.ativo !== false && product.ativo !== '0' && product.ativo !== 'false';
          const codigoInterno = product.codigo_interno ? String(product.codigo_interno).trim() : null;
          const codigoBarra = product.codigo_barra ? String(product.codigo_barra).trim() : null;

          // Extract first fornecedor_id from product data
          const fornecedores = product.fornecedores as { fornecedor_id?: string }[] | undefined;
          const fornecedorId = fornecedores?.[0]?.fornecedor_id 
            ? String(fornecedores[0].fornecedor_id) 
            : (product.fornecedor_id ? String(product.fornecedor_id) : null);

          rows.push({
            produto_id: produtoId,
            nome: String(product.nome || ''),
            codigo_interno: codigoInterno || null,
            codigo_barra: codigoBarra || null,
            possui_variacao: hasVariacao,
            ativo: isAtivo,
            fingerprint: fp,
            fornecedor_id: fornecedorId,
            last_synced_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            payload_min_json: {
              valor_custo: product.valor_custo,
              preco_venda: product.valor_venda || product.preco,
              estoque: product.estoque,
              nome_grupo: product.nome_grupo,
            },
          });
        } catch (e) {
          errorsCount++;
          notes.push(`Product ${product.id} prep error: ${(e as Error).message}`);
        }
      }

      if (rows.length > 0) {
        const { error } = await supabaseAdmin
          .from('products_index')
          .upsert(rows, { onConflict: 'produto_id' });
        if (error) {
          errorsCount += rows.length;
          notes.push(`Batch upsert error at ${i}: ${error.message}`);
        } else {
          upsertCount += rows.length;
        }
      }

      processedCount = Math.min(i + UPSERT_BATCH, allProducts.length);
      await updateProgress(supabaseAdmin, runId, processedCount, totalProducts);
    }

    const status = errorsCount === 0 ? 'success' : errorsCount < processedCount ? 'partial' : 'failed';

    await supabaseAdmin
      .from('sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        fetched_count: processedCount,
        upsert_count: upsertCount,
        errors_count: errorsCount,
        total_count: totalProducts,
        notes: notes.length ? notes.join('\n') : null,
        status,
      })
      .eq('id', runId);

    return { runId, fetchedCount: processedCount, upsertCount, errorsCount, status, totalCount: totalProducts };
  } catch (e) {
    await supabaseAdmin
      .from('sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        fetched_count: processedCount,
        upsert_count: upsertCount,
        errors_count: errorsCount + 1,
        notes: notes.concat((e as Error).message).join('\n'),
        status: 'failed',
      })
      .eq('id', runId);
    throw e;
  }
}

async function syncIncremental(
  supabaseAdmin: ReturnType<typeof createClient>,
  accessToken: string,
  secretToken: string,
) {
  const { data: run } = await supabaseAdmin
    .from('sync_runs')
    .insert({ run_type: 'incremental', status: 'running', total_count: 0 })
    .select('id')
    .single();
  const runId = run!.id;

  let processedCount = 0;
  let upsertCount = 0;
  let errorsCount = 0;
  const notes: string[] = [];

  try {
    const hotSetIds = new Set<string>();

    const { data: activeBoxItems } = await supabaseAdmin
      .from('box_items')
      .select('produto_id, boxes!inner(status)')
      .eq('boxes.status', 'active');
    if (activeBoxItems) {
      for (const item of activeBoxItems) hotSetIds.add(item.produto_id);
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentQueries } = await supabaseAdmin
      .from('product_queries')
      .select('resolved_produto_id')
      .gte('created_at', since24h)
      .not('resolved_produto_id', 'is', null);
    if (recentQueries) {
      for (const q of recentQueries) {
        if (q.resolved_produto_id) hotSetIds.add(q.resolved_produto_id);
      }
    }

    const uniqueIds = [...hotSetIds];
    const totalProducts = uniqueIds.length;
    notes.push(`Hot set size: ${totalProducts}`);

    await updateProgress(supabaseAdmin, runId, 0, totalProducts);

    if (totalProducts === 0) {
      await supabaseAdmin
        .from('sync_runs')
        .update({
          finished_at: new Date().toISOString(),
          fetched_count: 0,
          upsert_count: 0,
          errors_count: 0,
          total_count: 0,
          notes: 'Empty hot set, nothing to sync',
          status: 'success',
        })
        .eq('id', runId);
      return { runId, fetchedCount: 0, upsertCount: 0, errorsCount: 0, status: 'success', totalCount: 0 };
    }

    for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
      const batch = uniqueIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((id) => getProductDetail(id, accessToken, secretToken)),
      );

      for (const product of results) {
        processedCount++;
        if (!product) {
          errorsCount++;
          continue;
        }

        try {
          const fpInput = computeFingerprintInput(product);
          const fp = await sha256(fpInput);
          const produtoId = String(product.id);
          const hasVariacao = !!(product.variacoes && (product.variacoes as unknown[]).length > 0);
          const isAtivo = product.ativo !== false && product.ativo !== '0' && product.ativo !== 'false';

          const { data: existing } = await supabaseAdmin
            .from('products_index')
            .select('fingerprint')
            .eq('produto_id', produtoId)
            .maybeSingle();

          if (existing && existing.fingerprint === fp) {
            await supabaseAdmin
              .from('products_index')
              .update({ last_seen_at: new Date().toISOString() })
              .eq('produto_id', produtoId);
          } else {
            const codigoInterno = product.codigo_interno ? String(product.codigo_interno).trim() : null;
            const codigoBarra = product.codigo_barra ? String(product.codigo_barra).trim() : null;

            const fornecedores = product.fornecedores as { fornecedor_id?: string }[] | undefined;
            const fornecedorId = fornecedores?.[0]?.fornecedor_id 
              ? String(fornecedores[0].fornecedor_id) 
              : (product.fornecedor_id ? String(product.fornecedor_id) : null);

            await supabaseAdmin.from('products_index').upsert(
              {
                produto_id: produtoId,
                nome: String(product.nome || ''),
                codigo_interno: codigoInterno || null,
                codigo_barra: codigoBarra || null,
                possui_variacao: hasVariacao,
                ativo: isAtivo,
                fingerprint: fp,
                fornecedor_id: fornecedorId,
                last_synced_at: new Date().toISOString(),
                last_seen_at: new Date().toISOString(),
                payload_min_json: {
                  valor_custo: product.valor_custo,
                  preco_venda: product.valor_venda || product.preco,
                  estoque: product.estoque,
                  nome_grupo: product.nome_grupo,
                },
              },
              { onConflict: 'produto_id' },
            );
            upsertCount++;
          }
        } catch (e) {
          errorsCount++;
          notes.push(`Product ${product.id} error: ${(e as Error).message}`);
        }
      }

      // Update progress after each batch
      await updateProgress(supabaseAdmin, runId, processedCount, totalProducts);

      if (i + BATCH_SIZE < uniqueIds.length) await wait(BATCH_DELAY_MS);
    }

    const status = errorsCount === 0 ? 'success' : errorsCount < processedCount ? 'partial' : 'failed';

    await supabaseAdmin
      .from('sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        fetched_count: processedCount,
        upsert_count: upsertCount,
        errors_count: errorsCount,
        total_count: totalProducts,
        notes: notes.length ? notes.join('\n') : null,
        status,
      })
      .eq('id', runId);

    return { runId, fetchedCount: processedCount, upsertCount, errorsCount, status, totalCount: totalProducts };
  } catch (e) {
    await supabaseAdmin
      .from('sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        fetched_count: processedCount,
        upsert_count: upsertCount,
        errors_count: errorsCount + 1,
        notes: notes.concat((e as Error).message).join('\n'),
        status: 'failed',
      })
      .eq('id', runId);
    throw e;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const GC_ACCESS_TOKEN = Deno.env.get('GC_ACCESS_TOKEN');
  const GC_SECRET_TOKEN = Deno.env.get('GC_SECRET_TOKEN');
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!GC_ACCESS_TOKEN || !GC_SECRET_TOKEN) {
    return new Response(JSON.stringify({ error: 'GC credentials not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase credentials not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const runType = body.run_type || 'full';

    console.log(`Starting ${runType} sync...`);

    let result;
    if (runType === 'incremental') {
      result = await syncIncremental(supabaseAdmin, GC_ACCESS_TOKEN, GC_SECRET_TOKEN);
    } else {
      result = await syncFull(supabaseAdmin, GC_ACCESS_TOKEN, GC_SECRET_TOKEN);
    }

    console.log(`Sync ${runType} complete:`, result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('Sync error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
