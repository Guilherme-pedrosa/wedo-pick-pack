import { supabase } from '@/integrations/supabase/client';

// ---------------------------------------------------------------------------
// Análise de custos / rentabilidade de orçamentos (GestãoClick)
// ---------------------------------------------------------------------------

async function apiRequest<T>(path: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke('gc-proxy', {
    body: { path, method: 'GET' },
  });
  if (error) throw new Error(error.message || 'Erro de conexão com o servidor');
  const response = data as any;
  const gcOk = response?._proxy?.ok;
  const gcHttpStatus = response?._proxy?.gc_http_status;
  if (gcOk === false || response?.status === 'error' || (response?.code && response.code >= 400)) {
    const gcMsg = response?.data?.mensagem || response?.data?.erro || response?.error || '';
    const statusCode = gcHttpStatus || response?.code || 0;
    if (statusCode === 429) throw new Error('Muitas requisições ao GestãoClick. Tente novamente em instantes.');
    if (statusCode === 401 || statusCode === 403) throw new Error('Falha de autenticação com o GestãoClick.');
    throw new Error(gcMsg || `Erro ${statusCode} no GestãoClick`);
  }
  return response as T;
}

export function parseMoney(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  if (raw.includes(',') && raw.includes('.')) return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
  if (raw.includes(',')) return parseFloat(raw.replace(',', '.')) || 0;
  return parseFloat(raw) || 0;
}

export const formatBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

export const formatPct = (v: number, digits = 1) =>
  `${v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

// --- Config -----------------------------------------------------------------

export interface AnalysisConfig {
  /** Alíquota de impostos sobre o faturamento (%) */
  impostoPct: number;
  /** Rateio de custo fixo / despesa administrativa sobre o faturamento (%) */
  custoFixoPct: number;
  /** Provisão de garantia sobre o faturamento (%) */
  garantiaPct: number;
  /** Margem líquida mínima aceitável (%) */
  margemMinima: number;
  /** Margem líquida meta (%) */
  margemMeta: number;
  /** Custo real do deslocamento por km rodado (R$) */
  custoPorKm: number;
}

export const DEFAULT_ANALYSIS_CONFIG: AnalysisConfig = {
  impostoPct: 14,
  custoFixoPct: 0,
  garantiaPct: 0,
  margemMinima: 19,
  margemMeta: 30,
  custoPorKm: 1.05,
};

/** Como o custo de deslocamento entra na análise */
export type DeslocamentoModo = 'auto' | 'manual' | 'ignorar';

export interface DeslocamentoInput {
  modo: DeslocamentoModo;
  /** km usados quando modo = 'manual' */
  km: number;
  /** custo por km usado quando modo = 'manual' (se vazio usa o da config) */
  custoPorKm?: number;
}

export const DEFAULT_DESLOCAMENTO: DeslocamentoInput = { modo: 'auto', km: 0 };

export interface DeslocamentoResumo {
  modo: DeslocamentoModo;
  /** km identificados no orçamento (linhas de deslocamento) */
  kmDetectado: number;
  /** km efetivamente considerados no cálculo */
  km: number;
  custoPorKm: number;
  /** custo total estimado do deslocamento */
  custoEstimado: number;
  /** parte do custo que já vem cadastrada nas linhas do orçamento */
  custoJaNasLinhas: number;
  /** custo extra somado à análise (evita contagem dupla) */
  custoAdicional: number;
  /** receita faturada de deslocamento (pode ser 0 se houve desconto total) */
  receita: number;
  /** rótulo das linhas identificadas */
  linhas: string[];
}


const CONFIG_KEY = 'wedo:orcamento-analysis-config';

export function loadAnalysisConfig(): AnalysisConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_ANALYSIS_CONFIG };
    return { ...DEFAULT_ANALYSIS_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_ANALYSIS_CONFIG };
  }
}

export function saveAnalysisConfig(cfg: AnalysisConfig) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

// --- Tipos ------------------------------------------------------------------

export interface AnalysisLine {
  tipo: 'produto' | 'servico';
  nome: string;
  detalhes?: string;
  codigo?: string;
  tabela?: string;
  quantidade: number;
  valorUnitVenda: number;
  valorUnitCusto: number;
  receita: number;
  custo: number;
  margemBruta: number;
  margemBrutaPct: number;
  markupPct: number;
  descontoAplicado: number;
  semCusto: boolean;
  /** linha identificada como deslocamento/km */
  isDeslocamento?: boolean;
}

export interface OrcamentoAnalysis {
  id: string;
  codigo: string;
  nomeCliente: string;
  nomeVendedor?: string;
  data: string;
  nomeSituacao: string;
  linhas: AnalysisLine[];
  receitaProdutos: number;
  receitaServicos: number;
  receitaFrete: number;
  descontoCabecalho: number;
  receitaBruta: number;
  receitaLiquida: number;
  custoProdutos: number;
  custoServicos: number;
  custoDeslocamento: number;
  deslocamento: DeslocamentoResumo;
  custoTotal: number;

  imposto: number;
  custoFixo: number;
  garantia: number;
  lucro: number;
  margemLiquidaPct: number;
  margemBrutaPct: number;
  descontoTotalPct: number;
  linhasSemCusto: number;
  valorTotalGC: number;
  config: AnalysisConfig;
}

// --- Fetch ------------------------------------------------------------------

export async function fetchOrcamentoByCodigo(codigo: string): Promise<any> {
  const term = codigo.trim();
  if (!term) throw new Error('Informe o número do orçamento.');

  const list = await apiRequest<{ data: any[] }>(`/api/orcamentos?codigo=${encodeURIComponent(term)}`);
  const match = (list?.data || []).find((o: any) => String(o.codigo) === term) || (list?.data || [])[0];
  const id = match?.id || (/^\d{6,}$/.test(term) ? term : null);
  if (!id) throw new Error(`Orçamento nº ${term} não encontrado no GestãoClick.`);

  const full = await apiRequest<{ data: any }>(`/api/orcamentos/${id}`);
  const orc = full?.data;
  if (!orc || !orc.id) throw new Error(`Não foi possível carregar o orçamento nº ${term}.`);
  return orc;
}

// --- Cálculo ----------------------------------------------------------------

function buildLine(raw: any, tipo: 'produto' | 'servico'): AnalysisLine {
  const quantidade = parseMoney(raw.quantidade);
  const valorUnitVenda = parseMoney(raw.valor_venda);
  const valorUnitCusto = parseMoney(raw.valor_custo);
  const receita = parseMoney(raw.valor_total) || quantidade * valorUnitVenda;
  const custo = quantidade * valorUnitCusto;
  const margemBruta = receita - custo;
  const bruto = quantidade * valorUnitVenda;

  const nome = String(raw.nome_produto || raw.nome_servico || 'Item');
  const detalhes = raw.detalhes ? String(raw.detalhes) : undefined;

  return {
    tipo,
    nome,
    detalhes,
    codigo: raw.codigo_produto ? String(raw.codigo_produto) : undefined,
    tabela: raw.nome_tipo_valor ? String(raw.nome_tipo_valor) : undefined,
    quantidade,
    valorUnitVenda,
    valorUnitCusto,
    receita,
    custo,
    margemBruta,
    margemBrutaPct: receita > 0 ? (margemBruta / receita) * 100 : 0,
    markupPct: custo > 0 ? ((receita - custo) / custo) * 100 : 0,
    descontoAplicado: Math.max(0, bruto - receita),
    semCusto: valorUnitCusto <= 0,
    isDeslocamento: DESLOCAMENTO_RE.test(`${nome} ${detalhes || ''}`),
  };
}

const DESLOCAMENTO_RE = /desloc|quilometr|kilometr|\bkm\b|\bkms\b|viagem|pedágio|pedagio|combustível|combustivel/i;

export function analyzeOrcamento(
  orc: any,
  config: AnalysisConfig,
  desl: DeslocamentoInput = DEFAULT_DESLOCAMENTO
): OrcamentoAnalysis {
  const produtos: AnalysisLine[] = (orc.produtos || [])
    .map((p: any) => p?.produto ?? p)
    .filter(Boolean)
    .map((p: any) => buildLine(p, 'produto'));

  const servicos: AnalysisLine[] = (orc.servicos || [])
    .map((s: any) => s?.servico ?? s)
    .filter(Boolean)
    .map((s: any) => buildLine(s, 'servico'));

  const linhas = [...produtos, ...servicos];

  const receitaProdutos = produtos.reduce((s, l) => s + l.receita, 0);
  const receitaServicos = servicos.reduce((s, l) => s + l.receita, 0);
  const receitaFrete = parseMoney(orc.valor_frete);
  const descontoCabecalho = parseMoney(orc.desconto_valor);
  const receitaBruta = receitaProdutos + receitaServicos + receitaFrete;
  const valorTotalGC = parseMoney(orc.valor_total);
  const receitaLiquida = valorTotalGC > 0 ? valorTotalGC : receitaBruta - descontoCabecalho;

  const custoProdutos = produtos.reduce((s, l) => s + l.custo, 0);
  const custoServicos = servicos.reduce((s, l) => s + l.custo, 0);

  // --- Deslocamento --------------------------------------------------------
  const linhasDesl = linhas.filter((l) => l.isDeslocamento);
  const kmDetectado = linhasDesl.reduce((s, l) => s + l.quantidade, 0);
  const custoJaNasLinhas = linhasDesl.reduce((s, l) => s + l.custo, 0);
  const receitaDesl = linhasDesl.reduce((s, l) => s + l.receita, 0);
  const custoPorKm = desl.modo === 'manual' ? (desl.custoPorKm ?? config.custoPorKm) : config.custoPorKm;
  const kmConsiderado = desl.modo === 'ignorar' ? 0 : desl.modo === 'manual' ? desl.km : kmDetectado;
  const custoEstimado = desl.modo === 'ignorar' ? 0 : kmConsiderado * custoPorKm;
  // Evita contagem dupla: o custo já cadastrado nas linhas de deslocamento
  // continua dentro de custoServicos/custoProdutos; aqui somamos só a diferença.
  const custoAdicional = Math.max(0, custoEstimado - custoJaNasLinhas);

  const deslocamento: DeslocamentoResumo = {
    modo: desl.modo,
    kmDetectado,
    km: kmConsiderado,
    custoPorKm,
    custoEstimado,
    custoJaNasLinhas,
    custoAdicional,
    receita: receitaDesl,
    linhas: linhasDesl.map((l) => l.nome),
  };

  const custoDeslocamento = desl.modo === 'ignorar' ? custoJaNasLinhas : Math.max(custoEstimado, custoJaNasLinhas);
  const custoTotal = custoProdutos + custoServicos + custoAdicional;

  const imposto = receitaLiquida * (config.impostoPct / 100);
  const custoFixo = receitaLiquida * (config.custoFixoPct / 100);
  const garantia = receitaLiquida * (config.garantiaPct / 100);
  const lucro = receitaLiquida - custoTotal - imposto - custoFixo - garantia;

  const descontoLinhas = linhas.reduce((s, l) => s + l.descontoAplicado, 0);
  const brutoSemDesconto = receitaBruta + descontoLinhas;


  return {
    id: String(orc.id),
    codigo: String(orc.codigo),
    nomeCliente: String(orc.nome_cliente || ''),
    nomeVendedor: orc.nome_vendedor ? String(orc.nome_vendedor) : undefined,
    data: String(orc.data || ''),
    nomeSituacao: String(orc.nome_situacao || ''),
    linhas,
    receitaProdutos,
    receitaServicos,
    receitaFrete,
    descontoCabecalho,
    receitaBruta,
    receitaLiquida,
    custoProdutos,
    custoServicos,
    custoTotal,
    imposto,
    custoFixo,
    garantia,
    lucro,
    margemLiquidaPct: receitaLiquida > 0 ? (lucro / receitaLiquida) * 100 : 0,
    margemBrutaPct: receitaLiquida > 0 ? ((receitaLiquida - custoTotal) / receitaLiquida) * 100 : 0,
    descontoTotalPct:
      brutoSemDesconto > 0 ? ((descontoLinhas + descontoCabecalho) / brutoSemDesconto) * 100 : 0,
    linhasSemCusto: linhas.filter((l) => l.semCusto).length,
    valorTotalGC,
    config,
  };
}

// --- Parecer ----------------------------------------------------------------

export type Veredito = 'lucro-meta' | 'lucro-ok' | 'lucro-baixo' | 'prejuizo';

export interface Parecer {
  veredito: Veredito;
  titulo: string;
  resumo: string;
  recomendacoes: string[];
  alcada: string;
}

export function buildParecer(a: OrcamentoAnalysis): Parecer {
  const m = a.margemLiquidaPct;
  const cfg = a.config;

  let veredito: Veredito;
  let titulo: string;
  if (a.lucro < 0) {
    veredito = 'prejuizo';
    titulo = 'Prejuízo — orçamento não deve ser aprovado como está';
  } else if (m >= cfg.margemMeta) {
    veredito = 'lucro-meta';
    titulo = `Lucrativo — margem acima da meta de ${formatPct(cfg.margemMeta, 0)}`;
  } else if (m >= cfg.margemMinima) {
    veredito = 'lucro-ok';
    titulo = `Lucrativo — margem acima do mínimo (${formatPct(cfg.margemMinima, 0)}), abaixo da meta`;
  } else {
    veredito = 'lucro-baixo';
    titulo = `Atenção — lucro positivo, mas margem abaixo do mínimo de ${formatPct(cfg.margemMinima, 0)}`;
  }

  const resumo =
    `Receita de ${formatBRL(a.receitaLiquida)}, custo de ${formatBRL(a.custoTotal)}, ` +
    `impostos de ${formatBRL(a.imposto)} (${formatPct(cfg.impostoPct, 0)})` +
    (a.custoFixo > 0 ? `, custo fixo de ${formatBRL(a.custoFixo)}` : '') +
    (a.garantia > 0 ? `, provisão de garantia de ${formatBRL(a.garantia)}` : '') +
    `. Resultado de ${formatBRL(a.lucro)} (${formatPct(m)} sobre a venda).`;

  const recomendacoes: string[] = [];

  if (veredito === 'prejuizo') {
    recomendacoes.push('Revisar preços antes de enviar ao cliente: a operação não cobre custos e impostos.');
  }
  if (veredito === 'lucro-baixo') {
    recomendacoes.push('Não conceder novos descontos. Reavaliar tabela de preço das peças ou reduzir desconto de mão de obra/deslocamento.');
  }
  if (veredito === 'lucro-ok') {
    recomendacoes.push('Descontos adicionais somente com contrapartida clara (pagamento à vista, fechamento imediato ou campanha vigente).');
  }
  if (veredito === 'lucro-meta') {
    recomendacoes.push('Margem saudável. Eventual desconto deve incidir preferencialmente sobre mão de obra, preservando peças, fretes e deslocamentos.');
  }

  const semMargem = a.linhas.filter((l) => !l.semCusto && l.margemBrutaPct < 10 && l.receita > 0);
  for (const l of semMargem.slice(0, 4)) {
    recomendacoes.push(
      `"${l.nome}" está com margem bruta de apenas ${formatPct(l.margemBrutaPct)} — praticamente sem margem. Evite descontos nesta linha.`
    );
  }

  const negativas = a.linhas.filter((l) => l.margemBruta < 0);
  for (const l of negativas.slice(0, 4)) {
    recomendacoes.push(`"${l.nome}" está sendo vendida ABAIXO do custo (${formatBRL(l.margemBruta)}).`);
  }

  if (a.linhasSemCusto > 0) {
    recomendacoes.push(
      `${a.linhasSemCusto} linha(s) sem custo cadastrado no GestãoClick — o lucro real pode ser menor que o calculado.`
    );
  }

  const d = a.descontoTotalPct;
  const alcada =
    d <= 0
      ? 'Sem desconto aplicado — não requer aprovação.'
      : d <= 5
        ? `Desconto de ${formatPct(d)} — alçada do Consultor Comercial (até 5%).`
        : d <= 10
          ? `Desconto de ${formatPct(d)} — exige aprovação do Gerente Comercial (5,01% a 10%).`
          : `Desconto de ${formatPct(d)} — exige aprovação da Diretoria (acima de 10%).`;

  return { veredito, titulo, resumo, recomendacoes, alcada };
}
