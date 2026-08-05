const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const AUVO_API_URL = 'https://api.auvo.com.br/v2';

async function auvoLogin(): Promise<string> {
  const apiKey = Deno.env.get('AUVO_API_KEY');
  const apiToken = Deno.env.get('AUVO_API_TOKEN');
  if (!apiKey || !apiToken) throw new Error('Credenciais do Auvo não configuradas');

  const url = `${AUVO_API_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`Falha no login do Auvo (${res.status})`);
  const data = await res.json();
  const token = data?.result?.accessToken;
  if (!token) throw new Error('Falha no login do Auvo: token não retornado');
  return token;
}

async function auvoGet(token: string, path: string): Promise<any> {
  const res = await fetch(`${AUVO_API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Auvo ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  return data;
}

/** Fetch all tasks in a date range (paginated). */
async function fetchTasks(token: string, startDate: string, endDate: string) {
  const all: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const paramFilter = encodeURIComponent(JSON.stringify({ startDate, endDate }));
    const data = await auvoGet(token, `/tasks?paramFilter=${paramFilter}&page=${page}&pageSize=100&order=asc`);
    const entries: any[] = data?.result?.entityList ?? data?.result ?? [];
    if (!Array.isArray(entries) || entries.length === 0) break;
    all.push(...entries);
    const totalPages = Number(data?.result?.pagedSearchReturnData?.totalPages ?? data?.totalPages ?? 0);
    if (entries.length < 100 || (totalPages && page >= totalPages)) break;
  }
  return all;
}

/** Fetch specific tasks by ID (used when the OS carries the exec task id in GC). */
async function fetchTasksByIds(token: string, ids: string[]) {
  const out: any[] = [];
  const CONCURRENCY = 6;
  const unique = [...new Set(ids.filter((id) => /^\d+$/.test(String(id))))].slice(0, 400);
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const slice = unique.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async (id) => {
      try {
        const data = await auvoGet(token, `/tasks/${encodeURIComponent(id)}`);
        const t = data?.result ?? data;
        if (t && (t.taskID || t.id)) out.push(t);
      } catch (_) { /* tarefa inexistente/removida no Auvo */ }
    }));
  }
  return out;
}


async function fetchUsers(token: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  for (let page = 1; page <= 10; page++) {
    const data = await auvoGet(token, `/users?page=${page}&pageSize=100`);
    const entries: any[] = data?.result?.entityList ?? data?.result ?? [];
    if (!Array.isArray(entries) || entries.length === 0) break;
    for (const u of entries) {
      const id = Number(u?.userID ?? u?.id);
      if (Number.isFinite(id)) map.set(id, String(u?.name ?? u?.userName ?? `Usuário ${id}`));
    }
    if (entries.length < 100) break;
  }
  return map;
}

async function fetchCustomers(token: string, ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const CONCURRENCY = 6;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const slice = ids.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async (id) => {
      try {
        const data = await auvoGet(token, `/customers/${id}`);
        const c = data?.result || data;
        map.set(id, String(c?.description ?? c?.customerName ?? c?.name ?? `Cliente ${id}`));
      } catch {
        map.set(id, `Cliente ${id}`);
      }
    }));
  }
  return map;
}

function extractOrcamentoCode(orientation: string): string | null {
  const m = /Or[çc]amento\s*#?\s*(\d+)/i.exec(orientation || '');
  return m ? m[1] : null;
}

function extractOsCode(orientation: string): string | null {
  const m = /\bOS\s*#?\s*(\d{3,})/i.exec(orientation || '');
  return m ? m[1] : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const startDate: string = body?.start_date || new Date().toISOString().slice(0, 10);
    const endDate: string = body?.end_date || startDate;
    const taskIds: string[] = Array.isArray(body?.task_ids) ? body.task_ids.map(String) : [];

    const token = await auvoLogin();

    // Quando o cliente envia os IDs das TAREFAS DE EXECUÇÃO lidos da OS do GC,
    // buscamos exatamente essas tarefas (vínculo pelo campo da OS, não por nome/código).
    const [tasks, users] = await Promise.all([
      taskIds.length > 0 ? fetchTasksByIds(token, taskIds) : fetchTasks(token, startDate, endDate),
      fetchUsers(token).catch(() => new Map<number, string>()),
    ]);


    const customerIds = Array.from(
      new Set(
        tasks
          .map((t) => Number(t?.customerId))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    );
    const customers = await fetchCustomers(token, customerIds).catch(() => new Map<number, string>());

    const items = tasks.map((t) => {
      const idUserTo = Number(t?.idUserTo ?? 0);
      const customerId = Number(t?.customerId ?? 0);
      const orientation = String(t?.orientation ?? '');
      return {
        task_id: String(t?.taskID ?? t?.id ?? ''),
        task_date: t?.taskDate ?? t?.taskDateTime ?? null,
        task_type: t?.taskType ?? null,
        task_type_name: t?.taskTypeDescription ?? null,
        status: t?.taskStatus ?? null,
        checkin_date: t?.checkInDate ?? null,
        technician_id: idUserTo || null,
        technician_name: users.get(idUserTo) ?? null,
        customer_id: customerId || null,
        customer_name: customers.get(customerId) ?? null,
        address: t?.address ?? '',
        orientation,
        orcamento_code: extractOrcamentoCode(orientation),
        os_code: extractOsCode(orientation),
        customer_id_gc: t?.idClientExternal || null,
      };
    });

    items.sort((a, b) => String(a.task_date ?? '').localeCompare(String(b.task_date ?? '')));

    return new Response(
      JSON.stringify({ items, count: items.length, start_date: startDate, end_date: endDate }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[auvo-agenda]', msg);
    return new Response(
      JSON.stringify({ error: msg, items: [] }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
