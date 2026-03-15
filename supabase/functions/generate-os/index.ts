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
  const res = await fetch(`${AUVO_API_URL}/tasks/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok && res.status !== 201) {
    throw new Error(`Auvo create task failed [${res.status}]: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data?.result ?? data;
}

// ---------- GC: Discover OS attribute IDs ----------
interface AtributoMeta { id: string; nome: string }

async function getOSAtributoIds(): Promise<{ numOrcamento: string | null; tarefaExecucao: string | null }> {
  const res = await gcRequest('/api/atributos_ordens_servicos', 'GET');
  const list: AtributoMeta[] = res?.data || [];
  let numOrcamento: string | null = null;
  let tarefaExecucao: string | null = null;

  for (const a of list) {
    const nome = (a.nome || '').toLowerCase().trim();
    if (nome.includes('número') && nome.includes('orçamento') || nome.includes('numero') && nome.includes('orcamento') || nome === 'número do orçamento' || nome === 'numero orcamento') {
      numOrcamento = a.id;
    }
    if (nome.includes('tarefa') && nome.includes('execu')) {
      tarefaExecucao = a.id;
    }
  }

  return { numOrcamento, tarefaExecucao };
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
    // STEP 1: Login to Auvo
    // ============================================
    console.log('[generate-os] Step 1: Auvo login...');
    const auvoToken = await auvoLogin();
    console.log('[generate-os] Auvo login OK');

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

    // Equipment info
    let equipText = '';
    const equip = orcamento.equipamentos?.[0]?.equipamento;
    if (equip) {
      const parts = [equip.equipamento, equip.marca, equip.modelo].filter(Boolean);
      equipText = parts.join(' · ');
    }
    // Also check atributos for "Equipamento"
    if (!equipText && orcamento.atributos?.length) {
      const eqAttr = orcamento.atributos.find((a: any) =>
        (a.atributo?.descricao || '').toLowerCase() === 'equipamento'
      );
      if (eqAttr?.atributo?.conteudo) equipText = eqAttr.atributo.conteudo;
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
    // STEP 3: Create Auvo task (no technician, no date)
    // ============================================
    console.log('[generate-os] Step 2: Creating Auvo task...');
    const auvoPayload: Record<string, unknown> = {
      taskType: 180177,
      idUserFrom: Number(auvo_user_id),
      // No idUserTo (sem técnico)
      // No taskDate (sem data)
      orientation,
      priority: 2, // Medium
      questionnaireId: 214757,
      customerId: orcamento.auvo_customer_id || undefined,
    };

    // Try to get address from budget client if available
    // For now just set a placeholder - Auvo requires lat/lng/address
    if (!auvoPayload.customerId) {
      auvoPayload.address = orcamento.endereco_cliente || 'A definir';
      auvoPayload.latitude = 0;
      auvoPayload.longitude = 0;
    }

    const auvoResult = await auvoCreateTask(auvoToken, auvoPayload);
    const auvoTaskId = auvoResult?.taskID;
    console.log(`[generate-os] Auvo task created: ID=${auvoTaskId}`);

    if (!auvoTaskId) {
      throw new Error(`Auvo task creation returned no taskID: ${JSON.stringify(auvoResult).slice(0, 300)}`);
    }

    await wait(500); // small pause between APIs

    // ============================================
    // STEP 4: Discover OS attribute IDs in GC
    // ============================================
    console.log('[generate-os] Step 3: Discovering OS attribute IDs...');
    const attrIds = await getOSAtributoIds();
    console.log(`[generate-os] Attr IDs: numOrc=${attrIds.numOrcamento}, tarefaExec=${attrIds.tarefaExecucao}`);

    // ============================================
    // STEP 5: Create OS in GestãoClick
    // ============================================
    console.log('[generate-os] Step 4: Creating GC OS...');

    const atributos: Array<{ atributo: { atributo_id: string; conteudo: string } }> = [];
    if (attrIds.numOrcamento) {
      atributos.push({
        atributo: { atributo_id: attrIds.numOrcamento, conteudo: String(orcamento.codigo) },
      });
    }
    if (attrIds.tarefaExecucao) {
      atributos.push({
        atributo: { atributo_id: attrIds.tarefaExecucao, conteudo: String(auvoTaskId) },
      });
    }

    // Build products array for OS from budget products
    const osProdutos = (orcamento.produtos || []).map((p: any) => {
      const prod = p.produto || p;
      return {
        produto: {
          produto_id: prod.produto_id,
          variacao_id: prod.variacao_id || '',
          nome_produto: prod.nome_produto,
          quantidade: String(prod.quantidade || prod.qtd_necessaria || 1),
          valor_venda: prod.valor_venda || prod.valor_custo || '0.00',
        },
      };
    });

    // Build services array
    const osServicos = (orcamento.servicos || []).map((s: any) => {
      const svc = s.servico || s;
      return {
        servico: {
          servico_id: svc.servico_id || svc.id || '',
          nome_servico: svc.nome_servico || svc.nome || '',
          quantidade: String(svc.quantidade || 1),
          valor_venda: svc.valor_venda || '0.00',
        },
      };
    });

    const osPayload: Record<string, any> = {
      cliente_id: orcamento.cliente_id,
      data: new Date().toISOString().split('T')[0],
      condicao_pagamento: 'a_vista',
      valor_frete: '0.00',
      observacoes: `Gerada automaticamente a partir do Orçamento #${orcamento.codigo}.\nTarefa Auvo: ${auvoTaskId}`,
      produtos: osProdutos,
      servicos: osServicos,
      equipamentos: orcamento.equipamentos || [],
      atributos,
    };

    if (gc_usuario_id) {
      osPayload.usuario_id = gc_usuario_id;
    }
    if (orcamento.vendedor_id) {
      osPayload.vendedor_id = orcamento.vendedor_id;
    }

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
