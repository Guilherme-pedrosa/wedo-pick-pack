const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GC_API_URL = 'https://api.gestaoclick.com';
const AUVO_API_URL = 'https://api.auvo.com.br/v2';

// ---------- helpers ----------
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function compactApiMessage(value: unknown): string {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractApiErrorMessage(payload: unknown): string {
  const seen = new Set<unknown>();
  const candidates: string[] = [];

  const collect = (value: unknown) => {
    if (value == null || seen.has(value)) return;
    if (typeof value === 'object') seen.add(value);

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const compact = compactApiMessage(value);
      if (compact && compact !== '[object Object]') candidates.push(compact);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }

    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const preferredKeys = [
        'message', 'mensagem', 'erro', 'error', 'errors', 'detail', 'details',
        'description', 'descricao', 'data', 'result', 'raw', 'body',
      ];
      for (const key of preferredKeys) collect(obj[key]);
      for (const [key, nested] of Object.entries(obj)) {
        if (!preferredKeys.includes(key)) collect(nested);
      }
    }
  };

  collect(payload);
  const unique = Array.from(new Set(candidates)).filter((msg) => !/^\{\}$|^\[\]$/.test(msg));
  const meaningful = unique.filter((msg) => !/^bad request$/i.test(msg));
  return (meaningful.length ? meaningful : unique).slice(0, 4).join(' | ');
}

function friendlyErrorMessage(message: string): string {
  const raw = String(message || '').trim();
  const compact = compactApiMessage(raw);
  const source = compact || raw;

  if (/Auvo/i.test(source) && /(?:502|503|504|Bad Gateway|invalid response|gateway|proxy)/i.test(source)) {
    return 'O Auvo está instável no momento. A OS/Venda NÃO foi gerada. Tente novamente em alguns instantes.';
  }
  if (/GC|Gest[aã]oClick/i.test(source)) {
    if (/(?:401|403|unauthori|autoriz)/i.test(source)) {
      return 'Sem autorização no GestãoClick. Verifique as credenciais da integração.';
    }
    if (/(?:502|503|504|Bad Gateway|gateway|proxy)/i.test(source)) {
      return 'O GestãoClick está instável no momento. A OS/Venda NÃO foi gerada. Tente novamente em alguns instantes.';
    }
  }
  if (/Auvo login failed/i.test(source)) {
    return 'Não foi possível autenticar no Auvo. Verifique as credenciais da integração.';
  }
  if (/Full response|<!DOCTYPE|<html|Server Error/i.test(raw)) {
    return 'A integração retornou uma resposta inválida. A OS/Venda NÃO foi gerada. Tente novamente em alguns instantes.';
  }

  return source.slice(0, 500) || 'Erro desconhecido na geração. A OS/Venda NÃO foi gerada.';
}

async function gcRequest(path: string, method: string, body?: unknown) {
  const GC_ACCESS_TOKEN = Deno.env.get('GC_ACCESS_TOKEN')!;
  const GC_SECRET_TOKEN = Deno.env.get('GC_SECRET_TOKEN')!;

  const opts: RequestInit = {
    method,
    headers: {
      'access-token': GC_ACCESS_TOKEN,
      'secret-access-token': GC_SECRET_TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  };
  if (body && (method === 'POST' || method === 'PUT')) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${GC_API_URL}${path}`, opts);
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok && res.status !== 200) {
    const apiMsg = extractApiErrorMessage(json) || compactApiMessage(text);
    const responseDetail = apiMsg || `sem detalhe no corpo da resposta (${res.statusText || 'sem statusText'})`;
    console.error(`[gcRequest] ${method} ${path} HTTP ${res.status}: ${responseDetail.slice(0, 1200)}`);
    throw new Error(`GestãoClick ${method} ${path} retornou erro ${res.status}: ${responseDetail.slice(0, 800)}`);
  }
  return json;
}

// ---------- Auvo Auth ----------
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

async function auvoCreateTask(token: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${AUVO_API_URL}/tasks`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    console.error(`[auvoCreateTask] HTTP ${res.status} body:`, text.slice(0, 1000));
    let friendly: string;
    if (res.status >= 500) {
      friendly = `O Auvo está instável no momento (erro ${res.status}). A OS/Venda NÃO foi gerada. Tente novamente em alguns instantes.`;
    } else if (res.status === 401 || res.status === 403) {
      friendly = `Sem autorização no Auvo (${res.status}). Verifique as credenciais/token do Auvo.`;
    } else if (res.status === 400 || res.status === 422) {
      const apiMsg = data?.messageError || data?.message || data?.error || (typeof data?.raw === 'string' ? '' : '');
      friendly = `Auvo rejeitou os dados da tarefa (${res.status})${apiMsg ? `: ${String(apiMsg).slice(0, 200)}` : '.'} Revise cliente, técnico e tipo de atividade.`;
    } else {
      const apiMsg = data?.messageError || data?.message || data?.error || '';
      friendly = `Falha ao criar tarefa no Auvo (${res.status})${apiMsg ? `: ${String(apiMsg).slice(0, 200)}` : '.'}`;
    }
    throw new Error(friendly);
  }
  // Return raw parsed response — caller handles taskID extraction
  return data;
}

async function auvoGetTask(token: string, taskId: string | number): Promise<any> {
  const res = await fetch(`${AUVO_API_URL}/tasks/${taskId}`, {
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
    throw new Error(`Auvo get task failed [${res.status}] for task ${taskId}: ${text.slice(0, 500)}`);
  }

  return data;
}

// Best-effort deletion of an Auvo task. Used to roll back the activity that was
// created before the GestãoClick document, so failed attempts don't leave
// orphan activities ("tanto de atividade pra mesma OS").
async function auvoDeleteTask(token: string, taskId: string | number): Promise<boolean> {
  try {
    const res = await fetch(`${AUVO_API_URL}/tasks/${taskId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[generate-os] ⚠️ Could not delete orphan Auvo task ${taskId} [${res.status}]: ${text.slice(0, 300)}`);
      return false;
    }
    console.log(`[generate-os] Rolled back orphan Auvo task ${taskId}`);
    return true;
  } catch (e) {
    console.warn(`[generate-os] ⚠️ Error deleting orphan Auvo task ${taskId}:`, e);
    return false;
  }
}

function parseMoney(value: unknown): number {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number): string {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

function getPaymentValue(payment: any): number {
  if (payment?.pagamento?.valor != null) return parseMoney(payment.pagamento.valor);
  return parseMoney(payment?.valor);
}

function setPaymentValue(payment: any, value: string): any {
  if (payment?.pagamento && typeof payment.pagamento === 'object') {
    return { ...payment, pagamento: { ...payment.pagamento, valor: value } };
  }
  return { ...payment, valor: value };
}

function normalizePaymentsToDeclaredTotal<T extends Record<string, any>>(payload: T): T {
  if (!Array.isArray(payload.pagamentos) || payload.pagamentos.length === 0) return payload;

  const targetCents = Math.round(parseMoney(payload.valor_total) * 100);
  if (targetCents <= 0) return payload;

  const currentCents = payload.pagamentos
    .map((p: any) => Math.round(getPaymentValue(p) * 100))
    .reduce((sum: number, cents: number) => sum + cents, 0);

  if (currentCents === targetCents) return payload;

  if (payload.pagamentos.length === 1) {
    return {
      ...payload,
      pagamentos: [setPaymentValue(payload.pagamentos[0], formatMoney(targetCents / 100))],
    };
  }

  const payments = payload.pagamentos.map((payment: any, index: number) => {
    if (index !== payload.pagamentos.length - 1) return payment;
    const lastCents = Math.round(getPaymentValue(payment) * 100) + (targetCents - currentCents);
    return setPaymentValue(payment, formatMoney(lastCents / 100));
  });

  return { ...payload, pagamentos: payments };
}

function getLinePayload(entry: any, key: 'produto' | 'servico'): Record<string, any> | null {
  const line = entry?.[key] ?? entry;
  return line && typeof line === 'object' ? line : null;
}

function computeGCDocumentLineTotalCents(payload: Record<string, any>): number | null {
  let total = 0;
  let hasLine = false;

  const addLines = (items: any[] | undefined, key: 'produto' | 'servico') => {
    if (!Array.isArray(items)) return;
    for (const entry of items) {
      const line = getLinePayload(entry, key);
      if (!line) continue;

      const qty = parseMoney(line.quantidade || 0);
      const unit = parseMoney(line.valor_venda || 0);
      if (qty <= 0) continue;

      let lineTotal = qty * unit;
      const discountType = String(line.tipo_desconto || 'R$').trim();
      const fixedDiscount = parseMoney(line.desconto_valor);
      const percentDiscount = parseMoney(line.desconto_porcentagem);

      if (discountType === '%' && percentDiscount > 0) {
        lineTotal = lineTotal * (1 - percentDiscount / 100);
      } else if (fixedDiscount > 0) {
        lineTotal -= fixedDiscount;
      }

      total += Math.max(0, lineTotal);
      hasLine = true;
    }
  };

  addLines(payload.produtos, 'produto');
  addLines(payload.servicos, 'servico');

  return hasLine ? Math.round(total * 100) : null;
}

function applyGCRoundingDiscount<T extends Record<string, any>>(payload: T): T {
  const declaredCents = Math.round(parseMoney(payload.valor_total) * 100);
  if (declaredCents <= 0) return payload;

  const lineTotalCents = computeGCDocumentLineTotalCents(payload);
  if (lineTotalCents == null) return payload;

  const headerDiscountType = String(payload.tipo_desconto || payload.desconto_tipo || 'R$').trim();
  const headerDiscountCents = Math.round(parseMoney(payload.desconto_valor) * 100);
  const headerPercent = parseMoney(payload.desconto_porcentagem);

  if (headerDiscountType === '%' && headerPercent > 0) return payload;

  const currentComputedCents = lineTotalCents - headerDiscountCents;
  const missingDiscountCents = currentComputedCents - declaredCents;

  if (missingDiscountCents <= 0 || missingDiscountCents > 100) return payload;

  const nextDiscount = formatMoney((headerDiscountCents + missingDiscountCents) / 100);
  console.warn(`[generate-os] Ajuste financeiro GC: linhas=${formatMoney(lineTotalCents / 100)}, declarado=${formatMoney(declaredCents / 100)}, desconto_cabecalho=${nextDiscount}`);

  return {
    ...payload,
    tipo_desconto: 'R$',
    desconto_tipo: 'R$',
    desconto_valor: nextDiscount,
    desconto_porcentagem: '0.00',
  };
}

// ---------- GC: Discover OS attribute IDs ----------
interface AtributoMeta { id: string; nome: string }

const normalize = (value: string) =>
  (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

async function getOSAtributoIds(): Promise<{
  numOrcamento: string | null;
  tarefaExecucao: string | null;
  tarefaOs: string | null;
  localReparo: string | null;
  horasTecnicas: string | null;
}> {
  const res = await gcRequest('/api/atributos_ordens_servicos', 'GET');
  const list: AtributoMeta[] = res?.data || [];

  let numOrcamento: string | null = null;
  let tarefaExecucao: string | null = null;
  let tarefaOs: string | null = null;
  let localReparo: string | null = null;
  let horasTecnicas: string | null = null;

  for (const a of list) {
    const nome = normalize(a.nome || '');

    if (!numOrcamento && (nome.includes('numero') && nome.includes('orcamento'))) {
      numOrcamento = a.id;
    }
    if (!tarefaExecucao && nome.includes('tarefa') && nome.includes('execu')) {
      tarefaExecucao = a.id;
    }
    if (!tarefaOs && (nome === 'tarefa os' || (nome.includes('tarefa') && nome.includes('os')))) {
      tarefaOs = a.id;
    }
    if (!localReparo && nome.includes('local') && nome.includes('reparo')) {
      localReparo = a.id;
    }
    if (!horasTecnicas && nome.includes('horas') && nome.includes('tecnic')) {
      horasTecnicas = a.id;
    }
  }

  return { numOrcamento, tarefaExecucao, tarefaOs, localReparo, horasTecnicas };
}

// ---------- GC: Discover Venda extra-field attribute IDs ----------
async function getVendaAtributoIds(): Promise<{ tarefaEntrega: string | null; numOrcamento: string | null }> {
  const res = await gcRequest('/api/atributos_vendas', 'GET');
  const list: AtributoMeta[] = res?.data || [];
  let tarefaEntrega: string | null = null;
  let numOrcamento: string | null = null;
  for (const a of list) {
    const nome = normalize(a.nome || '');
    if (!tarefaEntrega && nome.includes('tarefa') && nome.includes('entrega')) {
      tarefaEntrega = a.id;
    }
    if (!numOrcamento && nome.includes('numero') && nome.includes('orcamento')) {
      numOrcamento = a.id;
    }
  }
  return { tarefaEntrega, numOrcamento };
}

// ---------- Main handler ----------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      auvo_user_id,     // number - idUserFrom in Auvo
      gc_usuario_id,    // optional - GC user ID for attribution
      auvo_customer_id, // optional - Auvo customer ID (when no source task to clone from)
      manual_equipamento, // optional - manual equipment text when not in orçamento
    } = body;
    let orcamento = body.orcamento; // GCOrcamento object from frontend

    if (!orcamento || !auvo_user_id) {
      return new Response(
        JSON.stringify({ error: 'Missing orcamento or auvo_user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================
    // AUTHORITATIVE ORÇAMENTO: re-fetch the full budget from GestãoClick.
    // The frontend payload carries "thin" product/service lines WITHOUT unit
    // prices or per-line discounts (valor_venda / desconto_valor / valor_total).
    // If we trust that payload, GC recomputes the order total from the product
    // registry's GROSS price and ignores the line discounts, so "valor do
    // pedido" ends up higher than the parcelas → "valor das parcelas, faltando X".
    // Fetching the full orçamento gives us the priced lines GC expects.
    // ============================================
    try {
      const fullOrc = await gcRequest(`/api/orcamentos/${orcamento.id}`, 'GET');
      if (fullOrc?.data) {
        // Overlay GC's authoritative data, keeping any frontend-only helper fields.
        orcamento = { ...orcamento, ...fullOrc.data };
        console.log(`[generate-os] Loaded authoritative orçamento #${orcamento.codigo}: produtos=${(orcamento.produtos || []).length}, servicos=${(orcamento.servicos || []).length}, valor_total=${orcamento.valor_total}`);
      }
    } catch (fetchErr) {
      console.warn('[generate-os] Could not re-fetch full orçamento, using frontend payload:', fetchErr);
    }

    // Regra de negócio: orçamento com QUALQUER linha de serviço vira OS.
    // Orçamento só de produto vira Venda.
    const hasServiceLine = Array.isArray(orcamento.servicos) && orcamento.servicos.length > 0;
    const isServico = hasServiceLine || parseMoney(orcamento.valor_servicos) > 0;
    const docKind: 'os' | 'venda' = isServico ? 'os' : 'venda';


    console.log(`[generate-os] Starting for ORC #${orcamento.codigo} - client: ${orcamento.nome_cliente} - tipo: ${docKind.toUpperCase()}`);

    // ============================================
    // GUARD: Check for existing successful generation
    // ============================================
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/os_generation_logs?orcamento_id=eq.${encodeURIComponent(orcamento.id)}&success=eq.true&select=id,os_codigo,auvo_task_id,operator_name,created_at&order=created_at.desc&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    const existingLogs = await checkRes.json();

    if (Array.isArray(existingLogs) && existingLogs.length > 0) {
      const prev = existingLogs[0];
      const msg = `OS já gerada para este orçamento! OS #${prev.os_codigo || '?'} / Auvo #${prev.auvo_task_id || '?'} por ${prev.operator_name || 'operador'} em ${new Date(prev.created_at).toLocaleString('pt-BR')}`;
      console.warn(`[generate-os] BLOCKED duplicate: ${msg}`);
      return new Response(
        JSON.stringify({ error: msg, duplicate: true, existing: prev }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.log('[generate-os] No previous generation found, proceeding...');

    // ============================================
    // STEP 1: Login to Auvo
    // ============================================
    console.log('[generate-os] Step 1: Auvo login...');

    const auvoToken = await auvoLogin();
    console.log('[generate-os] Auvo login OK');

    // Use address directly from orçamento — clone, don't fetch
    const addressParts = [
      orcamento.endereco,
      orcamento.cidade,
      orcamento.estado,
      orcamento.cep,
    ].filter(Boolean);
    const clientAddress = addressParts.length > 0 ? addressParts.join(', ') : orcamento.nome_cliente;
    console.log(`[generate-os] Client address (from orçamento): ${clientAddress}`);

    // ============================================
    // STEP 2: Build orientation (product/service list)
    // ============================================
    const prodLines: string[] = [];
    if (orcamento.produtos?.length) {
      prodLines.push('📦 PRODUTOS:');
      for (const p of orcamento.produtos) {
        const prod = p.produto || p;
        const qty = prod.quantidade || prod.qtd_necessaria || 1;
        prodLines.push(`  • ${prod.nome_produto} — Qtd: ${qty}`);
      }
    }
    if (orcamento.servicos?.length) {
      prodLines.push('');
      prodLines.push('🔧 SERVIÇOS:');
      for (const s of orcamento.servicos) {
        const svc = s.servico || s;
        prodLines.push(`  • ${svc.nome_servico || svc.nome || 'Serviço'} — Qtd: ${svc.quantidade || 1}`);
      }
    }

    // Equipment info — check atributos first (campo extra "Equipamento"), then equipamentos array, then manual input
    let equipText = '';
    if (orcamento.atributos?.length) {
      const eqAttr = orcamento.atributos.find((a: any) =>
        (a.atributo?.descricao || '').toLowerCase() === 'equipamento'
      );
      if (eqAttr?.atributo?.conteudo) equipText = eqAttr.atributo.conteudo;
    }
    if (!equipText) {
      const equip = orcamento.equipamentos?.[0]?.equipamento;
      if (equip) {
        const parts = [equip.equipamento, equip.marca, equip.modelo].filter(Boolean);
        equipText = parts.join(' · ');
      }
    }
    if (!equipText && manual_equipamento) {
      equipText = manual_equipamento;
      console.log(`[generate-os] Using manual equipment: ${equipText}`);
    }

    const orientationParts = [
      `OS ref. Orçamento #${orcamento.codigo}`,
      `Cliente: ${orcamento.nome_cliente}`,
      equipText ? `Equipamento: ${equipText}` : '',
      '',
      ...prodLines,
    ].filter(Boolean);
    const orientation = orientationParts.join('\n');

    const readOrcAttrByIdOrName = (targetId: string, nameIncludes: string): string => {
      if (!orcamento.atributos?.length) return '';
      for (const a of orcamento.atributos) {
        const attr = a?.atributo || a;
        const attrId = String(attr?.atributo_id || attr?.id || '');
        const attrName = normalize(String(attr?.descricao || ''));
        if (attrId === targetId || attrName.includes(normalize(nameIncludes))) {
          return String(attr?.conteudo ?? '').trim();
        }
      }
      return '';
    };

    // Clone references from orçamento attributes
    const sourceTaskOsId = readOrcAttrByIdOrName('73341', 'tarefa os');
    const idEquipamentoRaw = readOrcAttrByIdOrName('88695', 'id equipamento');

    const INT32_MAX = 2147483647;
    const allEquipIds = Array.from(
      new Set(
        String(idEquipamentoRaw || '')
          .split(/[^0-9]+/)
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    );
    const oversizedEquipIds = allEquipIds.filter((n) => n > INT32_MAX);
    const equipmentIdsFromOrcamento = allEquipIds.filter((n) => n <= INT32_MAX);

    let clonedCustomerId: number | null = null;
    let clonedEquipmentIds: number[] = [];

    if (sourceTaskOsId) {
      try {
        const sourceTask = await auvoGetTask(auvoToken, sourceTaskOsId);
        const source = sourceTask?.result || sourceTask;

        const sourceCustomer = Number(source?.customerId ?? 0);
        if (Number.isFinite(sourceCustomer) && sourceCustomer > 0) {
          clonedCustomerId = sourceCustomer;
        }

        const sourceEquipments = source?.equipmentsId;
        if (Array.isArray(sourceEquipments)) {
          const parsedSourceEquipmentIds = sourceEquipments
            .map((v: unknown) => Number(v))
            .filter((n: number) => Number.isFinite(n) && n > 0);
          oversizedEquipIds.push(...parsedSourceEquipmentIds.filter((n: number) => n > INT32_MAX));
          clonedEquipmentIds = parsedSourceEquipmentIds.filter((n: number) => n <= INT32_MAX);
        }

        console.log(`[generate-os] Cloned source tarefa OS ${sourceTaskOsId}: customerId=${clonedCustomerId ?? 0}, equipments=${clonedEquipmentIds.length}`);
      } catch (e) {
        console.warn(`[generate-os] Could not clone from source tarefa OS ${sourceTaskOsId}:`, e);
      }
    }

    // ============================================
    // STEP 3: Create Auvo task
    // ============================================
    console.log('[generate-os] Step 2: Creating Auvo task...');
    const auvoPayload: Record<string, unknown> = {
      // Venda de produto usa o tipo de atividade "Comercial - ENTREGA DA VENDAS" (200268).
      // Demais (OS de serviço) seguem com o tipo padrão.
      taskType: docKind === 'venda' ? 200268 : 180177,
      idUserFrom: Number(auvo_user_id),
      orientation,
      priority: 2,
      questionnaireId: 214757,
      // Clone address from orçamento only
      address: clientAddress,
      latitude: -23.55,
      longitude: -46.63,
    };

    // Priority: clone from source tarefa OS -> frontend-provided -> orçamento explicit mapping
    let resolvedCustomerId: number | null = null;
    if (clonedCustomerId) {
      resolvedCustomerId = Number(clonedCustomerId);
    } else if (auvo_customer_id && Number.isFinite(Number(auvo_customer_id)) && Number(auvo_customer_id) > 0) {
      resolvedCustomerId = Number(auvo_customer_id);
      console.log(`[generate-os] Using frontend-provided auvo_customer_id: ${auvo_customer_id}`);
    } else if (orcamento.auvo_customer_id && Number.isFinite(Number(orcamento.auvo_customer_id)) && Number(orcamento.auvo_customer_id) > 0) {
      resolvedCustomerId = Number(orcamento.auvo_customer_id);
    }

    if (!resolvedCustomerId) {
      return new Response(
        JSON.stringify({ error: 'Cliente Auvo obrigatório: não foi possível identificar um cliente válido para esta OS.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    auvoPayload.customerId = resolvedCustomerId;

    const equipmentsToSend = equipmentIdsFromOrcamento.length > 0
      ? equipmentIdsFromOrcamento
      : clonedEquipmentIds;

    if (equipmentsToSend.length > 0) {
      auvoPayload.equipmentsId = equipmentsToSend;
    }

    console.log(`[generate-os] Auvo payload: ${JSON.stringify(auvoPayload).slice(0, 500)}`);
    const auvoResult = await auvoCreateTask(auvoToken, auvoPayload);

    // Resilient taskID extraction: result can be object, array, or nested
    const auvoTaskId =
      auvoResult?.result?.taskID ??
      auvoResult?.result?.[0]?.taskID ??
      (Array.isArray(auvoResult) ? auvoResult[0]?.taskID : null) ??
      auvoResult?.taskID ??
      null;

    console.log(`[generate-os] Auvo full response: ${JSON.stringify(auvoResult).slice(0, 500)}`);
    console.log(`[generate-os] Auvo task created: ID=${auvoTaskId}`);

    const warnings: string[] = [];
    if (oversizedEquipIds.length > 0) {
      console.warn(`[generate-os] Equipamento(s) fora do limite Int32 filtrado(s) antes do envio ao Auvo: ${Array.from(new Set(oversizedEquipIds)).join(', ')}`);
    }
    if (equipmentsToSend.length === 0) {
      const warnMsg = sourceTaskOsId
        ? `Tarefa OS de origem (${sourceTaskOsId}) não possui equipamento vinculado no Auvo. Tarefa criada SEM equipamento.`
        : 'Nenhuma tarefa OS de origem encontrada no orçamento. Tarefa criada SEM equipamento.';
      warnings.push(warnMsg);
      console.warn(`[generate-os] ⚠️ ${warnMsg}`);
    }

    if (!auvoTaskId) {
      throw new Error(`Auvo task creation returned no taskID. Full response: ${JSON.stringify(auvoResult).slice(0, 500)}`);
    }

    await wait(500); // small pause between APIs

    // ============================================
    // STEP 4/5: Create document in GestãoClick
    //   - Serviço  → Ordem de Serviço (/api/ordens_servicos)
    //   - Produto  → Venda (/api/vendas)
    // ============================================
    let gcResult: any;
    let osId: string | undefined;
    let osCodigo: string | undefined;

    try {
    if (isServico) {
      // ----- OS (orçamento de serviço) -----
      console.log('[generate-os] Step 3: Discovering OS attribute IDs...');
      const attrIds = await getOSAtributoIds();
      console.log(`[generate-os] Attr IDs: numOrc=${attrIds.numOrcamento}, tarefaExec=${attrIds.tarefaExecucao}, tarefaOS=${attrIds.tarefaOs}, localReparo=${attrIds.localReparo}, horasTecnicas=${attrIds.horasTecnicas}`);

      console.log('[generate-os] Step 4: Creating GC OS...');

      // ⚠️ Não copiar os atributos do orçamento verbatim: os IDs de atributo do
      // orçamento (ex.: 66890, 73341, 73350, 67350, 87361, 87362, 88695) NÃO existem
      // no registro de atributos de OS (que usa IDs próprios: 81831, 73343, 73344,
      // 68658, 73897, 66889, 66902, 68156, 76731, 87055). Enviar IDs desconhecidos
      // faz o GC responder 400 Bad Request. Iniciar vazio e preencher via upsertAttr
      // com os IDs corretos de OS (descobertos em getOSAtributoIds).
      const atributos: Array<{ atributo: { atributo_id: string; conteudo: string } }> = [];


      // Override only the two required link attributes
      const upsertAttr = (atributo_id: string | null, conteudo: string) => {
        if (!atributo_id) return;
        const idx = atributos.findIndex((a) => a.atributo.atributo_id === atributo_id);
        if (idx >= 0) {
          atributos[idx] = { atributo: { atributo_id, conteudo } };
        } else {
          atributos.push({ atributo: { atributo_id, conteudo } });
        }
      };

      upsertAttr(attrIds.numOrcamento, String(orcamento.codigo));
      upsertAttr(attrIds.tarefaExecucao, String(auvoTaskId));

      // Map orçamento attribute values to OS mandatory attribute IDs
      // Orçamento attrs have different IDs than OS attrs, so we find by name/content
      const findOrcAttrValue = (orcAttrId: string): string => {
        if (!orcamento.atributos?.length) return '';
        const found = orcamento.atributos.find((a: any) => {
          const attr = a?.atributo || a;
          return String(attr?.atributo_id || attr?.id) === orcAttrId;
        });
        if (found) {
          const attr = found?.atributo || found;
          return String(attr?.conteudo ?? '');
        }
        return '';
      };

      // OS mandatory attr IDs (from GC) ← orçamento attr IDs
      // 73341 = Tarefa OS, 73350 = Local do Reparo, 67350 = Horas Técnicas
      const ORC_TAREFA_OS = '73341';
      const ORC_LOCAL_REPARO = '73350';
      const ORC_HORAS_TECNICAS = '67350';

      upsertAttr(attrIds.tarefaOs, findOrcAttrValue(ORC_TAREFA_OS) || String(auvoTaskId));
      upsertAttr(attrIds.localReparo, findOrcAttrValue(ORC_LOCAL_REPARO));
      upsertAttr(attrIds.horasTecnicas, findOrcAttrValue(ORC_HORAS_TECNICAS));

      // Copy OS payload from orçamento as-is (to preserve values)
      const osPayload: Record<string, any> = {
        cliente_id: orcamento.cliente_id,
        data: orcamento.data || new Date().toISOString().split('T')[0],
        valor_frete: orcamento.valor_frete ?? '0.00',
        condicao_pagamento: orcamento.condicao_pagamento || 'a_vista',
        produtos: orcamento.produtos || [],
        servicos: orcamento.servicos || [],
        equipamentos: orcamento.equipamentos || [],
        atributos,
        // Always: Centro de custo "OPERAÇÕES COZINHAS" + Situação "Pedido em Conferência"
        centro_custo_id: orcamento.centro_custo_id || '501357',
        situacao_id: '7063581',
      };

      // Preserve optional fields from orçamento when available
      if (orcamento.vendedor_id) osPayload.vendedor_id = orcamento.vendedor_id;
      if (orcamento.observacoes) osPayload.observacoes = orcamento.observacoes;
      if (orcamento.observacoes_interna) osPayload.observacoes_interna = orcamento.observacoes_interna;
      if (orcamento.valor_total) osPayload.valor_total = orcamento.valor_total;
      if (orcamento.pagamentos?.length) osPayload.pagamentos = orcamento.pagamentos;
      if (gc_usuario_id) osPayload.usuario_id = gc_usuario_id;
      // Preserve header-level discount (GC recalcula total ignorando desconto se não vier no payload)
      if (orcamento.desconto_valor != null && String(orcamento.desconto_valor).trim() !== '') {
        osPayload.desconto_valor = orcamento.desconto_valor;
      }
      if (orcamento.tipo_desconto) osPayload.tipo_desconto = orcamento.tipo_desconto;
      if (orcamento.desconto_tipo) osPayload.desconto_tipo = orcamento.desconto_tipo;

      console.log(`[generate-os] Copy mode payload: produtos=${(osPayload.produtos || []).length}, servicos=${(osPayload.servicos || []).length}, atributos=${atributos.length}, valor_total=${osPayload.valor_total ?? 'n/a'}`);

      gcResult = await gcRequest('/api/ordens_servicos', 'POST', normalizePaymentsToDeclaredTotal(applyGCRoundingDiscount(osPayload)));
      osId = gcResult?.data?.id;
      osCodigo = gcResult?.data?.codigo;
      console.log(`[generate-os] GC OS created: id=${osId}, codigo=${osCodigo}`);
    } else {
      // ----- VENDA (orçamento de produto) -----
      console.log('[generate-os] Step 4: Creating GC Venda...');

      // Do not copy orçamento attributes into venda: each GC document type has its
      // own attribute registry. Sending orçamento attribute IDs in a venda can also
      // produce 400 Bad Request. Only send venda-specific attributes discovered below.
      const vendaAtributos: Array<{ atributo: { atributo_id: string; conteudo: string } }> = [];

      // Insert the Auvo task number into the venda "TAREFA DE ENTREGA" custom field
      // and the orçamento code into the "NÚMERO DO ORÇAMENTO" custom field.
      try {
        const vendaAttrIds = await getVendaAtributoIds();
        const upsertVendaAttr = (attrId: string | null, conteudo: string) => {
          if (!attrId) return;
          const idx = vendaAtributos.findIndex((a) => a.atributo.atributo_id === attrId);
          const entry = { atributo: { atributo_id: attrId, conteudo } };
          if (idx >= 0) vendaAtributos[idx] = entry;
          else vendaAtributos.push(entry);
        };
        if (vendaAttrIds.tarefaEntrega) {
          upsertVendaAttr(vendaAttrIds.tarefaEntrega, String(auvoTaskId));
          console.log(`[generate-os] Venda TAREFA DE ENTREGA (attr ${vendaAttrIds.tarefaEntrega}) = ${auvoTaskId}`);
        } else {
          console.warn('[generate-os] ⚠️ Atributo "TAREFA DE ENTREGA" não encontrado nos atributos de venda.');
        }
        if (vendaAttrIds.numOrcamento) {
          upsertVendaAttr(vendaAttrIds.numOrcamento, String(orcamento.codigo));
          console.log(`[generate-os] Venda NÚMERO DO ORÇAMENTO (attr ${vendaAttrIds.numOrcamento}) = ${orcamento.codigo}`);
        } else {
          console.warn('[generate-os] ⚠️ Atributo "NÚMERO DO ORÇAMENTO" não encontrado nos atributos de venda.');
        }
      } catch (e) {
        console.warn('[generate-os] ⚠️ Falha ao resolver atributos extras da venda:', e);
      }

      // Situação "SEPARADO - AGUARDANDO ENTREGA / DESPACHO"
      const VENDA_SITUACAO_ID = '8955109';

      const vendaPayload: Record<string, any> = {
        tipo: 'produto',
        cliente_id: orcamento.cliente_id,
        data: orcamento.data || new Date().toISOString().split('T')[0],
        valor_frete: orcamento.valor_frete ?? '0.00',
        condicao_pagamento: orcamento.condicao_pagamento || 'a_vista',
        produtos: orcamento.produtos || [],
        centro_custo_id: orcamento.centro_custo_id || '501357',
        situacao_id: VENDA_SITUACAO_ID,
      };
      if (vendaAtributos.length) vendaPayload.atributos = vendaAtributos;
      if (orcamento.vendedor_id) vendaPayload.vendedor_id = orcamento.vendedor_id;
      if (orcamento.observacoes) vendaPayload.observacoes = orcamento.observacoes;
      if (orcamento.observacoes_interna) vendaPayload.observacoes_interna = orcamento.observacoes_interna;
      if (orcamento.valor_total) vendaPayload.valor_total = orcamento.valor_total;
      if (orcamento.pagamentos?.length) vendaPayload.pagamentos = orcamento.pagamentos;
      if (gc_usuario_id) vendaPayload.usuario_id = gc_usuario_id;
      // Preserve header-level discount (GC recalcula total ignorando desconto se não vier no payload)
      if (orcamento.desconto_valor != null && String(orcamento.desconto_valor).trim() !== '') {
        vendaPayload.desconto_valor = orcamento.desconto_valor;
      }
      if (orcamento.tipo_desconto) vendaPayload.tipo_desconto = orcamento.tipo_desconto;
      if (orcamento.desconto_tipo) vendaPayload.desconto_tipo = orcamento.desconto_tipo;

      console.log(`[generate-os] Venda payload: produtos=${(vendaPayload.produtos || []).length}, valor_total=${vendaPayload.valor_total ?? 'n/a'}, desconto=${vendaPayload.desconto_valor ?? '0'} (${vendaPayload.desconto_tipo ?? 'n/a'}), situacao=${VENDA_SITUACAO_ID}`);

      gcResult = await gcRequest('/api/vendas', 'POST', normalizePaymentsToDeclaredTotal(applyGCRoundingDiscount(vendaPayload)));
      osId = gcResult?.data?.id;
      osCodigo = gcResult?.data?.codigo;
      console.log(`[generate-os] GC Venda created: id=${osId}, codigo=${osCodigo}`);
    }
    } catch (gcErr) {
      // The Auvo activity was created before this step. Roll it back so a failed
      // GestãoClick submission does not leave an orphan activity behind.
      if (auvoTaskId) {
        await auvoDeleteTask(auvoToken, auvoTaskId);
      }
      throw gcErr;
    }

    // ============================================
    // STEP 6: Update orçamento status to "OS Gerada" (7109779)
    // ============================================
    const NEW_ORC_STATUS_ID = '7109779';
    try {
      console.log(`[generate-os] Step 6: Updating orçamento #${orcamento.codigo} status to ${NEW_ORC_STATUS_ID}...`);

      let orcForUpdate = orcamento;
      try {
        const latestOrc = await gcRequest(`/api/orcamentos/${orcamento.id}`, 'GET');
        if (latestOrc?.data) orcForUpdate = { ...orcamento, ...latestOrc.data };
      } catch (latestErr) {
        console.warn('[generate-os] Could not refresh orçamento before status update:', latestErr);
      }

      const orcUpdatePayload: Record<string, any> = {
        cliente_id: orcForUpdate.cliente_id,
        data: orcForUpdate.data || new Date().toISOString().split('T')[0],
        situacao_id: NEW_ORC_STATUS_ID,
        valor_total: formatMoney(parseMoney(orcForUpdate.valor_total)),
        valor_frete: formatMoney(parseMoney(orcForUpdate.valor_frete ?? '0.00')),
        condicao_pagamento: orcForUpdate.condicao_pagamento || 'a_vista',
        produtos: orcForUpdate.produtos || [],
        servicos: orcForUpdate.servicos || [],
        atributos: orcForUpdate.atributos || [],
        equipamentos: orcForUpdate.equipamentos || [],
      };
      // Preserve header-level discount on the orçamento status update
      if (orcForUpdate.desconto_valor != null && String(orcForUpdate.desconto_valor).trim() !== '') {
        orcUpdatePayload.desconto_valor = orcForUpdate.desconto_valor;
      }
      if (orcForUpdate.desconto_tipo) orcUpdatePayload.desconto_tipo = orcForUpdate.desconto_tipo;
      // Preserve pagamentos to avoid total vs parcelas mismatch
      if (orcForUpdate.pagamentos?.length) orcUpdatePayload.pagamentos = orcForUpdate.pagamentos;
      if (orcForUpdate.vendedor_id) orcUpdatePayload.vendedor_id = orcForUpdate.vendedor_id;
      if (orcForUpdate.observacoes) orcUpdatePayload.observacoes = orcForUpdate.observacoes;
      if (orcForUpdate.observacoes_interna) orcUpdatePayload.observacoes_interna = orcForUpdate.observacoes_interna;
      if (gc_usuario_id) orcUpdatePayload.usuario_id = gc_usuario_id;

      await gcRequest(`/api/orcamentos/${orcamento.id}`, 'PUT', normalizePaymentsToDeclaredTotal(orcUpdatePayload));
      console.log(`[generate-os] Orçamento #${orcamento.codigo} status updated to ${NEW_ORC_STATUS_ID}`);
    } catch (orcErr) {
      const orcMsg = orcErr instanceof Error ? orcErr.message : String(orcErr);
      console.warn(`[generate-os] ⚠️ Failed to update orçamento status: ${orcMsg}`);
      warnings.push(`Não foi possível atualizar o status do orçamento: ${orcMsg}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        doc_kind: docKind,
        auvo_task_id: auvoTaskId,
        os_id: osId,
        os_codigo: osCodigo,
        warnings: warnings.length > 0 ? warnings : undefined,
        gc_response: gcResult?.data,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Unknown error';
    const message = friendlyErrorMessage(rawMessage);
    console.error('[generate-os] Error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
