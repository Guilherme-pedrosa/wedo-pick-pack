import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "npm:ai";
import { z } from "npm:zod@3";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createLovableAiGatewayProvider } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GC_API_URL = "https://api.gestaoclick.com";

function parseDec(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  if (s.includes(",") && s.includes(".")) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  if (s.includes(",")) return parseFloat(s.replace(",", ".")) || 0;
  return parseFloat(s) || 0;
}

interface TabelaPreco {
  tabela: string;
  valor: number;
}

interface GcDetail {
  estoque: number;
  preco_venda: number;
  valor_custo: number;
  localizacao_fisica: string;
  localizacao_rational: string;
  tabelas_preco: TabelaPreco[];
}

async function fetchGcDetail(
  produtoId: string,
  variacaoId: string | null,
  access: string,
  secret: string,
): Promise<GcDetail | null> {
  try {
    const res = await fetch(`${GC_API_URL}/api/produtos/${produtoId}`, {
      headers: {
        "access-token": access,
        "secret-access-token": secret,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const raw = json?.data?.Produto ?? json?.data?.produto ?? json?.data;
    if (!raw || typeof raw !== "object") return null;

    let estoque = parseDec(raw.estoque);
    if (variacaoId && Array.isArray(raw.variacoes)) {
      const v = raw.variacoes.find((x: any) => String(x?.variacao?.id) === String(variacaoId));
      if (v) estoque = parseDec(v.variacao.estoque);
    }

    let fisica = "";
    let rational = "";
    const atributos = Array.isArray(raw.atributos) ? raw.atributos : [];
    for (const item of atributos) {
      const campo = item?.atributo ?? item;
      const desc = String(campo?.descricao ?? "").toLowerCase().trim();
      if (desc.includes("localizacao fisica") || desc.includes("localização física")) {
        fisica = campo?.conteudo ?? "";
      } else if (desc.includes("localizacao rational") || desc.includes("localização rational")) {
        rational = campo?.conteudo ?? "";
      }
    }

    // Extract every price table (Valores de venda). For variations, prefer the
    // variation's own price tables when available; fall back to product-level.
    let valoresArr: any[] = Array.isArray(raw.valores) ? raw.valores : [];
    if (variacaoId && Array.isArray(raw.variacoes)) {
      const v = raw.variacoes.find((x: any) => String(x?.variacao?.id) === String(variacaoId));
      if (v && Array.isArray(v.variacao?.valores) && v.variacao.valores.length > 0) {
        valoresArr = v.variacao.valores;
      }
    }
    const tabelas_preco: TabelaPreco[] = valoresArr
      .map((t: any) => ({
        tabela: String(t?.nome_tipo ?? "").trim(),
        valor: parseDec(t?.valor_venda),
      }))
      .filter((t) => t.tabela);

    return {
      estoque,
      preco_venda: parseDec(raw.valor_venda ?? raw.preco),
      valor_custo: parseDec(raw.valor_custo),
      localizacao_fisica: fisica,
      localizacao_rational: rational,
      tabelas_preco,
    };
  } catch {
    return null;
  }
}

// Atributos (campos personalizados) de localização no GestãoClick
const ATRIBUTO_LOCALIZACAO_FISICA = 862832;
const ATRIBUTO_LOCALIZACAO_RATIONAL = 894023;

function normalizeStr(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function gcGet(path: string, access: string, secret: string): Promise<any | null> {
  try {
    const res = await fetch(`${GC_API_URL}${path}`, {
      headers: {
        "access-token": access,
        "secret-access-token": secret,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function gcSend(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body: unknown,
  access: string,
  secret: string,
): Promise<{ ok: boolean; json: any }> {
  const res = await fetch(`${GC_API_URL}${path}`, {
    method,
    headers: {
      "access-token": access,
      "secret-access-token": secret,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const ok = res.ok && json?.status !== "error";
  return { ok, json };
}

async function fetchGrupos(access: string, secret: string): Promise<{ id: string; nome: string }[]> {
  const out: { id: string; nome: string }[] = [];
  for (let page = 1; page <= 5; page++) {
    const j = await gcGet(`/api/grupos_produtos?pagina=${page}`, access, secret);
    const data: any[] = j?.data ?? [];
    for (const g of data) out.push({ id: String(g.id), nome: String(g.nome ?? "") });
    const tp = Number(j?.meta?.total_paginas ?? 1);
    if (page >= tp) break;
  }
  return out;
}

// As tabelas de preço (tipos de valores) são iguais para todos os produtos da conta.
// Derivamos a lista canônica a partir de um produto de referência.
async function fetchTabelasRef(access: string, secret: string): Promise<{ tipo_id: string; nome_tipo: string }[]> {
  const list = await gcGet(`/api/produtos?pagina=1`, access, secret);
  const first = list?.data?.[0];
  if (!first?.id) return [];
  const det = await gcGet(`/api/produtos/${first.id}`, access, secret);
  const valores: any[] = det?.data?.valores ?? [];
  return valores.map((v) => ({ tipo_id: String(v.tipo_id), nome_tipo: String(v.nome_tipo ?? "") }));
}

// ---------------------------------------------------------------------------
// Poda de contexto: resultados de ferramenta (GC/estoque) podem somar centenas
// de milhares de tokens e estourar o limite do modelo (HTTP 400 no gateway).
// Aqui truncamos cada resultado e mantemos apenas as últimas rodadas.
// ---------------------------------------------------------------------------
const MAX_TOOL_RESULT_CHARS = 30000;
const MAX_TOOL_RESULT_CHARS_ANTIGO = 4000;
const MAX_MENSAGENS = 24;
// O payload ainda recebe system prompt + schemas das ferramentas. Um teto alto
// aqui já produziu chamadas de 744 mil tokens, acima do limite do modelo.
const MAX_TOTAL_CHARS = 120_000;

// Trunca preservando início e fim (o fim costuma trazer totais/últimos itens).
function truncarTexto(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const cabeca = Math.floor(max * 0.75);
  const cauda = max - cabeca;
  return `${texto.slice(0, cabeca)}\n…[${texto.length - max} caracteres omitidos no meio]…\n${texto.slice(-cauda)}`;
}


function podarParte(part: any, max: number): any {
  if (!part || typeof part !== "object") return part;
  if (part.type === "tool-result" || part.type === "tool-error") {
    const bruto = typeof part.output === "string" ? part.output : JSON.stringify(part.output ?? null);
    return { ...part, output: { type: "text", value: truncarTexto(bruto, max) } };
  }
  if (part.type === "text" && typeof part.text === "string") {
    return { ...part, text: truncarTexto(part.text, Math.max(max, 8000)) };
  }
  return part;
}

function prunarMensagens(msgs: any[]): any[] {
  const tamanho = (arr: any[]) => JSON.stringify(arr).length;
  const saneadas = sanearToolCalls(msgs);

  // Contextos normais seguem intactos; apenas chamadas incompletas são limpas.
  if (tamanho(saneadas) <= MAX_TOTAL_CHARS) return saneadas;

  const recentes = saneadas.length > MAX_MENSAGENS ? saneadas.slice(-MAX_MENSAGENS) : saneadas;
  const limiteRecente = Math.max(recentes.length - 6, 0);

  let podadas = recentes.map((m, i) => {
    if (!m || !Array.isArray(m.content)) return m;
    const max = i >= limiteRecente ? MAX_TOOL_RESULT_CHARS : MAX_TOOL_RESULT_CHARS_ANTIGO;
    return { ...m, content: m.content.map((p: any) => podarParte(p, max)) };
  });

  // Rede de segurança: se ainda estiver enorme, descarta as mensagens mais antigas.
  while (podadas.length > 2 && tamanho(podadas) > MAX_TOTAL_CHARS) {
    podadas = podadas.slice(1);
  }
  return sanearToolCalls(podadas);
}


/**
 * Remove tool-calls sem tool-result correspondente (e results órfãos), que
 * acontecem quando o stream é interrompido no meio de uma chamada de tool.
 * Sem isso o SDK lança AI_MissingToolResultsError.
 */
function sanearToolCalls(msgs: any[]): any[] {
  const comResultado = new Set<string>();
  for (const m of msgs) {
    if (!Array.isArray(m?.content)) continue;
    for (const p of m.content) {
      if ((p?.type === "tool-result" || p?.type === "tool-error") && p.toolCallId) {
        comResultado.add(p.toolCallId);
      }
    }
  }

  const idsChamados = new Set<string>();
  const saida: any[] = [];
  for (const m of msgs) {
    if (!Array.isArray(m?.content)) {
      saida.push(m);
      continue;
    }
    const content = m.content.filter((p: any) => {
      if (p?.type === "tool-call") {
        if (!p.toolCallId || !comResultado.has(p.toolCallId)) return false;
        idsChamados.add(p.toolCallId);
        return true;
      }
      if (p?.type === "tool-result" || p?.type === "tool-error") {
        return p.toolCallId ? idsChamados.has(p.toolCallId) : false;
      }
      return true;
    });
    if (content.length > 0) saida.push({ ...m, content });
  }
  return saida;
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const GC_ACCESS = Deno.env.get("GC_ACCESS_TOKEN");
  const GC_SECRET = Deno.env.get("GC_SECRET_TOKEN");

  if (!LOVABLE_API_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(JSON.stringify({ error: "Credenciais não configuradas" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const { messages }: { messages: UIMessage[] } = await req.json();
    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Mensagens são obrigatórias" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const gateway = createLovableAiGatewayProvider(LOVABLE_API_KEY);

    const consultarEstoque = tool({
      description:
        "Consulta peças/produtos no estoque pelo nome, código interno ou código de barras. Retorna o saldo em estoque, preço de venda, grupo e a localização (tabela/prateleira física e rational) de cada peça encontrada.",
      inputSchema: z.object({
        termo: z.string().describe("Nome, código interno ou código de barras da peça a consultar."),
      }),
      execute: async ({ termo }) => {
        const q = termo.trim();
        if (!q) return { encontrados: 0, pecas: [] };

        let { data } = await supabase
          .from("products_index")
          .select("produto_id, nome, codigo_interno, codigo_barra, possui_variacao, payload_min_json")
          .or(
            `codigo_interno.ilike.%${q}%,codigo_barra.ilike.%${q}%,produto_id.ilike.%${q}%,nome.ilike.%${q}%`,
          )
          .eq("ativo", true)
          .order("nome")
          .limit(8);

        const rows = data ?? [];
        if (rows.length === 0) return { encontrados: 0, pecas: [] };

        // Fetch live GC detail for the top matches (respect rate limit)
        const top = rows.slice(0, 5);
        const detalhes: (GcDetail | null)[] = [];
        if (GC_ACCESS && GC_SECRET) {
          for (let i = 0; i < top.length; i += 3) {
            const batch = top.slice(i, i + 3);
            const res = await Promise.all(
              batch.map((r) => fetchGcDetail(String(r.produto_id), null, GC_ACCESS, GC_SECRET)),
            );
            detalhes.push(...res);
            if (i + 3 < top.length) await new Promise((r) => setTimeout(r, 1100));
          }
        }

        const pecas = rows.map((r, idx) => {
          const pm = (r.payload_min_json ?? {}) as Record<string, unknown>;
          const live = idx < detalhes.length ? detalhes[idx] : null;
          return {
            identificacao: r.codigo_interno ? `[${r.codigo_interno}] ${r.nome}` : r.nome,
            nome: r.nome,
            codigo_interno: r.codigo_interno ?? null,
            codigo_barras: r.codigo_barra ?? null,
            grupo: (pm.nome_grupo as string) ?? null,
            estoque: live ? live.estoque : parseDec(pm.estoque),
            preco_venda: live ? live.preco_venda : parseDec(pm.preco_venda),
            valor_custo: live ? live.valor_custo : parseDec(pm.valor_custo),
            localizacao_fisica: live?.localizacao_fisica || null,
            localizacao_rational: live?.localizacao_rational || null,
            tabelas_preco: live?.tabelas_preco ?? [],
            saldo_ao_vivo: !!live,
          };
        });

        return { encontrados: pecas.length, pecas };
      },
    });

    const cadastrarProduto = tool({
      description:
        "Cadastra um NOVO produto no estoque (GestãoClick). Cria o produto e define o preço de venda em CADA tabela informada (o GestãoClick não preenche os preços sozinho). Use APENAS depois que o usuário confirmar explicitamente todos os dados.",
      inputSchema: z.object({
        nome: z.string().describe("Nome do produto."),
        codigo_interno: z.string().optional().describe("Código interno da peça."),
        codigo_barra: z.string().optional().describe("Código de barras (opcional)."),
        grupo: z.string().describe("Nome (ou ID) do grupo/categoria do produto."),
        valor_custo: z.number().describe("Custo real do produto."),
        estoque: z.number().optional().describe("Quantidade inicial em estoque (padrão 0)."),
        ncm: z.string().optional().describe("NCM fiscal (opcional)."),
        descricao: z.string().optional().describe("Descrição (opcional)."),
        localizacao_fisica: z.string().optional().describe("Localização física (prateleira/caixa)."),
        localizacao_rational: z.string().optional().describe("Localização rational."),
        tabelas_preco: z
          .array(z.object({ tabela: z.string(), valor: z.number() }))
          .describe("Preço de venda por tabela: nome da tabela e o valor de venda."),
      }),
      execute: async (input) => {
        if (!GC_ACCESS || !GC_SECRET) {
          return { success: false, error: "Credenciais do GestãoClick não configuradas." };
        }

        // 1) Resolver grupo
        const grupos = await fetchGrupos(GC_ACCESS, GC_SECRET);
        let grupoId: string | null = null;
        if (/^\d+$/.test(input.grupo.trim())) {
          grupoId = input.grupo.trim();
        } else {
          const ng = normalizeStr(input.grupo);
          const exact = grupos.find((g) => normalizeStr(g.nome) === ng);
          const partial = grupos.filter((g) => normalizeStr(g.nome).includes(ng));
          if (exact) grupoId = exact.id;
          else if (partial.length === 1) grupoId = partial[0].id;
          else {
            return {
              success: false,
              error: `Grupo "${input.grupo}" não encontrado ou ambíguo. Peça ao usuário para escolher um grupo exato.`,
              grupos_sugeridos: (partial.length ? partial : grupos).slice(0, 15).map((g) => g.nome),
            };
          }
        }

        // 2) Resolver tabelas de preço (nome -> tipo_id)
        const ref = await fetchTabelasRef(GC_ACCESS, GC_SECRET);
        const valores: { tipo_id: string; valor_custo: string; valor_venda: string }[] = [];
        const naoEncontradas: string[] = [];
        for (const t of input.tabelas_preco) {
          const nt = normalizeStr(t.tabela);
          const m =
            ref.find((r) => normalizeStr(r.nome_tipo) === nt) ||
            ref.find((r) => normalizeStr(r.nome_tipo).includes(nt)) ||
            ref.find((r) => nt.split(/\s+/).every((w) => normalizeStr(r.nome_tipo).includes(w)));
          if (!m) {
            naoEncontradas.push(t.tabela);
            continue;
          }
          valores.push({
            tipo_id: m.tipo_id,
            valor_custo: input.valor_custo.toFixed(2),
            valor_venda: t.valor.toFixed(2),
          });
        }
        if (naoEncontradas.length) {
          return {
            success: false,
            error: `Tabelas não encontradas: ${naoEncontradas.join(", ")}.`,
            tabelas_disponiveis: ref.map((r) => r.nome_tipo),
          };
        }

        // 3) Atributos de localização
        const atributos: { atributo_id: number; conteudo: string }[] = [];
        if (input.localizacao_fisica)
          atributos.push({ atributo_id: ATRIBUTO_LOCALIZACAO_FISICA, conteudo: input.localizacao_fisica });
        if (input.localizacao_rational)
          atributos.push({ atributo_id: ATRIBUTO_LOCALIZACAO_RATIONAL, conteudo: input.localizacao_rational });

        // 4) Criar produto (POST)
        const createBody: Record<string, unknown> = {
          nome: input.nome,
          codigo_interno: input.codigo_interno ?? "",
          codigo_barra: input.codigo_barra ?? "",
          movimenta_estoque: "1",
          ativo: "1",
          grupo_id: grupoId,
          valor_custo: input.valor_custo.toFixed(2),
          estoque: String(input.estoque ?? 0),
          descricao: input.descricao ?? "",
        };
        if (input.ncm) createBody.fiscal = { ncm: input.ncm };
        if (atributos.length) createBody.atributos = atributos;

        const created = await gcSend(`/api/produtos`, "POST", createBody, GC_ACCESS, GC_SECRET);
        const produtoId = created.json?.data?.id ? String(created.json.data.id) : null;
        if (!created.ok || !produtoId) {
          return {
            success: false,
            error: `Falha ao criar o produto: ${JSON.stringify(created.json ?? {}).slice(0, 300)}`,
          };
        }

        // 5) Definir preços exatos por tabela (PUT) — o POST ignora valor_venda e usa markup padrão
        const upd = await gcSend(
          `/api/produtos/${produtoId}`,
          "PUT",
          { nome: input.nome, valor_custo: input.valor_custo.toFixed(2), valores },
          GC_ACCESS,
          GC_SECRET,
        );

        // 6) Reconferir os preços gravados
        const det = await gcGet(`/api/produtos/${produtoId}`, GC_ACCESS, GC_SECRET);
        const precos_aplicados = (det?.data?.valores ?? []).map((v: any) => ({
          tabela: String(v.nome_tipo),
          valor: parseDec(v.valor_venda),
        }));

        return {
          success: true,
          produto_id: produtoId,
          identificacao: input.codigo_interno ? `[${input.codigo_interno}] ${input.nome}` : input.nome,
          grupo: grupos.find((g) => g.id === grupoId)?.nome ?? grupoId,
          valor_custo: input.valor_custo,
          estoque: input.estoque ?? 0,
          precos_atualizados: upd.ok,
          precos_aplicados,
        };
      },
    });

    const analisarConsumo = tool({
      description:
        "Analisa o HISTÓRICO DE SAÍDAS / CONSUMO de peças (vendas e ordens de serviço já baixadas no estoque). Responde perguntas como 'quais produtos do grupo X tiveram mais saídas em 2026', 'quanto saiu da peça Y no período', 'quais os itens mais vendidos'. Filtra por grupo, produto (nome/código), tipo de documento e período. Retorna o ranking de peças por quantidade de saída, valor consumido, número de eventos e clientes distintos.",
      inputSchema: z.object({
        grupo: z.string().optional().describe("Nome (ou parte) do grupo/categoria. Ex: 'ESPECÍFICO - HOBART', 'hobart'."),
        termo: z.string().optional().describe("Nome, código interno ou código de barras de uma peça específica."),
        data_inicio: z.string().optional().describe("Data inicial no formato YYYY-MM-DD. Para 'em 2026' use 2026-01-01."),
        data_fim: z.string().optional().describe("Data final no formato YYYY-MM-DD. Para 'em 2026' use 2026-12-31."),
        tipo: z.enum(["os", "venda", "todos"]).optional().describe("Tipo de documento: 'venda', 'os' ou 'todos' (padrão)."),
        limite: z.number().optional().describe("Quantos produtos retornar no ranking (padrão 20, máx 50)."),
      }),
      execute: async ({ grupo, termo, data_inicio, data_fim, tipo, limite }) => {
        const lim = Math.min(Math.max(limite ?? 20, 1), 50);

        // 1) Se houver filtro de grupo ou termo, resolver os produto_ids no índice.
        //    Grupo é filtrado em memória (accent-insensitive, por tokens) pois o nome do
        //    grupo tem acentos/espaços (ex: "ESPECÍFICO - HOBART").
        let restrictIds: string[] | null = null;
        const infoMap = new Map<string, { nome: string; codigo: string | null; grupo: string | null }>();
        if (grupo || termo) {
          const grupoTokens = grupo ? normalizeStr(grupo).split(/[^a-z0-9]+/).filter(Boolean) : [];
          const matched: any[] = [];

          if (grupo) {
            // Percorre o índice em páginas e filtra por tokens do grupo.
            const PAGE_IDX = 1000;
            let fromIdx = 0;
            while (true) {
              let idxQ = supabase
                .from("products_index")
                .select("produto_id, nome, codigo_interno, codigo_barra, payload_min_json")
                .eq("ativo", true)
                .range(fromIdx, fromIdx + PAGE_IDX - 1);
              if (termo) {
                const t = termo.trim();
                idxQ = idxQ.or(
                  `codigo_interno.ilike.%${t}%,codigo_barra.ilike.%${t}%,produto_id.ilike.%${t}%,nome.ilike.%${t}%`,
                );
              }
              const { data: idxRows } = await idxQ;
              const rows = idxRows ?? [];
              for (const r of rows) {
                const pm = (r.payload_min_json ?? {}) as Record<string, unknown>;
                const g = normalizeStr(pm.nome_grupo);
                if (grupoTokens.every((tk) => g.includes(tk))) matched.push(r);
              }
              if (rows.length < PAGE_IDX) break;
              fromIdx += PAGE_IDX;
              if (fromIdx >= 20000) break;
            }
          } else if (termo) {
            const t = termo.trim();
            const { data: idxRows } = await supabase
              .from("products_index")
              .select("produto_id, nome, codigo_interno, codigo_barra, payload_min_json")
              .eq("ativo", true)
              .or(
                `codigo_interno.ilike.%${t}%,codigo_barra.ilike.%${t}%,produto_id.ilike.%${t}%,nome.ilike.%${t}%`,
              )
              .limit(500);
            matched.push(...(idxRows ?? []));
          }

          restrictIds = matched.map((r: any) => String(r.produto_id));
          for (const r of matched) {
            const pm = (r.payload_min_json ?? {}) as Record<string, unknown>;
            infoMap.set(String(r.produto_id), {
              nome: r.nome,
              codigo: r.codigo_interno ?? null,
              grupo: (pm.nome_grupo as string) ?? null,
            });
          }
          if (restrictIds.length === 0) {
            return { total_pecas: 0, ranking: [], aviso: "Nenhuma peça encontrada para esse grupo/termo." };
          }
        }


        // 2) Buscar eventos de consumo (paginado), aplicando filtros
        const agg = new Map<string, { produto_id: string; qtd: number; qtd_venda: number; qtd_os: number; valor: number; eventos: number; eventos_venda: number; eventos_os: number; clientes: Set<string> }>();
        const PAGE = 1000;
        let fromRow = 0;
        let totalEventos = 0;
        let totalVendaQtd = 0;
        let totalOsQtd = 0;
        let totalVendaEventos = 0;
        let totalOsEventos = 0;
        // .in é limitado — quando a lista é grande, filtramos em memória
        const useInFilter = restrictIds !== null && restrictIds.length <= 300;
        const idSet = restrictIds !== null ? new Set(restrictIds) : null;

        while (true) {
          let q = supabase
            .from("inventory_consumption_events")
            .select("produto_id, qty, valor_custo, occurred_at, source_type, cliente_nome")
            .order("occurred_at", { ascending: false })
            .range(fromRow, fromRow + PAGE - 1);
          if (data_inicio) q = q.gte("occurred_at", data_inicio);
          if (data_fim) q = q.lte("occurred_at", `${data_fim}T23:59:59`);
          if (tipo && tipo !== "todos") q = q.eq("source_type", tipo);
          if (useInFilter && restrictIds) q = q.in("produto_id", restrictIds);

          const { data: evRows, error } = await q;
          if (error) return { erro: error.message };
          const rows = evRows ?? [];
          for (const r of rows) {
            const pid = String(r.produto_id);
            if (idSet && !idSet.has(pid)) continue;
            const qty = parseDec(r.qty);
            if (qty <= 0) continue;
            const isVenda = String(r.source_type) === "venda";
            totalEventos++;
            if (isVenda) { totalVendaQtd += qty; totalVendaEventos++; }
            else { totalOsQtd += qty; totalOsEventos++; }
            const cur = agg.get(pid) ?? { produto_id: pid, qtd: 0, qtd_venda: 0, qtd_os: 0, valor: 0, eventos: 0, eventos_venda: 0, eventos_os: 0, clientes: new Set<string>() };
            cur.qtd += qty;
            if (isVenda) { cur.qtd_venda += qty; cur.eventos_venda += 1; }
            else { cur.qtd_os += qty; cur.eventos_os += 1; }
            cur.valor += parseDec(r.valor_custo) * qty;
            cur.eventos += 1;
            if (r.cliente_nome) cur.clientes.add(String(r.cliente_nome).toLowerCase().trim());
            agg.set(pid, cur);
          }
          if (rows.length < PAGE) break;
          fromRow += PAGE;
          if (fromRow >= 20000) break; // teto de segurança
        }


        if (agg.size === 0) {
          return { total_pecas: 0, ranking: [], aviso: "Nenhuma saída encontrada com esses filtros." };
        }

        // 3) Resolver nomes para produtos que ainda não estão no infoMap
        const missing = [...agg.keys()].filter((id) => !infoMap.has(id));
        for (let i = 0; i < missing.length; i += 200) {
          const batch = missing.slice(i, i + 200);
          const { data: nmeta } = await supabase
            .from("products_index")
            .select("produto_id, nome, codigo_interno, payload_min_json")
            .in("produto_id", batch);
          for (const r of nmeta ?? []) {
            const pm = (r.payload_min_json ?? {}) as Record<string, unknown>;
            infoMap.set(String(r.produto_id), {
              nome: r.nome,
              codigo: r.codigo_interno ?? null,
              grupo: (pm.nome_grupo as string) ?? null,
            });
          }
        }

        const r2 = (n: number) => Math.round(n * 100) / 100;
        const ranking = [...agg.values()]
          .sort((a, b) => b.qtd - a.qtd)
          .slice(0, lim)
          .map((r) => {
            const info = infoMap.get(r.produto_id);
            const nome = info?.nome ?? `Produto ${r.produto_id}`;
            return {
              identificacao: info?.codigo ? `[${info.codigo}] ${nome}` : nome,
              grupo: info?.grupo ?? null,
              quantidade_saida: r2(r.qtd),
              quantidade_vendas: r2(r.qtd_venda),
              quantidade_os: r2(r.qtd_os),
              valor_consumido: r2(r.valor),
              eventos: r.eventos,
              eventos_vendas: r.eventos_venda,
              eventos_os: r.eventos_os,
              clientes_distintos: r.clientes.size,
            };
          });

        return {
          total_pecas: agg.size,
          total_eventos: totalEventos,
          resumo_por_tipo: {
            vendas: { quantidade: r2(totalVendaQtd), eventos: totalVendaEventos },
            os: { quantidade: r2(totalOsQtd), eventos: totalOsEventos },
          },
          periodo: { inicio: data_inicio ?? "início dos registros", fim: data_fim ?? "hoje" },
          tipo: tipo ?? "todos",
          grupo_filtrado: grupo ?? null,
          ranking,
        };
      },

    });



    const consultarPedidosCompra = tool({
      description:
        "Consulta pedidos de compra/reposição e sugestões de reposição por peça, código interno, nome, grupo ou fornecedor. Use para responder se existe pedido em aberto, compra em andamento, previsão de chegada, compras já feitas, últimas compras, quantidade comprada e situação do pedido de compra.",
      inputSchema: z.object({
        termo: z.string().optional().describe("Nome, código interno, código de barras ou ID da peça. Ex: '22.00.985P', 'MOTOR SHAFT JUNTA D15'."),
        grupo: z.string().optional().describe("Nome ou parte do grupo/categoria. Ex: 'RATIONAL'."),
        fornecedor: z.string().optional().describe("Nome ou parte do fornecedor."),
        apenas_abertos: z.boolean().optional().describe("Quando true, retorna principalmente pedidos ainda não finalizados/cancelados."),
        data_inicio: z.string().optional().describe("Data inicial de emissão no formato YYYY-MM-DD."),
        data_fim: z.string().optional().describe("Data final de emissão no formato YYYY-MM-DD."),
        limite: z.number().optional().describe("Quantos pedidos/linhas retornar (padrão 20, máx 80)."),
      }),
      execute: async ({ termo, grupo, fornecedor, apenas_abertos, data_inicio, data_fim, limite }) => {
        const lim = Math.min(Math.max(limite ?? 20, 1), 80);
        const qTerm = termo?.trim() ?? "";
        const qNorm = normalizeStr(qTerm);
        const grupoTokens = grupo ? normalizeStr(grupo).split(/[^a-z0-9]+/).filter(Boolean) : [];
        const fornecedorNorm = fornecedor ? normalizeStr(fornecedor) : "";

        const productIds = new Set<string>();
        const productInfo = new Map<string, { nome: string; codigo: string | null; grupo: string | null }>();

        if (qTerm || grupo) {
          const PAGE_IDX = 1000;
          let fromIdx = 0;
          while (true) {
            let idxQ = supabase
              .from("products_index")
              .select("produto_id, nome, codigo_interno, codigo_barra, payload_min_json")
              .eq("ativo", true)
              .range(fromIdx, fromIdx + PAGE_IDX - 1);
            if (qTerm) {
              idxQ = idxQ.or(
                `codigo_interno.ilike.%${qTerm}%,codigo_barra.ilike.%${qTerm}%,produto_id.ilike.%${qTerm}%,nome.ilike.%${qTerm}%`,
              );
            }
            const { data: idxRows } = await idxQ;
            const rows = idxRows ?? [];
            for (const r of rows) {
              const pm = (r.payload_min_json ?? {}) as Record<string, unknown>;
              const g = normalizeStr(pm.nome_grupo);
              if (grupoTokens.length && !grupoTokens.every((tk) => g.includes(tk))) continue;
              const pid = String(r.produto_id);
              productIds.add(pid);
              productInfo.set(pid, {
                nome: String(r.nome ?? ""),
                codigo: r.codigo_interno ? String(r.codigo_interno) : null,
                grupo: (pm.nome_grupo as string) ?? null,
              });
            }
            if (!grupo || rows.length < PAGE_IDX) break;
            fromIdx += PAGE_IDX;
            if (fromIdx >= 20000) break;
          }
        }

        function isClosedStatus(status: unknown): boolean {
          const s = normalizeStr(status);
          return s.includes("finalizado") || s.includes("mercadoria chegou") || s.includes("cancelad") || s.includes("concretizado");
        }

        function matchProductLine(p: any): boolean {
          if (!qTerm && !grupoTokens.length) return true;
          const pid = String(p?.produto_id ?? "").trim();
          if (pid && productIds.has(pid)) return true;
          const name = normalizeStr(p?.nome_produto);
          if (qNorm && name.includes(qNorm)) return true;
          if (qNorm && normalizeStr(pid).includes(qNorm)) return true;
          return false;
        }

        const linhas: any[] = [];
        const resumoPorSituacao = new Map<string, { pedidos: Set<string>; quantidade: number; valor: number }>();
        let totalPedidosInspecionados = 0;
        let totalLinhasEncontradas = 0;
        let qtdTotal = 0;
        let qtdAberta = 0;
        let qtdFechada = 0;
        let valorTotalItens = 0;
        const pedidosAbertos = new Set<string>();
        const pedidosFechados = new Set<string>();

        const PAGE = 1000;
        let fromRow = 0;
        while (true) {
          let pcQ = supabase
            .from("pedidos_compra")
            .select("gc_id, codigo, fornecedor_id, nome_fornecedor, data_emissao, nome_situacao, situacao_id, numero_nfe, valor_total, payload, updated_at")
            .order("data_emissao", { ascending: false })
            .range(fromRow, fromRow + PAGE - 1);
          if (data_inicio) pcQ = pcQ.gte("data_emissao", data_inicio);
          if (data_fim) pcQ = pcQ.lte("data_emissao", data_fim);
          if (fornecedorNorm) pcQ = pcQ.ilike("nome_fornecedor", `%${fornecedor}%`);
          const { data: pcRows, error } = await pcQ;
          if (error) return { erro: error.message };
          const rows = pcRows ?? [];
          totalPedidosInspecionados += rows.length;
          for (const pc of rows) {
            const status = pc.nome_situacao ?? "Sem situação";
            const fechado = isClosedStatus(status);
            if (apenas_abertos && fechado) continue;
            const produtos = Array.isArray((pc.payload as any)?.produtos) ? (pc.payload as any).produtos : [];
            for (const prod of produtos) {
              if (!matchProductLine(prod)) continue;
              const qtd = parseDec(prod?.quantidade);
              const valorUnit = parseDec(prod?.valor_custo);
              const valor = parseDec(prod?.valor_total) || qtd * valorUnit;
              const pid = String(prod?.produto_id ?? "").trim();
              const info = pid ? productInfo.get(pid) : null;
              const nomeProduto = String(prod?.nome_produto ?? info?.nome ?? "Produto sem nome");
              const identificacao = info?.codigo ? `[${info.codigo}] ${nomeProduto}` : nomeProduto;
              const pedidoKey = String(pc.gc_id ?? pc.codigo ?? "");

              totalLinhasEncontradas++;
              qtdTotal += qtd;
              valorTotalItens += valor;
              if (fechado) {
                qtdFechada += qtd;
                pedidosFechados.add(pedidoKey);
              } else {
                qtdAberta += qtd;
                pedidosAbertos.add(pedidoKey);
              }
              const sit = resumoPorSituacao.get(String(status)) ?? { pedidos: new Set<string>(), quantidade: 0, valor: 0 };
              sit.pedidos.add(pedidoKey);
              sit.quantidade += qtd;
              sit.valor += valor;
              resumoPorSituacao.set(String(status), sit);

              linhas.push({
                pedido_codigo: pc.codigo ?? null,
                pedido_gc_id: pc.gc_id ?? null,
                data_emissao: pc.data_emissao ?? null,
                situacao: status,
                em_aberto: !fechado,
                fornecedor: pc.nome_fornecedor ?? null,
                numero_nfe: pc.numero_nfe ?? null,
                produto_identificacao: identificacao,
                produto_id: pid || null,
                quantidade: Math.round(qtd * 100) / 100,
                valor_custo_unitario: Math.round(valorUnit * 100) / 100,
                valor_total_item: Math.round(valor * 100) / 100,
              });
            }
          }
          if (rows.length < PAGE) break;
          fromRow += PAGE;
          if (fromRow >= 12000) break;
        }

        const sugestoes: any[] = [];
        if (qTerm || grupo) {
          let sugQ = supabase
            .from("inventory_purchase_suggestions")
            .select("produto_id, nome, codigo_interno, grupo, estoque_atual, consumo_12m, consumo_3m, abc_class, xyz_class, lead_time_days, reorder_point, pc_aberta_qty, saldo_projetado, qty_sugerida, risk_score, motivos, alertas, aprovado, gc_compra_id, created_at")
            .order("created_at", { ascending: false })
            .limit(80);
          const ids = [...productIds].slice(0, 300);
          if (ids.length) sugQ = sugQ.in("produto_id", ids);
          else if (qTerm) sugQ = sugQ.or(`codigo_interno.ilike.%${qTerm}%,nome.ilike.%${qTerm}%,produto_id.ilike.%${qTerm}%`);
          const { data: sugRows } = await sugQ;
          for (const s of sugRows ?? []) {
            if (grupoTokens.length && !grupoTokens.every((tk) => normalizeStr(s.grupo).includes(tk))) continue;
            sugestoes.push({
              identificacao: s.codigo_interno ? `[${s.codigo_interno}] ${s.nome}` : s.nome,
              grupo: s.grupo,
              estoque_atual: parseDec(s.estoque_atual),
              pc_aberta_qty: parseDec(s.pc_aberta_qty),
              saldo_projetado: parseDec(s.saldo_projetado),
              qty_sugerida: parseDec(s.qty_sugerida),
              consumo_12m: parseDec(s.consumo_12m),
              consumo_3m: parseDec(s.consumo_3m),
              curva_abc: s.abc_class,
              lead_time_days: parseDec(s.lead_time_days),
              ponto_reposicao: parseDec(s.reorder_point),
              risk_score: parseDec(s.risk_score),
              aprovado: s.aprovado,
              compra_gc_id: s.gc_compra_id,
              motivos: s.motivos,
              alertas: s.alertas,
              gerado_em: s.created_at,
            });
            if (sugestoes.length >= Math.min(lim, 30)) break;
          }
        }

        const r2 = (n: number) => Math.round(n * 100) / 100;
        // Prioriza pedidos EM ABERTO e mais recentes antes de cortar no limite,
        // para nunca esconder um pedido "em trânsito" (ex: COMPRADO - AG CHEGADA).
        linhas.sort((a, b) => {
          if (a.em_aberto !== b.em_aberto) return a.em_aberto ? -1 : 1;
          return String(b.data_emissao ?? "").localeCompare(String(a.data_emissao ?? ""));
        });
        const linhasLimitadas = linhas.slice(0, lim);
        return {
          filtros: {
            termo: qTerm || null,
            grupo: grupo ?? null,
            fornecedor: fornecedor ?? null,
            apenas_abertos: !!apenas_abertos,
            periodo: { inicio: data_inicio ?? "início dos registros", fim: data_fim ?? "hoje" },
          },
          total_pedidos_inspecionados: totalPedidosInspecionados,
          total_linhas_encontradas: totalLinhasEncontradas,
          resumo: {
            quantidade_total_comprada: r2(qtdTotal),
            quantidade_em_pedidos_abertos: r2(qtdAberta),
            quantidade_em_pedidos_fechados: r2(qtdFechada),
            valor_total_itens: r2(valorTotalItens),
            pedidos_abertos: pedidosAbertos.size,
            pedidos_fechados: pedidosFechados.size,
            existe_pedido_em_aberto: pedidosAbertos.size > 0,
          },
          resumo_por_situacao: [...resumoPorSituacao.entries()].map(([situacao, v]) => ({
            situacao,
            pedidos: v.pedidos.size,
            quantidade: r2(v.quantidade),
            valor: r2(v.valor),
          })),
          pedidos: linhasLimitadas,
          sugestoes_reposicao: sugestoes,
          aviso: totalLinhasEncontradas === 0 ? "Nenhum pedido de compra encontrado com esses filtros." : null,
        };
      },
    });

    // Mapa de entidades amigáveis -> endpoint da API do GestãoClick.
    const GC_ENTIDADES: Record<string, string> = {
      os: "ordens_servicos",
      ordem_servico: "ordens_servicos",
      ordens_servico: "ordens_servicos",
      ordens_servicos: "ordens_servicos",
      venda: "vendas",
      vendas: "vendas",
      orcamento: "orcamentos",
      orcamentos: "orcamentos",
      compra: "compras",
      compras: "compras",
      produto: "produtos",
      produtos: "produtos",
      servico: "servicos",
      servicos: "servicos",
      cliente: "clientes",
      clientes: "clientes",
      fornecedor: "fornecedores",
      fornecedores: "fornecedores",
      tecnico: "clientes",
      tecnicos: "clientes",
      funcionario: "funcionarios",
      funcionarios: "funcionarios",
      usuario: "usuarios",
      usuarios: "usuarios",
      recebimento: "recebimentos",
      recebimentos: "recebimentos",
      pagamento: "pagamentos",
      pagamentos: "pagamentos",
      conta_receber: "recebimentos",
      contas_receber: "recebimentos",
      conta_pagar: "pagamentos",
      contas_pagar: "pagamentos",
      nfe: "nfes",
      nfes: "nfes",
      nota_fiscal: "nfes",
      grupo: "grupos_produtos",
      grupos: "grupos_produtos",
      forma_pagamento: "formas_pagamentos",
      formas_pagamento: "formas_pagamentos",
      centro_custo: "centros_custos",
      centros_custo: "centros_custos",
      situacao: "situacoes",
      situacoes: "situacoes",
      transportadora: "transportadoras",
      transportadoras: "transportadoras",
      banco: "bancos",
      bancos: "bancos",
    };

    async function gcGetRaw(path: string): Promise<{ ok: boolean; status: number; json: any }> {
      try {
        const res = await fetch(`${GC_API_URL}${path}`, {
          headers: {
            "access-token": GC_ACCESS!,
            "secret-access-token": GC_SECRET!,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        });
        let json: any = null;
        try { json = await res.json(); } catch { json = null; }
        return { ok: res.ok, status: res.status, json };
      } catch (e) {
        return { ok: false, status: 0, json: { error: e instanceof Error ? e.message : String(e) } };
      }
    }

    const consultarGestaoClick = tool({
      description:
        "Acesso GERAL de LEITURA ao ERP GestãoClick (GC). Consulta QUALQUER módulo/entidade: ordens de serviço (OS), vendas, orçamentos, compras, produtos, serviços, clientes, fornecedores, técnicos, funcionários, usuários, recebimentos (contas a receber), pagamentos (contas a pagar), notas fiscais (NFe), grupos, formas de pagamento, centros de custo, situações, transportadoras, bancos. Use para responder QUALQUER pergunta sobre dados do GC que as outras ferramentas não cubram. Pode listar com filtros ou buscar um registro específico por ID.",
      inputSchema: z.object({
        entidade: z.string().describe("O que consultar. Ex: 'os', 'venda', 'orcamento', 'cliente', 'fornecedor', 'tecnico', 'recebimento', 'pagamento', 'nfe', 'produto', 'servico', 'usuario', 'situacao'."),
        id: z.string().optional().describe("ID do registro específico para trazer o detalhe completo. Se informado, ignora os filtros de lista."),
        filtros: z.record(z.string()).optional().describe("Filtros da API do GC como pares chave/valor. Ex: {nome:'João'}, {data_inicio:'2026-01-01', data_fim:'2026-12-31'}, {cliente_id:'123'}, {situacao_id:'456'}, {codigo:'OS123'}. Passe apenas parâmetros suportados pela API do GC."),
        pagina: z.number().optional().describe("Página da listagem (padrão 1)."),
        max_paginas: z.number().optional().describe("Quantas páginas percorrer no máximo (padrão 1, máx 10). Use >1 para varrer mais registros."),
      }),
      execute: async ({ entidade, id, filtros, pagina, max_paginas }) => {
        if (!GC_ACCESS || !GC_SECRET) {
          return { erro: "Credenciais do GestãoClick não configuradas." };
        }
        const key = normalizeStr(entidade).replace(/\s+/g, "_");
        const endpoint = GC_ENTIDADES[key] ?? GC_ENTIDADES[key.replace(/s$/, "")] ?? key;

        // Detalhe por ID
        if (id) {
          const det = await gcGetRaw(`/api/${endpoint}/${encodeURIComponent(id)}`);
          if (!det.ok) {
            return { erro: `Falha ao buscar ${entidade} id ${id} (HTTP ${det.status}).`, resposta: det.json };
          }
          return { entidade: endpoint, id, registro: det.json?.data ?? det.json };
        }

        // Listagem com filtros e paginação
        const baseParams = new URLSearchParams();
        for (const [k, v] of Object.entries(filtros ?? {})) {
          if (v != null && String(v).trim() !== "") baseParams.set(k, String(v));
        }
        const startPage = Math.max(pagina ?? 1, 1);
        const maxPages = Math.min(Math.max(max_paginas ?? 1, 1), 10);

        const registros: any[] = [];
        let totalPaginas = 1;
        let totalRegistros: number | null = null;
        let lastErr: any = null;

        for (let i = 0; i < maxPages; i++) {
          const p = startPage + i;
          const params = new URLSearchParams(baseParams);
          params.set("pagina", String(p));
          const resp = await gcGetRaw(`/api/${endpoint}?${params.toString()}`);
          if (!resp.ok) {
            lastErr = { status: resp.status, resposta: resp.json };
            break;
          }
          const data = Array.isArray(resp.json?.data) ? resp.json.data : [];
          for (const row of data) {
            // GC costuma aninhar: { Cliente: {...} } etc. Achatamos quando possível.
            const flat = row && typeof row === "object" && Object.keys(row).length === 1
              ? (Object.values(row)[0] as any) ?? row
              : row;
            registros.push(flat);
          }
          totalPaginas = Number(resp.json?.meta?.total_paginas ?? totalPaginas);
          if (resp.json?.meta?.total_registros != null) totalRegistros = Number(resp.json.meta.total_registros);
          if (data.length === 0 || p >= totalPaginas) break;
          if (i + 1 < maxPages) await new Promise((r) => setTimeout(r, 350));
        }

        if (registros.length === 0 && lastErr) {
          return {
            entidade: endpoint,
            erro: `Falha ao consultar ${entidade} (HTTP ${lastErr.status}). Verifique a entidade/filtros.`,
            resposta: lastErr.resposta,
          };
        }

        return {
          entidade: endpoint,
          total_registros: totalRegistros,
          total_paginas: totalPaginas,
          pagina_inicial: startPage,
          quantidade_retornada: registros.length,
          registros: registros.slice(0, 100),
          aviso: registros.length === 0 ? "Nenhum registro encontrado com esses filtros." : null,
        };
      },
    });

    const consultarVendasDaPeca = tool({
      description:
        "Retorna as VENDAS e/ou ORDENS DE SERVIÇO (OS) reais de UMA peça específica a partir do histórico de consumo sincronizado e tenta confirmar cada documento ao vivo no GestãoClick. Use SEMPRE que o usuário perguntar 'qual a última venda dessa peça', 'em qual venda/OS ela saiu', 'histórico de vendas dessa peça', 'quem comprou', etc. O campo 'verificado' indica que a peça consta no histórico sincronizado e/ou no documento ao vivo. 'verificado_ao_vivo' indica confirmação no payload atual do GC. NUNCA diga que não houve venda/OS quando houver documentos com verificado=true.",
      inputSchema: z.object({
        termo: z.string().describe("Nome, código interno, código de barras ou ID da peça. Ex: '40.00.091S', 'JUNTA FRAME W.GLASS'."),
        tipo: z.enum(["venda", "os", "todos"]).optional().describe("Tipo de documento: 'venda', 'os' ou 'todos' (padrão)."),
        limite: z.number().optional().describe("Quantos documentos (mais recentes) verificar. Padrão 5, máx 12."),
      }),
      execute: async ({ termo, tipo, limite }) => {
        if (!GC_ACCESS || !GC_SECRET) return { erro: "Credenciais do GestãoClick não configuradas." };
        const lim = Math.min(Math.max(limite ?? 5, 1), 12);
        const q = termo.trim();
        if (!q) return { erro: "Informe a peça." };

        // 1) Resolver produto_ids da peça
        const { data: idxRows } = await supabase
          .from("products_index")
          .select("produto_id, nome, codigo_interno, codigo_barra")
          .eq("ativo", true)
          .or(`codigo_interno.ilike.%${q}%,codigo_barra.ilike.%${q}%,produto_id.ilike.%${q}%,nome.ilike.%${q}%`)
          .limit(20);
        const matched = idxRows ?? [];
        if (matched.length === 0) return { encontrados: 0, aviso: "Peça não localizada no índice." };

        const idSet = new Set(matched.map((r: any) => String(r.produto_id)));
        const info = matched[0] as any;
        const identificacao = info.codigo_interno ? `[${info.codigo_interno}] ${info.nome}` : info.nome;
        const codigoInterno = matched.map((r: any) => String(r.codigo_interno ?? "")).filter(Boolean);

        // 2) Buscar eventos de consumo da peça (mais recentes primeiro)
        const fetchEventos = async (tipoFiltro?: "venda" | "os" | "todos") => {
          let evQ = supabase
            .from("inventory_consumption_events")
            .select("produto_id, qty, occurred_at, source_id, source_type, cliente_nome, raw")
            .in("produto_id", [...idSet])
            .order("occurred_at", { ascending: false })
            .limit(60);
          if (tipoFiltro && tipoFiltro !== "todos") evQ = evQ.eq("source_type", tipoFiltro);
          return await evQ;
        };

        let tipoConsultaEfetiva = tipo ?? "todos";
        let { data: evRows, error } = await fetchEventos(tipoConsultaEfetiva);
        if (error) return { erro: error.message };
        let eventos = evRows ?? [];
        // No contexto operacional do estoque, "venda" normalmente significa saída
        // total da peça (Venda + OS). Se não houver venda comercial direta, não
        // podemos concluir "não vendeu" sem olhar OS também.
        if (eventos.length === 0 && tipoConsultaEfetiva === "venda") {
          const fallback = await fetchEventos("todos");
          if (fallback.error) return { erro: fallback.error.message };
          eventos = fallback.data ?? [];
          if (eventos.length > 0) tipoConsultaEfetiva = "todos";
        }
        if (eventos.length === 0) {
          return { peca: identificacao, encontrados: 0, aviso: "Nenhuma venda/OS registrada para essa peça no histórico." };
        }

        // 3) Distintos source_id (doc) preservando ordem por data desc
        const vistos = new Set<string>();
        const docs: { source_id: string; source_type: string; occurred_at: string; cliente_nome: string | null; qty_historico: number; raw_historico: any | null }[] = [];
        for (const e of eventos) {
          const sid = String(e.source_id ?? "");
          if (!sid) continue;
          if (vistos.has(sid)) {
            const existing = docs.find((d) => d.source_id === sid && d.source_type === String(e.source_type));
            if (existing) existing.qty_historico += parseDec(e.qty);
            continue;
          }
          vistos.add(sid);
          docs.push({
            source_id: sid,
            source_type: String(e.source_type),
            occurred_at: e.occurred_at,
            cliente_nome: e.cliente_nome,
            qty_historico: parseDec(e.qty),
            raw_historico: e.raw ?? null,
          });
          if (docs.length >= lim) break;
        }

        // 4) Verificar cada doc ao vivo no GC e confirmar a linha da peça
        function normCode(s: unknown): string { return String(s ?? "").replace(/\s+/g, "").toLowerCase(); }
        const codeSet = new Set(codigoInterno.map((c) => normCode(c)));
        function extractProductLines(doc: any): any[] {
          const arrays = [
            doc?.produtos,
            doc?.itens,
            doc?.items,
            doc?.produtos_servicos,
            doc?.servicos_produtos,
            doc?.produtos_os,
            doc?.produtos_venda,
          ].filter(Array.isArray) as any[][];
          const out: any[] = [];
          for (const arr of arrays) {
            for (const item of arr) out.push(item?.produto ?? item?.Produto ?? item?.item ?? item);
          }
          return out;
        }
        function lineMatchesPiece(p: any): boolean {
          const pid = String(p?.produto_id ?? p?.id_produto ?? p?.id ?? "");
          const pcode = normCode(p?.codigo_interno ?? p?.codigo ?? p?.codigo_produto);
          const pname = normalizeStr(p?.nome_produto ?? p?.nome ?? p?.descricao);
          return idSet.has(pid) || (pcode && codeSet.has(pcode)) || (codigoInterno.length > 0 && codigoInterno.some((c) => pname.includes(normalizeStr(c))));
        }
        const resultados: any[] = [];
        for (const d of docs) {
          const endpoint = d.source_type === "os" ? "ordens_servicos" : "vendas";
          const det = await gcGetRaw(`/api/${endpoint}/${encodeURIComponent(d.source_id)}`);
          const raw = det.json?.data ?? det.json;
          const doc = raw && typeof raw === "object" && Object.keys(raw).length === 1 ? Object.values(raw)[0] as any : raw;
          const produtos = extractProductLines(doc);
          const linha = produtos.find(lineMatchesPiece) ?? null;
          const rawLinha = d.raw_historico && typeof d.raw_historico === "object" ? d.raw_historico : null;
          const linhaConfirmada = linha ?? rawLinha;
          const codigoDoc = doc?.codigo ?? doc?.numero ?? doc?.numero_venda ?? null;
          const verificadoAoVivo = !!linha;
          const confirmadoHistorico = !!rawLinha;
          const verificado = verificadoAoVivo || confirmadoHistorico;
          resultados.push({
            tipo: d.source_type,
            gc_id: d.source_id,
            numero_documento: codigoDoc,
            data: doc?.data ?? doc?.data_saida ?? doc?.data_entrada ?? d.occurred_at,
            cliente: doc?.nome_cliente ?? doc?.cliente?.nome ?? d.cliente_nome ?? null,
            situacao: doc?.nome_situacao ?? null,
            verificado,
            verificado_ao_vivo: verificadoAoVivo,
            confirmado_historico: confirmadoHistorico,
            quantidade: linha ? parseDec(linha.quantidade) : d.qty_historico,
            valor_unitario: linhaConfirmada ? parseDec(linhaConfirmada.valor_venda ?? linhaConfirmada.valor ?? linhaConfirmada.valor_unitario) : null,
            valor_total: linhaConfirmada ? parseDec(linhaConfirmada.valor_total) || (parseDec(linhaConfirmada.valor_venda ?? linhaConfirmada.valor ?? linhaConfirmada.valor_unitario) * d.qty_historico) : null,
            aviso_verificacao: linha
              ? null
              : (confirmadoHistorico
                ? "Confirmado pelo histórico de consumo/movimentações sincronizado; a linha não apareceu no payload atual do documento ao vivo. Pode citar a saída, mas deixe claro que a confirmação veio do histórico sincronizado."
                : det.ok
                ? "A peça NÃO foi encontrada nas linhas deste documento ao vivo nem no histórico bruto — NÃO cite este documento como venda da peça."
                : `Não foi possível carregar o documento ao vivo (HTTP ${det.status}).`),
          });
          await new Promise((r) => setTimeout(r, 350));
        }

        const verificados = resultados.filter((r) => r.verificado);
        return {
          peca: identificacao,
          tipo_consulta_efetiva: tipoConsultaEfetiva,
          aviso_tipo: tipo === "venda" && tipoConsultaEfetiva === "todos"
            ? "Não havia venda comercial direta no histórico filtrado; foram retornadas saídas por OS também, pois no estoque 'vendas' significa OS + venda."
            : null,
          total_documentos_no_historico: vistos.size,
          documentos_verificados: verificados.length,
          documentos: resultados,
          ultima_venda_os_confirmada: verificados[0] ?? null,
          aviso: verificados.length === 0
            ? "Nenhum documento foi confirmado contendo esta peça. NÃO afirme em qual venda/OS ela saiu."
            : null,
        };
      },
    });

    const result = streamText({
      model: gateway("google/gemini-3-flash-preview"),
      stopWhen: stepCountIs(50),
      system: [
        "Você é a IA Especialista de Estoque da empresa (ERP WeDo).",
        "Responda SEMPRE em português do Brasil, de forma direta e objetiva.",
        "Quando o usuário perguntar sobre saldo, quantidade, localização (tabela/prateleira) ou preço de uma peça, use a ferramenta consultar_estoque para buscar os dados reais. NUNCA invente saldos.",
        "REGRA CRÍTICA ANTI-ALUCINAÇÃO DE SALDO: você está TERMINANTEMENTE PROIBIDO de afirmar QUALQUER número de estoque/saldo que não tenha vindo LITERALMENTE do campo 'estoque' retornado pela ferramenta consultar_estoque naquele mesmo turno. NUNCA estime, arredonde, deduza, lembre de valores anteriores nem 'chute' saldo. Se você não chamou consultar_estoque para uma peça específica, você NÃO sabe o saldo dela — chame a ferramenta antes de dizer qualquer quantidade.",
        "REVISÃO DE LISTAS DE COMPRA/REPOSIÇÃO: quando o usuário colar uma lista de itens e pedir para revisar, comparar com o estoque, dizer o que remover/reduzir ou se há excesso, você DEVE chamar consultar_estoque para CADA item da lista, um a um, e usar SOMENTE o saldo real retornado. É PROIBIDO comentar sobre o estoque de um item sem ter o resultado da ferramenta para ele. Se a ferramenta não retornar uma peça, diga explicitamente 'saldo não confirmado' para ela — nunca preencha com um número inventado.",
        "Sempre identifique a peça no formato [Código Interno] Nome do Produto.",
        "Formate valores em reais no padrão brasileiro (R$ 1.234,56 com vírgula decimal).",
        "Cada peça retorna o campo 'tabelas_preco', que é a lista COMPLETA de tabelas de preço (nome da tabela em 'tabela' e o preço em 'valor'). O campo 'preco_venda' é apenas a tabela padrão (geralmente Tabela A) e NÃO deve ser usado quando o usuário pede uma tabela específica.",
        "Quando o usuário pedir o valor em uma tabela específica (ex: 'TABELA RATIONAL - GUERRA', 'Tabela B', 'Tabela Guerra'), procure essa tabela dentro de 'tabelas_preco' fazendo correspondência por nome (ignore maiúsculas/minúsculas e acentos; 'guerra' deve casar com 'TABELA RATIONAL - GUERRA') e use o 'valor' correspondente. NUNCA use a tabela padrão nesse caso.",
        "Se a tabela pedida não existir em 'tabelas_preco' para aquela peça, informe que essa tabela não está cadastrada para a peça e mostre as tabelas disponíveis.",
        "Cada peça também retorna 'valor_custo', que é o custo real cadastrado no sistema. Quando o usuário pedir o custo, use ESSE valor real. NUNCA invente custo, NUNCA estime aplicando markup ou margem sobre uma tabela de preço. Se 'valor_custo' for 0 ou ausente, diga que o custo não está cadastrado — jamais calcule um valor fictício.",
        "Ao informar a localização, mostre a localização física e a rational quando existirem; se não houver, diga que não há localização cadastrada.",
        "Se a busca retornar várias peças, liste as opções e peça para o usuário especificar qual deseja.",
        "Se não encontrar nada, informe que a peça não foi localizada no estoque.",
        "HISTÓRICO DE SAÍDAS / CONSUMO: Você TEM acesso ao histórico de saídas (vendas e OS já baixadas). Quando o usuário perguntar sobre saídas, consumo, itens mais vendidos, quanto saiu de uma peça, ou desempenho por grupo/período, use a ferramenta analisar_consumo. Traduza períodos em datas: 'em 2026' → data_inicio 2026-01-01 e data_fim 2026-12-31; 'últimos 3 meses' → calcule as datas. Para perguntas por grupo, passe o parâmetro 'grupo'. REGRA DO ESTOQUE: quando o usuário disser 'vendas' no contexto de estoque/análise de estoque, interprete como SAÍDAS TOTAIS = VENDAS + OS, a menos que ele diga explicitamente 'somente vendas comerciais' ou 'excluindo OS'. A resposta traz 'resumo_por_tipo' com totais separados e cada item tem 'quantidade_vendas' e 'quantidade_os'; informe o total somado e, se útil, detalhe a composição. NUNCA diga que não há vendas/saídas sem considerar OS + venda. NUNCA diga que não tem acesso a histórico de vendas/saídas — use essa ferramenta.",
        "COMPRAS / PEDIDOS DE COMPRA / REPOSIÇÃO: Você TEM acesso aos pedidos de compra, compras em aberto/finalizadas/canceladas e sugestões de reposição. Quando o usuário perguntar se tem pedido de compra para uma peça, compra em aberto, previsão/chegada, reposição, última compra, fornecedor, quantidade comprada ou situação do pedido, use consultar_pedidos_compra. NUNCA diga que não tem acesso ao módulo de Pedidos de Compra; consulte a ferramenta. Se o usuário disser 'em aberto', chame com apenas_abertos=true. Responda separando pedidos em aberto de pedidos finalizados/cancelados e cite código do pedido, data, fornecedor, situação e quantidade.",
        "IMPORTANTE — CACHE LOCAL DE COMPRAS PODE ESTAR INCOMPLETO: a ferramenta consultar_pedidos_compra lê um cache local sincronizado do GestãoClick, que pode estar DESATUALIZADO ou não conter pedidos recentes/em trânsito com situações personalizadas (ex: 'COMPRADO - AG CHEGADA'). Portanto: (1) quando for listar os pedidos de compra de uma peça, SEMPRE cruze também com a ferramenta consultar_gestaoclick (entidade 'compras') para garantir que nenhum pedido fique de fora — não confie apenas no cache local; (2) NUNCA afirme que 'não existe pedido de compra' ou que 'esse é o único pedido' sem antes confirmar via consultar_gestaoclick na fonte ao vivo; (3) se o usuário citar um número de pedido específico que você não listou, isso é um ERRO seu — refaça a busca ao vivo, não invente justificativa. É melhor consultar as duas fontes e consolidar do que dar uma lista incompleta.",
        "Ao apresentar um ranking de saídas, liste as peças no formato [Código] Nome com a quantidade de saída e, quando útil, o valor consumido. Deixe claro o período e o tipo (vendas, OS ou todos) considerados.",
        "CADASTRO DE PRODUTO: Você pode cadastrar um produto novo com a ferramenta cadastrar_produto. Para isso colete: nome, código interno, grupo/categoria, custo, estoque inicial, localização (física e rational, se houver) e o preço de venda de CADA tabela informada pelo usuário.",
        "ANTES de chamar cadastrar_produto, mostre um resumo completo e organizado de TODOS os dados (incluindo o preço tabela a tabela) e peça a confirmação explícita do usuário. Só chame a ferramenta depois que o usuário responder confirmando (ex: 'sim', 'pode cadastrar', 'confirmar').",
        "Nunca invente preços de tabela: use exatamente os valores que o usuário informar para cada tabela. Se o usuário não informar alguma tabela, avise que ela ficará com o markup padrão do GestãoClick.",
        "Se a ferramenta retornar erro de grupo ou de tabela não encontrada, mostre as opções sugeridas e peça para o usuário escolher.",
        "Após cadastrar com sucesso, confirme ao usuário o produto criado (identificação) e os preços efetivamente gravados em 'precos_aplicados'.",
        "ACESSO TOTAL AO GESTÃOCLICK (GC): Você TEM acesso de LEITURA a QUALQUER módulo do ERP GestãoClick através da ferramenta consultar_gestaoclick. Use-a para responder qualquer pergunta sobre ordens de serviço (OS), vendas, orçamentos, compras, clientes, fornecedores, técnicos, funcionários, usuários, recebimentos (contas a receber), pagamentos (contas a pagar), notas fiscais (NFe), serviços, situações, formas de pagamento, centros de custo, transportadoras e bancos. NUNCA diga que não tem acesso a um módulo do GC ou a informações financeiras/comerciais — SEMPRE consulte a ferramenta antes de responder. Passe a 'entidade' (ex: 'os', 'venda', 'orcamento', 'cliente', 'fornecedor', 'tecnico', 'recebimento', 'pagamento', 'nfe') e, quando aplicável, 'filtros' (ex: {data_inicio:'2026-01-01', data_fim:'2026-12-31', cliente_id:'123'}) ou o 'id' para o detalhe completo de um registro. Para varrer muitos registros aumente 'max_paginas'.",
        "PREFERÊNCIA DE FERRAMENTAS: para estoque/saldo/preço use consultar_estoque; para histórico de saídas/consumo use analisar_consumo; para pedidos de compra/reposição use consultar_pedidos_compra; para 'em qual venda/OS a peça saiu' ou 'última venda dessa peça' use consultar_vendas_da_peca; para TODO O RESTO do GC use consultar_gestaoclick.",
        "REGRA CRÍTICA ANTI-ERRO — VENDAS/OS DE UMA PEÇA: Quando o usuário perguntar em qual venda ou OS uma peça saiu, ou qual a última venda dela, use OBRIGATORIAMENTE a ferramenta consultar_vendas_da_peca. Ela consulta o histórico de consumo/movimentações sincronizado e tenta confirmar o documento ao vivo no GestãoClick. Você SÓ pode citar uma saída se o documento vier com verificado=true. Se verificado_ao_vivo=false mas confirmado_historico=true, cite a saída como 'confirmada pelo histórico de consumo/movimentações' e NÃO invente o Nº exibido; use numero_documento somente quando retornado. É TERMINANTEMENTE PROIBIDO dizer que não houve vendas/OS/saídas quando a ferramenta retornou documentos verificados. Números internos (source_id/gc_id) NÃO são o mesmo que o Nº da venda exibido. Se nenhum documento vier verificado, diga honestamente que não conseguiu confirmar em qual venda/OS a peça saiu — NUNCA invente ou 'chute' um número. Melhor admitir que não confirmou do que dar informação errada.",
      ].join(" "),
      messages: prunarMensagens(
        await convertToModelMessages(messages, { ignoreIncompleteToolCalls: true }),
      ),
      tools: {
        consultar_estoque: consultarEstoque,
        cadastrar_produto: cadastrarProduto,
        analisar_consumo: analisarConsumo,
        consultar_pedidos_compra: consultarPedidosCompra,
        consultar_gestaoclick: consultarGestaoClick,
        consultar_vendas_da_peca: consultarVendasDaPeca,
      },
    });

    return result.toUIMessageStreamResponse({ headers: corsHeaders });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro desconhecido";
    console.error("estoque-ai-chat error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
