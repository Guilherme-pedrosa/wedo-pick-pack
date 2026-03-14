const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GC_API_URL = 'https://api.gestaoclick.com';

interface MovementItem {
  produto_id: string;
  nome_produto: string;
  quantidade: number; // positive = add stock, negative = subtract stock
}

interface RequestBody {
  items: MovementItem[];
  justificativa: string;
  toolbox_name: string;
  technician_name: string;
  tipo: 'saida' | 'entrada'; // saida = subtract, entrada = add
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const GC_ACCESS_TOKEN = Deno.env.get('GC_ACCESS_TOKEN');
  const GC_SECRET_TOKEN = Deno.env.get('GC_SECRET_TOKEN');

  if (!GC_ACCESS_TOKEN || !GC_SECRET_TOKEN) {
    return new Response(
      JSON.stringify({ error: 'GestãoClick credentials not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body: RequestBody = await req.json();
    const { items, justificativa, toolbox_name, technician_name, tipo } = body;

    if (!items?.length || !justificativa || !tipo) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: items, justificativa, tipo' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const gcHeaders: Record<string, string> = {
      'access-token': GC_ACCESS_TOKEN,
      'secret-access-token': GC_SECRET_TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const results: Array<{
      produto_id: string;
      nome_produto: string;
      success: boolean;
      estoque_anterior?: number;
      estoque_novo?: number;
      error?: string;
    }> = [];

    // Process in batches of 2 (need GET + PUT per item, so 2 items = 4 requests ~= rate limit)
    for (let i = 0; i < items.length; i += 2) {
      const batch = items.slice(i, i + 2);

      const batchResults = await Promise.all(
        batch.map(async (item) => {
          try {
            // 1. GET current stock
            const getRes = await fetch(`${GC_API_URL}/api/produtos/${item.produto_id}`, {
              method: 'GET',
              headers: gcHeaders,
            });

            if (!getRes.ok) {
              return {
                produto_id: item.produto_id,
                nome_produto: item.nome_produto,
                success: false,
                error: `GET failed: ${getRes.status}`,
              };
            }

            const getBody = await getRes.json();
            const productData = getBody.data;

            if (!productData) {
              return {
                produto_id: item.produto_id,
                nome_produto: item.nome_produto,
                success: false,
                error: 'Product not found in GC',
              };
            }

            const currentStock = parseFloat(String(productData.estoque || '0'));
            const adjustment = tipo === 'saida' ? -Math.abs(item.quantidade) : Math.abs(item.quantidade);
            const newStock = Math.max(0, currentStock + adjustment);

            // Build observation with justification
            const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
            const tipoLabel = tipo === 'saida' ? 'SAÍDA' : 'ENTRADA';
            const obsNote = `[WeDo Maleta - ${tipoLabel}] ${justificativa} | Maleta: ${toolbox_name} | Técnico: ${technician_name} | Qtd: ${Math.abs(item.quantidade)} | ${now}`;

            const existingDesc = productData.descricao || '';
            const updatedDesc = existingDesc
              ? `${existingDesc}\n${obsNote}`
              : obsNote;

            // 2. PUT updated stock
            const putPayload: Record<string, any> = {
              nome: productData.nome,
              codigo_interno: productData.codigo_interno || '',
              valor_custo: productData.valor_custo || '0',
              estoque: String(newStock),
              descricao: updatedDesc,
            };

            const putRes = await fetch(`${GC_API_URL}/api/produtos/${item.produto_id}`, {
              method: 'PUT',
              headers: gcHeaders,
              body: JSON.stringify(putPayload),
            });

            if (!putRes.ok) {
              const putBody = await putRes.text();
              console.error(`PUT failed for ${item.produto_id}:`, putBody);
              return {
                produto_id: item.produto_id,
                nome_produto: item.nome_produto,
                success: false,
                estoque_anterior: currentStock,
                error: `PUT failed: ${putRes.status}`,
              };
            }

            return {
              produto_id: item.produto_id,
              nome_produto: item.nome_produto,
              success: true,
              estoque_anterior: currentStock,
              estoque_novo: newStock,
            };
          } catch (err) {
            return {
              produto_id: item.produto_id,
              nome_produto: item.nome_produto,
              success: false,
              error: err instanceof Error ? err.message : 'Unknown error',
            };
          }
        })
      );

      results.push(...batchResults);

      // Rate limit: wait between batches
      if (i + 2 < items.length) {
        await wait(1200);
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return new Response(
      JSON.stringify({
        success: failCount === 0,
        summary: `${successCount} OK, ${failCount} erros`,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Stock movement error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
