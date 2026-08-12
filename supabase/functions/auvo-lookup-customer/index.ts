const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const AUVO_API_URL = 'https://api.auvo.com.br/v2';

async function auvoLogin(): Promise<string> {
  const apiKey = Deno.env.get('AUVO_API_KEY');
  const apiToken = Deno.env.get('AUVO_API_TOKEN');
  if (!apiKey || !apiToken) throw new Error('Auvo credentials not configured');

  const url = `${AUVO_API_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const res = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`Auvo login failed (${res.status})`);
  const data = await res.json();
  if (!data?.result?.accessToken) {
    throw new Error(`Auvo login failed: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.result.accessToken;
}

function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D+/g, '');
}

type AuvoCustomer = { id: string; name: string; cnpj: string; address?: string; phone?: string };

function mapCustomer(raw: any): AuvoCustomer {
  return {
    id: String(raw?.id ?? raw?.idCustomer ?? ''),
    name: String(raw?.description ?? raw?.customerName ?? raw?.name ?? 'Nome não disponível'),
    cnpj: onlyDigits(raw?.cpfCnpj ?? raw?.cnpj ?? raw?.cpf ?? ''),
    address: raw?.address || '',
    phone: raw?.phoneNumber || raw?.phone || '',
  };
}

async function fetchCustomersPage(token: string, page: number, pageSize: number, paramFilter?: Record<string, unknown>) {
  // Auvo hangs when /customers is called without paramFilter — always send one.
  const params = new URLSearchParams();
  params.set('paramFilter', JSON.stringify(paramFilter ?? { active: true }));
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  params.set('order', 'asc');

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let res: Response;
  try {
    res = await fetch(`${AUVO_API_URL}/customers/?${params.toString()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    console.error('[auvo-lookup-customer] page fetch failed', page, String(e));
    return { ok: false as const, entities: [] as any[], hasMore: false, status: 0 };
  }
  clearTimeout(timer);

  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = null; }
  console.log(`[auvo-lookup-customer] page=${page} size=${pageSize} status=${res.status} ms=${Date.now() - started}`);
  if (!res.ok) return { ok: false as const, entities: [] as any[], hasMore: false, status: res.status };
  const entities: any[] = data?.result?.entityList ?? data?.result?.entities ?? data?.result ?? [];
  const list = Array.isArray(entities) ? entities : [];
  return { ok: true as const, entities: list, hasMore: list.length >= pageSize, status: res.status };
}

// Module-level directory cache (warm instances answer instantly)
let directoryCache: { at: number; customers: AuvoCustomer[] } | null = null;
const DIRECTORY_TTL_MS = 10 * 60 * 1000;

async function loadDirectory(token: string): Promise<AuvoCustomer[]> {
  if (directoryCache && Date.now() - directoryCache.at < DIRECTORY_TTL_MS) {
    return directoryCache.customers;
  }
  const all: AuvoCustomer[] = [];
  const pageSize = 500;
  for (let page = 1; page <= 12; page++) {
    const { ok, entities, hasMore } = await fetchCustomersPage(token, page, pageSize);
    if (!ok) break;
    for (const raw of entities) {
      const c = mapCustomer(raw);
      if (c.id) all.push(c);
    }
    if (!hasMore) break;
  }
  directoryCache = { at: Date.now(), customers: all };
  return all;
}

async function searchByCnpj(token: string, cnpj: string): Promise<AuvoCustomer[]> {
  const target = onlyDigits(cnpj);
  if (!target) return [];

  const found = new Map<string, AuvoCustomer>();

  // 1) Try Auvo's own filter first (fast path)
  try {
    const { entities } = await fetchCustomersPage(token, 1, 100, { cpfCnpj: target });
    for (const raw of entities) {
      const c = mapCustomer(raw);
      if (c.id && c.cnpj === target) found.set(c.id, c);
    }
  } catch (_) { /* ignore and fall back */ }

  if (found.size > 0) return [...found.values()];

  // 2) Fallback: scan the (cached) customer directory and compare normalized CNPJ
  const directory = await loadDirectory(token);
  for (const c of directory) {
    if (c.cnpj && c.cnpj === target) found.set(c.id, c);
  }

  return [...found.values()];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || (body?.cnpj ? 'search-by-cnpj' : 'lookup'));

    const token = await auvoLogin();

    if (action === 'diag') {
      const size = Number(body?.pageSize || 100);
      const started = Date.now();
      const page = await fetchCustomersPage(token, 1, size, body?.filter || undefined);
      return new Response(
        JSON.stringify({
          ms: Date.now() - started,
          status: page.status,
          count: page.entities.length,
          sample: page.entities.slice(0, 2),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'search-by-cnpj') {
      const cnpj = onlyDigits(body?.cnpj);
      if (!cnpj) {
        return new Response(
          JSON.stringify({ error: 'Missing cnpj', customers: [] }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const customers = await searchByCnpj(token, cnpj);
      return new Response(
        JSON.stringify({ cnpj, customers }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const customer_id = body?.customer_id;
    if (!customer_id) {
      return new Response(
        JSON.stringify({ error: 'Missing customer_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const res = await fetch(`${AUVO_API_URL}/customers/${customer_id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `Cliente não encontrado (${res.status})`, details: data }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const customer = data?.result || data;
    return new Response(
      JSON.stringify({
        id: customer?.idCustomer || customer?.id || customer_id,
        name: customer?.description || customer?.customerName || customer?.name || 'Nome não disponível',
        cnpj: onlyDigits(customer?.cpfCnpj),
        address: customer?.address || '',
        phone: customer?.phoneNumber || customer?.phone || '',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[auvo-lookup-customer]', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
