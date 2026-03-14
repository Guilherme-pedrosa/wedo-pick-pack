const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GC_API_URL = 'https://api.gestaoclick.com';

// Situações de venda no GestãoClick
const SITUACAO_EMPRESTIMO = '7411572';       // EMPRESTIMO DE FERRAMENTA (lancar=2, movimenta estoque)
const SITUACAO_DEVOLUCAO  = '7340738';       // Cancelada - Devolução de Ferramenta (lancar=0)

interface MovementItem {
  produto_id: string;
  nome_produto: string;
  quantidade: number;
  preco_unitario?: number;
}

interface SaidaRequest {
  tipo: 'saida';
  items: MovementItem[];
  justificativa: string;
  toolbox_name: string;
  technician_name: string;
}

interface EntradaRequest {
  tipo: 'entrada';
  venda_gc_id: string;
  toolbox_name: string;
  technician_name: string;
}

type RequestBody = SaidaRequest | EntradaRequest;

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

  const gcHeaders: Record<string, string> = {
    'access-token': GC_ACCESS_TOKEN,
    'secret-access-token': GC_SECRET_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  try {
    const body: RequestBody = await req.json();

    if (body.tipo === 'entrada') {
      // ============ DEVOLUÇÃO: Alterar status da venda ============
      return await handleEntrada(body, gcHeaders);
    } else if (body.tipo === 'saida') {
      // ============ SAÍDA: Criar venda de balcão ============
      return await handleSaida(body, gcHeaders);
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid tipo. Use "saida" or "entrada".' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Stock movement error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ===================== SAÍDA (Criar Venda) =====================
async function handleSaida(body: SaidaRequest, gcHeaders: Record<string, string>) {
  const { items, justificativa, toolbox_name, technician_name } = body;

  if (!items?.length || !toolbox_name || !technician_name) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: items, toolbox_name, technician_name' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 1. Find client by technician name
  const clientId = await findClientByName(technician_name, gcHeaders);
  if (!clientId) {
    return new Response(
      JSON.stringify({ error: `Cliente "${technician_name}" não encontrado no GestãoClick. Cadastre o técnico como cliente.` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 2. Get variation IDs for each product (needed for venda payload)
  const productDetails: Array<{ produto_id: string; variacao_id: string | null; error?: string }> = [];

  // Process in batches of 3 to respect rate limits
  for (let i = 0; i < items.length; i += 3) {
    const batch = items.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(async (item) => {
        try {
          const res = await fetch(`${GC_API_URL}/api/produtos/${item.produto_id}`, {
            method: 'GET',
            headers: gcHeaders,
          });
          if (!res.ok) {
            const txt = await res.text();
            return { produto_id: item.produto_id, variacao_id: null, error: `GET failed: ${res.status} ${txt}` };
          }
          const json = await res.json();
          const product = json.data;
          // Get first variation ID
          let variacaoId: string | null = null;
          if (product?.variacoes?.length > 0) {
            const firstVar = product.variacoes[0]?.variacao || product.variacoes[0];
            variacaoId = firstVar?.id || null;
          }
          return { produto_id: item.produto_id, variacao_id: variacaoId };
        } catch (err) {
          return { produto_id: item.produto_id, variacao_id: null, error: err instanceof Error ? err.message : 'Unknown' };
        }
      })
    );
    productDetails.push(...results);
    if (i + 3 < items.length) await wait(1100);
  }

  // Check for product fetch errors
  const fetchErrors = productDetails.filter(p => p.error);
  if (fetchErrors.length > 0) {
    console.error('Product fetch errors:', fetchErrors);
  }

  // 3. Build venda payload
  const now = new Date();
  const dataStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const codigo = Math.floor(Date.now() / 1000); // unique int code

  const produtos = items.map((item) => {
    const detail = productDetails.find(p => p.produto_id === item.produto_id);
    const prodPayload: Record<string, any> = {
      produto_id: item.produto_id,
      quantidade: String(item.quantidade),
      valor_venda: String(item.preco_unitario || 0),
      tipo_desconto: 'R$',
      desconto_valor: '0',
      desconto_porcentagem: '0',
      detalhes: justificativa,
    };
    if (detail?.variacao_id) {
      prodPayload.variacao_id = detail.variacao_id;
    }
    return { produto: prodPayload };
  });

  const vendaPayload: Record<string, any> = {
    tipo: 'produto',
    codigo: String(codigo),
    cliente_id: clientId,
    situacao_id: SITUACAO_EMPRESTIMO,
    data: dataStr,
    condicao_pagamento: 'a_vista',
    observacoes: `[WeDo Maleta] ${justificativa} | Maleta: ${toolbox_name} | Técnico: ${technician_name}`,
    produtos,
  };

  // 4. POST the venda
  console.log('Creating venda:', JSON.stringify(vendaPayload).slice(0, 500));
  const vendaRes = await fetch(`${GC_API_URL}/api/vendas`, {
    method: 'POST',
    headers: gcHeaders,
    body: JSON.stringify(vendaPayload),
  });

  const vendaBody = await vendaRes.json();
  console.log('Venda response:', JSON.stringify(vendaBody).slice(0, 500));

  if (!vendaRes.ok || vendaBody.status === 'error') {
    return new Response(
      JSON.stringify({
        success: false,
        error: vendaBody.message || vendaBody.error || `POST /api/vendas failed: ${vendaRes.status}`,
        gc_response: vendaBody,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const vendaId = vendaBody.data?.id;
  const vendaCodigo = vendaBody.data?.codigo;

  return new Response(
    JSON.stringify({
      success: true,
      venda_gc_id: vendaId,
      venda_codigo: vendaCodigo,
      summary: `Venda #${vendaCodigo} criada com ${items.length} item(ns)`,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ===================== ENTRADA (Alterar Status da Venda) =====================
async function handleEntrada(body: EntradaRequest, gcHeaders: Record<string, string>) {
  const { venda_gc_id, toolbox_name, technician_name } = body;

  if (!venda_gc_id) {
    return new Response(
      JSON.stringify({ error: 'Missing venda_gc_id for entrada' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 1. GET current venda to get required fields
  const getRes = await fetch(`${GC_API_URL}/api/vendas/${venda_gc_id}`, {
    method: 'GET',
    headers: gcHeaders,
  });

  if (!getRes.ok) {
    const txt = await getRes.text();
    return new Response(
      JSON.stringify({ success: false, error: `GET venda failed: ${getRes.status} ${txt}` }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const getBody = await getRes.json();
  const vendaData = getBody.data;

  if (!vendaData) {
    return new Response(
      JSON.stringify({ success: false, error: 'Venda not found' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 2. PUT with updated situação
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const obsNote = `\n[WeDo Maleta - DEVOLUÇÃO] Técnico: ${technician_name} | Maleta: ${toolbox_name} | ${now}`;

  const putPayload: Record<string, any> = {
    situacao_id: SITUACAO_DEVOLUCAO,
    observacoes: (vendaData.observacoes || '') + obsNote,
  };

  const putRes = await fetch(`${GC_API_URL}/api/vendas/${venda_gc_id}`, {
    method: 'PUT',
    headers: gcHeaders,
    body: JSON.stringify(putPayload),
  });

  const putBody = await putRes.json();
  console.log('Venda update response:', JSON.stringify(putBody).slice(0, 500));

  if (!putRes.ok || putBody.status === 'error') {
    return new Response(
      JSON.stringify({
        success: false,
        error: putBody.message || putBody.error || `PUT /api/vendas/${venda_gc_id} failed: ${putRes.status}`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      summary: `Venda #${vendaData.codigo} alterada para "Cancelada - Devolução de Ferramenta"`,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ===================== HELPERS =====================
async function findClientByName(name: string, gcHeaders: Record<string, string>): Promise<string | null> {
  try {
    const url = `${GC_API_URL}/api/clientes?nome=${encodeURIComponent(name)}`;
    const res = await fetch(url, { method: 'GET', headers: gcHeaders });
    if (!res.ok) {
      await res.text();
      return null;
    }
    const json = await res.json();
    if (json.data?.length > 0) {
      // Return the first matching client
      return json.data[0].id;
    }
    return null;
  } catch {
    return null;
  }
}
