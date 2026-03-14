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
  technician_gc_id?: string | null;
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
      return await handleEntrada(body, gcHeaders);
    } else if (body.tipo === 'saida') {
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
  const { items, justificativa, toolbox_name, technician_name, technician_gc_id } = body;

  if (!items?.length || !toolbox_name || !technician_name) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: items, toolbox_name, technician_name' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 1. Find client by technician name (strict exact match)
  const clientLookup = await findClientByName(technician_name, gcHeaders);
  if (!clientLookup.client) {
    return new Response(
      JSON.stringify({
        error: clientLookup.error || `Cliente do técnico "${technician_name}" não encontrado no GestãoClick.`,
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  const client = clientLookup.client;

  // 2. Get variation IDs for each product (needed for venda payload)
  const productDetails: Array<{ produto_id: string; variacao_id: string | null; error?: string }> = [];

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

  const fetchErrors = productDetails.filter(p => p.error);
  if (fetchErrors.length > 0) {
    console.error('Product fetch errors:', fetchErrors);
  }

  // 3. Build venda payload
  const now = new Date();
  const dataStr = now.toISOString().slice(0, 10);
  const codigo = Math.floor(Date.now() / 1000);

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

  const totalValue = items
    .reduce((sum, item) => sum + (item.quantidade * (item.preco_unitario || 0)), 0)
    .toFixed(2);

  const pdvPayment = await findPdvPaymentMethod(gcHeaders);
  if (!pdvPayment?.id) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Nenhuma forma de pagamento de PDV (disponível no balcão) foi encontrada no GestãoClick.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const vendaPayload: Record<string, any> = {
    tipo: 'produto',
    codigo: String(codigo),
    cliente_id: client.id,
    situacao_id: SITUACAO_EMPRESTIMO,
    data: dataStr,
    prazo_entrega: dataStr,
    condicao_pagamento: 'a_vista',
    nome_canal_venda: 'Presencial',
    observacoes: `[WeDo Maleta] ${justificativa} | Maleta: ${toolbox_name} | Técnico: ${technician_name} (${technician_gc_id || 'sem-id'})`,
    pagamentos: [
      {
        pagamento: {
          data_vencimento: dataStr,
          valor: totalValue,
          forma_pagamento_id: pdvPayment.id,
          observacao: 'Empréstimo de ferramenta',
        },
      },
    ],
    produtos,
  };

  if (technician_gc_id) {
    vendaPayload.tecnico_id = String(technician_gc_id);
  }

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
  const nomeCliente = vendaBody.data?.nome_cliente || client.nome;

  if (!vendaId) {
    return new Response(
      JSON.stringify({ success: false, error: 'Venda criada sem ID retornado pelo ERP.' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      venda_gc_id: vendaId,
      venda_codigo: vendaCodigo,
      summary: `Venda #${vendaCodigo} (${nomeCliente}) — ${items.length} item(ns) — Situação: EMPRESTIMO DE FERRAMENTA`,
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
const normalizeText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

type ClientLookupResult = {
  client: { id: string; nome: string } | null;
  error?: string;
};

async function findClientByName(name: string, gcHeaders: Record<string, string>): Promise<ClientLookupResult> {
  try {
    const url = `${GC_API_URL}/api/clientes?nome=${encodeURIComponent(name)}`;
    const res = await fetch(url, { method: 'GET', headers: gcHeaders });
    if (!res.ok) {
      const body = await res.text();
      return {
        client: null,
        error: `Falha ao buscar cliente no GestãoClick: ${res.status} ${body || ''}`.trim(),
      };
    }

    const json = await res.json();
    const raw = Array.isArray(json?.data) ? json.data : [];
    const clients = raw
      .map((row: any) => row?.Cliente || row)
      .filter((row: any) => row?.id && row?.nome)
      .map((row: any) => ({ id: String(row.id), nome: String(row.nome) }));

    const target = normalizeText(name);
    const exactMatches = clients.filter((c) => normalizeText(c.nome) === target);

    if (exactMatches.length === 1) {
      return { client: exactMatches[0] };
    }

    if (exactMatches.length === 0) {
      return {
        client: null,
        error: `Cliente exato do técnico "${name}" não encontrado no GestãoClick.`,
      };
    }

    const names = [...new Set(exactMatches.map((c) => c.nome))].slice(0, 5);
    return {
      client: null,
      error: `Cliente ambíguo para "${name}". Correspondências exatas: ${names.join(', ')}.`,
    };
  } catch {
    return { client: null, error: 'Erro inesperado ao buscar cliente no GestãoClick.' };
  }
}

async function findPdvPaymentMethod(gcHeaders: Record<string, string>): Promise<{ id: string; nome: string } | null> {
  try {
    const res = await fetch(`${GC_API_URL}/api/formas_pagamentos`, {
      method: 'GET',
      headers: gcHeaders,
    });
    if (!res.ok) {
      await res.text();
      return null;
    }

    const json = await res.json();
    const raw = Array.isArray(json?.data) ? json.data : [];

    const methods = raw
      .map((row: any) => row?.FormasPagamento || row)
      .filter((row: any) => row?.id && row?.nome);

    const aCombinar = methods.find(
      (m: any) => m.disponivel_pdv === '1' && String(m.nome || '').toLowerCase().includes('combinar')
    );
    if (aCombinar) {
      return { id: String(aCombinar.id), nome: String(aCombinar.nome) };
    }

    const preferred = methods.find((m: any) => m.disponivel_pdv === '1' && m.confirmar_financeiro === '0');
    if (preferred) {
      return { id: String(preferred.id), nome: String(preferred.nome) };
    }

    const pdvOnly = methods.find((m: any) => m.disponivel_pdv === '1');
    if (pdvOnly) {
      return { id: String(pdvOnly.id), nome: String(pdvOnly.nome) };
    }

    return null;
  } catch {
    return null;
  }
}

