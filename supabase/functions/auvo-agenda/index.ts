const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const AUVO_API_URL = 'https://api.auvo.com.br/v2';

type AuvoUser = {
  user_id: number;
  name: string;
  login: string;
};

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

async function auvoRequest(token: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${AUVO_API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const error = new Error(`Auvo ${path} -> ${res.status}: ${text.slice(0, 300)}`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return data;
}

async function patchWithRetry(token: string, taskId: string, patches: unknown[]): Promise<any> {
  const delays = [0, 1500, 3000];
  let lastError: unknown;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    try {
      return await auvoRequest(token, `/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patches),
      });
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      if (status !== 502 && status !== 503) throw error;
    }
  }
  throw lastError;
}

async function fetchTasks(token: string, startDate: string, endDate: string): Promise<any[]> {
  const all: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const filter = encodeURIComponent(JSON.stringify({
      startDate: `${startDate}T00:00:00`,
      endDate: `${endDate}T23:59:59`,
    }));
    const data = await auvoRequest(token, `/tasks/?paramFilter=${filter}&page=${page}&pageSize=100&order=asc`);
    const entries: any[] = data?.result?.entityList ?? data?.result?.Entities ?? data?.result ?? [];
    if (!Array.isArray(entries) || entries.length === 0) break;
    all.push(...entries);
    if (entries.length < 100) break;
  }
  return all;
}

async function fetchUsers(token: string): Promise<{ list: AuvoUser[]; names: Map<number, string> }> {
  const list: AuvoUser[] = [];
  const names = new Map<number, string>();
  for (let page = 1; page <= 10; page++) {
    const data = await auvoRequest(token, `/users/?page=${page}&pageSize=100`);
    const entries: any[] = data?.result?.entityList ?? data?.result ?? [];
    if (!Array.isArray(entries) || entries.length === 0) break;
    for (const user of entries) {
      const id = Number(user?.userID ?? user?.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const name = String(user?.name ?? user?.userName ?? user?.login ?? `Usuário ${id}`).trim();
      const login = String(user?.login ?? user?.userName ?? '').trim();
      list.push({ user_id: id, name, login });
      names.set(id, name);
    }
    if (entries.length < 100) break;
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return { list, names };
}

async function fetchCustomers(token: string, ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const unique = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
  for (let i = 0; i < unique.length; i += 6) {
    await Promise.all(unique.slice(i, i + 6).map(async (id) => {
      try {
        const data = await auvoRequest(token, `/customers/${id}`);
        const customer = data?.result || data;
        map.set(id, String(customer?.description ?? customer?.customerName ?? customer?.name ?? `Cliente ${id}`));
      } catch {
        map.set(id, `Cliente ${id}`);
      }
    }));
  }
  return map;
}

function scalarStatus(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const nested = Number(record.id ?? record.status ?? record.taskStatus ?? NaN);
    return Number.isFinite(nested) ? nested : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function taskTypeName(task: any): string | null {
  return String(
    task?.taskTypeDescription ?? task?.taskType?.description ?? task?.type?.description ?? '',
  ).trim() || null;
}

function normalizeTask(task: any, users: Map<number, string>, customers: Map<number, string>) {
  const technicianId = Number(task?.idUserTo ?? task?.userTo?.userID ?? 0);
  const customerId = Number(task?.customerId ?? task?.customer?.id ?? 0);
  const rawStatus = task?.taskStatus ?? task?.status ?? null;
  const statusDescription = rawStatus && typeof rawStatus === 'object'
    ? String(rawStatus.description ?? '').trim()
    : '';

  return {
    task_id: String(task?.taskID ?? task?.taskId ?? task?.id ?? ''),
    task_date: task?.taskDate ?? task?.taskDateTime ?? null,
    task_end_date: task?.taskEndDate ?? task?.endDate ?? null,
    task_type: scalarStatus(task?.taskType),
    task_type_name: taskTypeName(task),
    status: scalarStatus(rawStatus),
    status_description: statusDescription || null,
    checkin_date: task?.checkInDate ?? task?.checkinDate ?? null,
    technician_id: technicianId || null,
    technician_name: String(task?.userToName ?? task?.userTo?.name ?? users.get(technicianId) ?? '').trim() || null,
    customer_id: customerId || null,
    customer_name: String(
      task?.customerDescription ?? task?.customerName ?? task?.customer?.description ?? customers.get(customerId) ?? '',
    ).trim() || null,
    address: typeof task?.address === 'string' ? task.address : '',
    orientation: String(task?.orientation ?? task?.description ?? ''),
  };
}

async function fetchTasksByIds(token: string, taskIds: string[]): Promise<any[]> {
  const unique = Array.from(new Set(taskIds.filter((id) => /^\d+$/.test(id)))).slice(0, 150);
  const result: any[] = [];
  for (let i = 0; i < unique.length; i += 6) {
    await Promise.all(unique.slice(i, i + 6).map(async (taskId) => {
      try {
        const data = await auvoRequest(token, `/tasks/${taskId}`);
        const task = data?.result ?? data;
        if (task) result.push(task);
      } catch (error) {
        console.warn(`[auvo-agenda] tarefa ${taskId} não encontrada`, error);
      }
    }));
  }
  return result;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'list-range');
    const token = await auvoLogin();

    if (action === 'list-users') {
      const users = await fetchUsers(token);
      return json({ items: users.list, count: users.list.length });
    }

    if (action === 'tasks-by-id') {
      const ids = Array.isArray(body?.task_ids) ? body.task_ids.map(String) : [];
      const [tasks, users] = await Promise.all([fetchTasksByIds(token, ids), fetchUsers(token)]);
      const customers = await fetchCustomers(token, tasks.map((task) => Number(task?.customerId ?? 0)));
      const items = tasks.map((task) => normalizeTask(task, users.names, customers));
      return json({ items, count: items.length, requested: ids.length });
    }

    if (action === 'update-task') {
      const taskId = String(body?.task_id || '');
      if (!/^\d+$/.test(taskId)) return json({ error: 'task_id inválido' }, 400);

      const patches: Array<{ op: 'replace'; path: string; value: unknown }> = [];
      if (body?.scheduled_at) {
        const scheduledAt = String(body.scheduled_at);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(scheduledAt)) {
          return json({ error: 'scheduled_at deve estar no formato YYYY-MM-DDTHH:mm:ss' }, 400);
        }
        patches.push({ op: 'replace', path: '/taskDate', value: scheduledAt });
      }
      if (body?.technician_id != null) {
        const technicianId = Number(body.technician_id);
        if (!Number.isFinite(technicianId) || technicianId <= 0) return json({ error: 'technician_id inválido' }, 400);
        patches.push({ op: 'replace', path: '/idUserTo', value: technicianId });
      }
      if (patches.length === 0) return json({ error: 'Informe data/hora ou técnico' }, 400);

      await patchWithRetry(token, taskId, patches);
      const [updatedRaw, users] = await Promise.all([
        auvoRequest(token, `/tasks/${taskId}`),
        fetchUsers(token),
      ]);
      const task = updatedRaw?.result ?? updatedRaw;
      const customers = await fetchCustomers(token, [Number(task?.customerId ?? 0)]);
      return json({ item: normalizeTask(task, users.names, customers), success: true });
    }

    const startDate: string = body?.start_date || new Date().toISOString().slice(0, 10);
    const endDate: string = body?.end_date || startDate;
    const [tasks, users] = await Promise.all([
      fetchTasks(token, startDate, endDate),
      fetchUsers(token),
    ]);
    const customers = await fetchCustomers(token, tasks.map((task) => Number(task?.customerId ?? 0)));
    const items = tasks.map((task) => normalizeTask(task, users.names, customers));
    items.sort((a, b) => String(a.task_date ?? '').localeCompare(String(b.task_date ?? '')));

    return json({ items, count: items.length, start_date: startDate, end_date: endDate });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('[auvo-agenda]', message);
    return json({ error: message, items: [] }, 200);
  }
});
