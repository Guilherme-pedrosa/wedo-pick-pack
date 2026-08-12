const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GC_API_URL = 'https://api.gestaoclick.com';
const SITUACAO_DEVOLUCAO = '7340738';
const ADJUSTMENT_TOKEN_PREFIX = 'AJE:';
const ADJUSTMENT_TOKEN_VERSION = 'toolbox_ajuste_v1';

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
type Direction = 'saida' | 'entrada';

type AdjustmentToken = {
  version: string;
  created_at: string;
  toolbox_name: string;
  technician_name: string;
  items: Array<{
    produto_id: string;
    nome_produto: string;
    quantidade: number;
  }>;
};

type AppliedAdjustment = {
  item: MovementItem;
  product: any;
  beforeStock: number;
  afterStock: number;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    Accept: 'application/json',
  };

  try {
    const body: RequestBody = await req.json();

    if (body.tipo === 'saida') {
      return await handleSaida(body, gcHeaders);
    }

    if (body.tipo === 'entrada') {
      return await handleEntrada(body, gcHeaders);
    }

    return new Response(
      JSON.stringify({ error: 'Invalid tipo. Use "saida" or "entrada".' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

async function handleSaida(body: SaidaRequest, gcHeaders: Record<string, string>) {
  const { items, toolbox_name, technician_name } = body;

  if (!items?.length || !toolbox_name || !technician_name) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: items, toolbox_name, technician_name' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const adjustResult = await applyStockAdjustments(items, 'saida', gcHeaders);
  if (!adjustResult.success) {
    return new Response(
      JSON.stringify({
        success: false,
        error: adjustResult.error || 'Falha ao aplicar ajuste de estoque de saída.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const token = encodeAdjustmentToken({
    version: ADJUSTMENT_TOKEN_VERSION,
    created_at: new Date().toISOString(),
    toolbox_name,
    technician_name,
    items: items.map((item) => ({
      produto_id: item.produto_id,
      nome_produto: item.nome_produto,
      quantidade: Number(item.quantidade || 0),
    })),
  });

  const ref = `AJE-${Date.now()}`;

  return new Response(
    JSON.stringify({
      success: true,
      venda_gc_id: token,
      venda_codigo: ref,
      summary: `Ajuste de estoque aplicado (${items.length} item(ns))`,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleEntrada(body: EntradaRequest, gcHeaders: Record<string, string>) {
  const { venda_gc_id, toolbox_name, technician_name } = body;

  if (!venda_gc_id) {
    return new Response(
      JSON.stringify({ error: 'Missing venda_gc_id for entrada' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Novo fluxo: estorno de ajuste de estoque
  const tokenData = decodeAdjustmentToken(venda_gc_id);
  if (tokenData) {
    const adjustResult = await applyStockAdjustments(tokenData.items, 'entrada', gcHeaders);

    if (!adjustResult.success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: adjustResult.error || 'Falha ao estornar ajuste de estoque.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        summary: `Estorno de ajuste aplicado (${tokenData.items.length} item(ns)) — Técnico: ${technician_name} | Maleta: ${toolbox_name}`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Fluxo legado: se ainda houver venda antiga gravada, cancela por situação
  return await handleLegacyEntradaBySale(venda_gc_id, toolbox_name, technician_name, gcHeaders);
}

async function handleLegacyEntradaBySale(
  vendaGcId: string,
  toolboxName: string,
  technicianName: string,
  gcHeaders: Record<string, string>
) {
  const getRes = await fetch(`${GC_API_URL}/api/vendas/${vendaGcId}`, {
    method: 'GET',
    headers: gcHeaders,
  });

  const getBody = await readJson(getRes);
  if (!getRes.ok || getBody?.status === 'error' || !getBody?.data) {
    return new Response(
      JSON.stringify({
        success: false,
        error: getBody?.message || getBody?.error || `GET venda failed: ${getRes.status}`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const vendaData = getBody.data;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const obsNote = `\n[WeDo Maleta - DEVOLUÇÃO] Técnico: ${technicianName} | Maleta: ${toolboxName} | ${now}`;

  const putPayload: Record<string, any> = {
    situacao_id: SITUACAO_DEVOLUCAO,
    observacoes: (vendaData.observacoes || '') + obsNote,
  };

  const putRes = await fetch(`${GC_API_URL}/api/vendas/${vendaGcId}`, {
    method: 'PUT',
    headers: gcHeaders,
    body: JSON.stringify(putPayload),
  });

  const putBody = await readJson(putRes);
  if (!putRes.ok || putBody?.status === 'error') {
    return new Response(
      JSON.stringify({
        success: false,
        error: putBody?.message || putBody?.error || `PUT /api/vendas/${vendaGcId} failed: ${putRes.status}`,
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

async function applyStockAdjustments(
  items: MovementItem[],
  direction: Direction,
  gcHeaders: Record<string, string>
): Promise<{ success: boolean; error?: string; applied?: AppliedAdjustment[] }> {
  const applied: AppliedAdjustment[] = [];

  for (const item of items) {
    const quantidade = Number(item.quantidade || 0);
    if (!item.produto_id || quantidade <= 0) {
      await rollbackAppliedAdjustments(applied, gcHeaders);
      return { success: false, error: `Item inválido para ajuste: ${item.nome_produto || item.produto_id}` };
    }

    const productResult = await fetchProductById(item.produto_id, gcHeaders);
    if (!productResult.product) {
      await rollbackAppliedAdjustments(applied, gcHeaders);
      return { success: false, error: productResult.error || `Produto ${item.produto_id} não encontrado.` };
    }

    const product = productResult.product;
    const beforeStock = toNumber(product.estoque);
    const afterStock = direction === 'saida' ? beforeStock - quantidade : beforeStock + quantidade;

    if (direction === 'saida' && afterStock < 0) {
      await rollbackAppliedAdjustments(applied, gcHeaders);
      return {
        success: false,
        error: `Estoque insuficiente para ${item.nome_produto} (${item.produto_id}). Estoque atual: ${beforeStock}, solicitado: ${quantidade}.`,
      };
    }

    const updateResult = await updateProductStock(product, afterStock, gcHeaders);
    if (!updateResult.success) {
      const rollbackError = await rollbackAppliedAdjustments(applied, gcHeaders);
      return {
        success: false,
        error: `${updateResult.error || `Falha ao atualizar estoque do produto ${item.produto_id}.`}${rollbackError ? ` | Erro no rollback: ${rollbackError}` : ''}`,
      };
    }

    applied.push({ item, product, beforeStock, afterStock });
    await wait(360);
  }

  return { success: true, applied };
}

async function rollbackAppliedAdjustments(applied: AppliedAdjustment[], gcHeaders: Record<string, string>): Promise<string | null> {
  if (!applied.length) return null;

  const rollbackErrors: string[] = [];

  for (const entry of [...applied].reverse()) {
    const rollbackResult = await updateProductStock(entry.product, entry.beforeStock, gcHeaders);
    if (!rollbackResult.success) {
      rollbackErrors.push(`${entry.item.nome_produto}: ${rollbackResult.error || 'falha desconhecida no rollback'}`);
    }
    await wait(360);
  }

  return rollbackErrors.length ? rollbackErrors.join(' | ') : null;
}

async function fetchProductById(produtoId: string, gcHeaders: Record<string, string>): Promise<{ product: any | null; error?: string }> {
  try {
    const res = await fetch(`${GC_API_URL}/api/produtos/${produtoId}`, {
      method: 'GET',
      headers: gcHeaders,
    });

    const body = await readJson(res);

    if (!res.ok || body?.status === 'error') {
      return {
        product: null,
        error: body?.message || body?.error || `GET /api/produtos/${produtoId} failed: ${res.status}`,
      };
    }

    if (!body?.data) {
      return { product: null, error: `Produto ${produtoId} sem dados no retorno da API.` };
    }

    return { product: body.data };
  } catch (error) {
    return { product: null, error: error instanceof Error ? error.message : 'Erro inesperado ao buscar produto.' };
  }
}

async function updateProductStock(product: any, newStock: number, gcHeaders: Record<string, string>): Promise<{ success: boolean; error?: string }> {
  const payload = buildProductUpdatePayload(product, newStock);

  if (!payload.nome || !payload.codigo_interno) {
    return { success: false, error: `Produto ${product?.id} sem campos obrigatórios para edição (nome/codigo_interno).` };
  }

  const res = await fetch(`${GC_API_URL}/api/produtos/${product.id}`, {
    method: 'PUT',
    headers: gcHeaders,
    body: JSON.stringify(payload),
  });

  const body = await readJson(res);
  if (!res.ok || body?.status === 'error') {
    return {
      success: false,
      error: body?.message || body?.error || `PUT /api/produtos/${product.id} failed: ${res.status}`,
    };
  }

  return { success: true };
}

function buildProductUpdatePayload(product: any, stock: number): Record<string, any> {
  const payload: Record<string, any> = {
    nome: String(product?.nome || ''),
    codigo_interno: String(product?.codigo_interno || product?.codigo_barra || product?.id || ''),
    valor_custo: formatDecimal(toNumber(product?.valor_custo), 4),
    estoque: formatDecimal(stock, 2),
  };

  const optionalFields = [
    'codigo_barra',
    'largura',
    'altura',
    'comprimento',
    'ativo',
    'grupo_id',
    'nome_grupo',
    'descricao',
  ] as const;

  optionalFields.forEach((key) => {
    const value = product?.[key];
    if (value !== undefined && value !== null && String(value) !== '') {
      payload[key] = String(value);
    }
  });

  if (Array.isArray(product?.valores) && product.valores.length > 0) {
    const valores = product.valores
      .filter((v: any) => v?.tipo_id)
      .map((v: any) => ({
        tipo_id: String(v.tipo_id),
        valor_venda: formatDecimal(toNumber(v.valor_venda ?? product?.valor_venda), 2),
      }));

    if (valores.length > 0) {
      payload.valores = valores;
    }
  }

  const fiscal = product?.fiscal || {};
  const fiscalFields = [
    'ncm',
    'cest',
    'peso_liquido',
    'peso_bruto',
    'valor_aproximado_tributos',
    'valor_fixo_pis',
    'valor_fixo_pis_st',
    'valor_fixo_confins',
    'valor_fixo_confins_st',
  ] as const;

  fiscalFields.forEach((key) => {
    const value = fiscal?.[key];
    if (value !== undefined && value !== null && String(value) !== '') {
      payload[key] = String(value);
    }
  });

  return payload;
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;

  const normalized = raw.includes(',') && !raw.includes('.')
    ? raw.replace(',', '.')
    : raw.replace(/,/g, '');

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDecimal(value: number, digits: number): string {
  const normalized = Number.isFinite(value) ? value : 0;
  return normalized.toFixed(digits);
}

function encodeAdjustmentToken(data: AdjustmentToken): string {
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `${ADJUSTMENT_TOKEN_PREFIX}${btoa(binary)}`;
}

function decodeAdjustmentToken(token: string): AdjustmentToken | null {
  if (!token || !token.startsWith(ADJUSTMENT_TOKEN_PREFIX)) {
    return null;
  }

  try {
    const encoded = token.slice(ADJUSTMENT_TOKEN_PREFIX.length);
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as AdjustmentToken;

    if (parsed?.version !== ADJUSTMENT_TOKEN_VERSION || !Array.isArray(parsed.items)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
