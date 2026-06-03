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
      localizacao_fisica: fisica,
      localizacao_rational: rational,
      tabelas_preco,
    };
  } catch {
    return null;
  }
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
            localizacao_fisica: live?.localizacao_fisica || null,
            localizacao_rational: live?.localizacao_rational || null,
            tabelas_preco: live?.tabelas_preco ?? [],
            saldo_ao_vivo: !!live,
          };
        });

        return { encontrados: pecas.length, pecas };
      },
    });

    const result = streamText({
      model: gateway("google/gemini-3-flash-preview"),
      stopWhen: stepCountIs(50),
      system: [
        "Você é a IA Especialista de Estoque da empresa (ERP WeDo).",
        "Responda SEMPRE em português do Brasil, de forma direta e objetiva.",
        "Quando o usuário perguntar sobre saldo, quantidade, localização (tabela/prateleira) ou preço de uma peça, use a ferramenta consultar_estoque para buscar os dados reais. NUNCA invente saldos.",
        "Sempre identifique a peça no formato [Código Interno] Nome do Produto.",
        "Formate valores em reais no padrão brasileiro (R$ 1.234,56 com vírgula decimal).",
        "Ao informar a localização, mostre a localização física e a rational quando existirem; se não houver, diga que não há localização cadastrada.",
        "Se a busca retornar várias peças, liste as opções e peça para o usuário especificar qual deseja.",
        "Se não encontrar nada, informe que a peça não foi localizada no estoque.",
      ].join(" "),
      messages: await convertToModelMessages(messages),
      tools: { consultar_estoque: consultarEstoque },
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
