import { formatBRL, formatPct } from "@/api/orcamentoAnalysis";
import type { AnalysisConfig, ExtrasInput } from "@/api/orcamentoAnalysis";

export interface MemoRow {
  label: string;
  valor: number;
  memo: string;
  tone?: "positivo" | "negativo";
}

const n = (v: number, dec = 2) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: dec });

/** Análise (individual ou conjunto) — subconjunto comum de campos usado na composição */
export interface MemoAnalysisLike {
  receitaLiquida: number;
  deslocamento: {
    modo: string;
    km: number;
    kmDetectado: number;
    custoPorKm: number;
    custoEstimado: number;
    custoJaNasLinhas: number;
    custoAdicional: number;
  };
  extras: {
    pedagio: number;
    hospedagem: number;
    alimentacao: number;
    moAdmin: number;
    premiacao: number;
    premiacaoPecas: number;
    premiacaoServicos: number;
    parcelamento: number;
    parcelamentoPct: number;
    parcelas: number;
    restorno: number;
    restornoPct: number;
  };
  imposto: number;
  impostoPctEfetivo: number;
  nota10: boolean;
  custoFixo: number;
  garantia: number;
  custoTotal: number;
  lucro: number;
  config: AnalysisConfig;
}

/** Linhas de deslocamento (custo estimado + estorno do que já está nas linhas) */
export function deslocamentoMemoRows(a: MemoAnalysisLike): MemoRow[] {
  const d = a.deslocamento;
  const rows: MemoRow[] = [];
  const origemKm =
    d.modo === "manual"
      ? "km informado manualmente"
      : d.modo === "ignorar"
        ? "deslocamento desconsiderado"
        : `km detectado nas linhas do orçamento (${n(d.kmDetectado, 1)} km)`;

  rows.push({
    label:
      d.modo === "ignorar"
        ? "Custo de deslocamento (desconsiderado)"
        : `Custo de deslocamento (${n(d.km, 1)} km × ${formatBRL(d.custoPorKm)})`,
    valor: -d.custoEstimado,
    memo:
      d.modo === "ignorar"
        ? "Modo “ignorar”: nenhum custo de deslocamento estimado."
        : `${n(d.km, 1)} km × ${formatBRL(d.custoPorKm)}/km = ${formatBRL(d.custoEstimado)} · ${origemKm}`,
  });

  if (d.custoJaNasLinhas > 0) {
    rows.push({
      label: "(já contabilizado no custo dos serviços — estorno para não duplicar)",
      valor: d.custoJaNasLinhas,
      tone: "positivo",
      memo: `As linhas de deslocamento do orçamento já têm ${formatBRL(d.custoJaNasLinhas)} de custo. Só entra a diferença: ${formatBRL(d.custoEstimado)} − ${formatBRL(d.custoJaNasLinhas)} = ${formatBRL(d.custoAdicional)}`,
    });
  }
  return rows;
}

/** Extras, impostos e taxas sobre faturamento */
export function extrasMemoRows(a: MemoAnalysisLike, extrasIn?: ExtrasInput): MemoRow[] {
  const c = a.config;
  const e = a.extras;
  const rows: MemoRow[] = [
    {
      label: "Pedágio",
      valor: -e.pedagio,
      memo: "Valor informado manualmente no card de extras.",
    },
    {
      label: "Hospedagem",
      valor: -e.hospedagem,
      memo: "Valor informado manualmente no card de extras.",
    },
    {
      label: "Alimentação",
      valor: -e.alimentacao,
      memo: extrasIn
        ? `${n(extrasIn.dias, 0)} dia(s) × ${n(extrasIn.tecnicos, 0)} técnico(s) × ${formatBRL(c.alimentacaoDia)}/dia = ${formatBRL(e.alimentacao)}`
        : `Dias × técnicos × ${formatBRL(c.alimentacaoDia)}/dia`,
    },
    {
      label: "MO administrativa",
      valor: -e.moAdmin,
      memo: extrasIn
        ? `${n(extrasIn.horasAdmin, 2)} h × ${formatBRL(c.moAdminHora)}/h = ${formatBRL(e.moAdmin)}`
        : `Horas administrativas × ${formatBRL(c.moAdminHora)}/h`,
    },
    {
      label: "Premiação do técnico",
      valor: -e.premiacao,
      memo: `Peças: ${formatPct(c.premiacaoPecaPct, 0)} = ${formatBRL(e.premiacaoPecas)} + Serviços: ${formatPct(c.premiacaoServicoPct, 0)} = ${formatBRL(e.premiacaoServicos)} (sobre a venda de cada grupo)`,
    },
    {
      label: `Custo do parcelamento (${formatPct(e.parcelamentoPct, 2)} em ${e.parcelas}x)`,
      valor: -e.parcelamento,
      memo:
        e.parcelas > 1
          ? `CDB ${formatPct(c.cdbAnualPct || 0, 2)} a.a. ÷ 12 = ${formatPct((c.cdbAnualPct || 0) / 12, 3)} a.m. × prazo médio ${n((e.parcelas - 1) / 2, 1)} meses = ${formatPct(e.parcelamentoPct, 2)} sobre a receita líquida (${formatBRL(a.receitaLiquida)})`
          : "Pagamento à vista (1x): custo do dinheiro zero.",
    },
    {
      label: `Restorno Sapore (${formatPct(e.restornoPct, 0)})`,
      valor: -e.restorno,
      memo: `Cliente Sapore: ${formatPct(e.restornoPct, 0)} × receita líquida (${formatBRL(a.receitaLiquida)}) = ${formatBRL(e.restorno)}`,
    },
    {
      label: `Impostos (${formatPct(a.impostoPctEfetivo, a.nota10 ? 2 : 0)})`,
      valor: -a.imposto,
      memo: `${a.nota10 ? `Alíquota ${formatPct(c.impostoPct, 0)} − 10 p.p. (Nota 10) = ${formatPct(a.impostoPctEfetivo, 2)}` : `Alíquota configurada ${formatPct(c.impostoPct, 0)}`} × receita líquida (${formatBRL(a.receitaLiquida)}) = ${formatBRL(a.imposto)}`,
    },
  ];

  rows.push({
    label: `Custo fixo (${formatPct(c.custoFixoPct, 0)})`,
    valor: -a.custoFixo,
    memo: `${formatPct(c.custoFixoPct, 0)} × receita líquida (${formatBRL(a.receitaLiquida)}) = ${formatBRL(a.custoFixo)}`,
  });
  rows.push({
    label: `Garantia (${formatPct(c.garantiaPct, 0)})`,
    valor: -a.garantia,
    memo: `${formatPct(c.garantiaPct, 0)} × receita líquida (${formatBRL(a.receitaLiquida)}) = ${formatBRL(a.garantia)}`,
  });
  return rows;
}

/** Memória do resultado final */
export function resultadoMemo(a: MemoAnalysisLike): string {
  return `Receita líquida ${formatBRL(a.receitaLiquida)} − custos totais ${formatBRL(a.custoTotal)} − impostos ${formatBRL(a.imposto)}${a.custoFixo > 0 ? ` − custo fixo ${formatBRL(a.custoFixo)}` : ""}${a.garantia > 0 ? ` − garantia ${formatBRL(a.garantia)}` : ""} = ${formatBRL(a.lucro)} · margem = lucro ÷ receita líquida`;
}
