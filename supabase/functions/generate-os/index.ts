const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GC_API_URL = 'https://api.gestaoclick.com';
const AUVO_API_URL = 'https://api.auvo.com.br/v2';

// ---------- helpers ----------
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

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
    throw new Error(`GC ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
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
    throw new Error(`Auvo create task failed [${res.status}]: ${text.slice(0, 500)}`);
  }
  // Return raw parsed response — caller handles taskID extraction
  return data;
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

// ---------- Main handler ----------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      orcamento,        // GCOrcamento object from frontend
      auvo_user_id,     // number - idUserFrom in Auvo
      gc_usuario_id,    // optional - GC user ID for attribution
    } = body;

    if (!orcamento || !auvo_user_id) {
      return new Response(
        JSON.stringify({ error: 'Missing orcamento or auvo_user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[generate-os] Starting for ORC #${orcamento.codigo} - client: ${orcamento.nome_cliente}`);

    // ============================================
    // STEP 1: Login to Auvo + Fetch client address from GC (parallel)
    // ============================================
    console.log('[generate-os] Step 1: Auvo login + GC client fetch...');

    // Fetch client details from GC to get address
    const fetchClientAddress = async (): Promise<{ endereco: string; cidade: string; estado: string; cep: string }> => {
      try {
        const clientRes = await gcRequest(`/api/clientes/${orcamento.cliente_id}`, 'GET');
        const c = clientRes?.data || {};
        return {
          endereco: c.endereco || '',
          cidade: c.cidade || '',
          estado: c.estado || '',
          cep: c.cep || '',
        };
      } catch (e) {
        console.warn('[generate-os] Could not fetch client address from GC:', e);
        return { endereco: '', cidade: '', estado: '', cep: '' };
      }
    };

    const [auvoToken, clientGeo] = await Promise.all([
      auvoLogin(),
      fetchClientAddress(),
    ]);
    console.log('[generate-os] Auvo login OK');

    // Build full address string
    const addressParts = [clientGeo.endereco, clientGeo.cidade, clientGeo.estado, clientGeo.cep].filter(Boolean);
    const clientAddress = addressParts.length > 0 ? addressParts.join(', ') : orcamento.nome_cliente;
    console.log(`[generate-os] Client address: ${clientAddress}`);

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

    // Equipment info — check atributos first (campo extra "Equipamento"), then equipamentos array
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

    const orientationParts = [
      `OS ref. Orçamento #${orcamento.codigo}`,
      `Cliente: ${orcamento.nome_cliente}`,
      equipText ? `Equipamento: ${equipText}` : '',
      '',
      ...prodLines,
    ].filter(Boolean);
    const orientation = orientationParts.join('\n');

    // ============================================
    // STEP 3: Create Auvo task
    // ============================================
    console.log('[generate-os] Step 2: Creating Auvo task...');
    const auvoPayload: Record<string, unknown> = {
      taskType: 180177,
      idUserFrom: Number(auvo_user_id),
      orientation,
      priority: 2,
      questionnaireId: 214757,
      // Use real client address from GC
      address: clientAddress,
      latitude: -23.55, // São Paulo default fallback (Brazil, not Italy!)
      longitude: -46.63,
    };

    if (orcamento.auvo_customer_id) {
      auvoPayload.customerId = orcamento.auvo_customer_id;
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

    if (!auvoTaskId) {
      throw new Error(`Auvo task creation returned no taskID. Full response: ${JSON.stringify(auvoResult).slice(0, 500)}`);
    }

    await wait(500); // small pause between APIs

    // ============================================
    // STEP 4: Discover OS attribute IDs in GC
    // ============================================
    console.log('[generate-os] Step 3: Discovering OS attribute IDs...');
    const attrIds = await getOSAtributoIds();
    console.log(`[generate-os] Attr IDs: numOrc=${attrIds.numOrcamento}, tarefaExec=${attrIds.tarefaExecucao}, tarefaOS=${attrIds.tarefaOs}, localReparo=${attrIds.localReparo}, horasTecnicas=${attrIds.horasTecnicas}`);

    // ============================================
    // STEP 5: Create OS in GestãoClick
    // ============================================
    console.log('[generate-os] Step 4: Creating GC OS...');

    // Copy atributos exactly from orçamento
    const atributos: Array<{ atributo: { atributo_id: string; conteudo: string } }> = [];
    if (orcamento.atributos?.length) {
      for (const a of orcamento.atributos) {
        const attr = a?.atributo || a;
        const attrId = attr?.atributo_id || attr?.id;
        if (!attrId) continue;
        atributos.push({
          atributo: {
            atributo_id: String(attrId),
            conteudo: String(attr?.conteudo ?? ''),
          },
        });
      }
    }

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
    };

    // Preserve optional fields from orçamento when available
    if (orcamento.vendedor_id) osPayload.vendedor_id = orcamento.vendedor_id;
    if (orcamento.observacoes) osPayload.observacoes = orcamento.observacoes;
    if (orcamento.observacoes_interna) osPayload.observacoes_interna = orcamento.observacoes_interna;
    if (orcamento.valor_total) osPayload.valor_total = orcamento.valor_total;
    if (gc_usuario_id) osPayload.usuario_id = gc_usuario_id;

    console.log(`[generate-os] Copy mode payload: produtos=${(osPayload.produtos || []).length}, servicos=${(osPayload.servicos || []).length}, atributos=${atributos.length}, valor_total=${osPayload.valor_total ?? 'n/a'}`);

    const gcResult = await gcRequest('/api/ordens_servicos', 'POST', osPayload);

    const osId = gcResult?.data?.id;
    const osCodigo = gcResult?.data?.codigo;
    console.log(`[generate-os] GC OS created: id=${osId}, codigo=${osCodigo}`);

    return new Response(
      JSON.stringify({
        success: true,
        auvo_task_id: auvoTaskId,
        os_id: osId,
        os_codigo: osCodigo,
        gc_response: gcResult?.data,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[generate-os] Error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
