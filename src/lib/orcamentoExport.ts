import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AnalysisConfig,
  AnalysisLine,
  GrupoAnalysis,
  OrcamentoAnalysis,
  buildParecer,
  formatBRL,
  formatPct,
} from "@/api/orcamentoAnalysis";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const money = (v: number) => Number((v || 0).toFixed(2));
const pct = (v: number) => Number((v || 0).toFixed(2));

function stamp() {
  return new Date().toLocaleString("pt-BR");
}

function fileStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function sheetFromRows(rows: (string | number)[][]) {
  return XLSX.utils.aoa_to_sheet(rows);
}

function autoWidth(ws: XLSX.WorkSheet, rows: (string | number)[][]) {
  const widths: number[] = [];
  rows.forEach((r) =>
    r.forEach((cell, i) => {
      const len = String(cell ?? "").length + 2;
      widths[i] = Math.min(60, Math.max(widths[i] || 10, len));
    })
  );
  ws["!cols"] = widths.map((w) => ({ wch: w }));
  return ws;
}

function addSheet(wb: XLSX.WorkBook, name: string, rows: (string | number)[][]) {
  const ws = autoWidth(sheetFromRows(rows), rows);
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

function configRows(config: AnalysisConfig): (string | number)[][] {
  return [
    ["Parâmetro", "Valor"],
    ["Impostos (%)", pct(config.impostoPct)],
    ["Custo fixo (%)", pct(config.custoFixoPct)],
    ["Garantia (%)", pct(config.garantiaPct)],
    ["Margem mínima (%)", pct(config.margemMinima)],
    ["Margem meta (%)", pct(config.margemMeta)],
    ["Custo por km (R$)", money(config.custoPorKm)],
    ["Alimentação por dia/técnico (R$)", money(config.alimentacaoDia)],
    ["MO administrativa (R$/h)", money(config.moAdminHora)],
    ["Horas administrativas padrão", pct(config.moAdminHorasPadrao)],
    ["Premiação peças (%)", pct(config.premiacaoPecaPct)],
    ["Premiação serviços (%)", pct(config.premiacaoServicoPct)],
    ["CDB anual (%)", pct(config.cdbAnualPct)],
  ];
}

const LINE_HEADER = [
  "Orçamento",
  "Tipo",
  "Item",
  "Detalhes",
  "Tabela",
  "Qtd",
  "Custo un. (R$)",
  "Venda un. (R$)",
  "Custo total (R$)",
  "Receita (R$)",
  "Margem (R$)",
  "Margem (%)",
  "Markup (%)",
  "Desconto (R$)",
  "Sem custo",
];

function lineRow(codigo: string, l: AnalysisLine): (string | number)[] {
  return [
    codigo,
    l.tipo === "produto" ? "Peça" : "Serviço",
    l.nome,
    l.detalhes || "",
    l.tabela || "",
    Number(l.quantidade.toFixed(4)),
    money(l.valorUnitCusto),
    money(l.valorUnitVenda),
    money(l.custo),
    money(l.receita),
    money(l.margemBruta),
    pct(l.margemBrutaPct),
    l.semCusto ? "" : pct(l.markupPct),
    money(l.descontoAplicado),
    l.semCusto ? "SIM" : "NÃO",
  ];
}

/** Linhas da composição do resultado (label, valor) — mesma lógica da tela */
function composicaoIndividual(a: OrcamentoAnalysis): Array<[string, number]> {
  const rows: Array<[string, number]> = [
    ["Peças (venda)", a.receitaProdutos],
    ["Serviços (venda)", a.receitaServicos],
    ["Frete", a.receitaFrete],
    ["Desconto do cabeçalho", -a.descontoCabecalho],
    ["Custo das peças", -a.custoProdutos],
    ["Custo dos serviços", -a.custoServicos],
    [
      `Custo de deslocamento ${
        a.deslocamento.modo === "ignorar"
          ? "(desconsiderado)"
          : `(${a.deslocamento.km.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km × ${formatBRL(
              a.deslocamento.custoPorKm
            )})`
      }`,
      -a.deslocamento.custoEstimado,
    ],
    ["Estorno do deslocamento já embutido nos serviços", a.deslocamento.custoJaNasLinhas],
    ["Pedágio", -a.extras.pedagio],
    ["Hospedagem", -a.extras.hospedagem],
    ["Alimentação", -a.extras.alimentacao],
    ["MO administrativa", -a.extras.moAdmin],
    ["Premiação do técnico", -a.extras.premiacao],
    [
      `Custo do parcelamento (${formatPct(a.extras.parcelamentoPct, 2)} em ${a.extras.parcelas}x)`,
      -a.extras.parcelamento,
    ],
    [`Restorno Sapore (${formatPct(a.extras.restornoPct, 0)})`, -a.extras.restorno],
    [`Impostos (${formatPct(a.config.impostoPct, 0)})`, -a.imposto],
    [`Custo fixo (${formatPct(a.config.custoFixoPct, 0)})`, -a.custoFixo],
    [`Garantia (${formatPct(a.config.garantiaPct, 0)})`, -a.garantia],
  ];
  return rows.filter(([, v]) => v !== 0);
}

function composicaoGrupo(g: GrupoAnalysis): Array<[string, number]> {
  const sum = (fn: (i: GrupoAnalysis["itens"][number]) => number) => g.itens.reduce((s, i) => s + fn(i), 0);
  const rows: Array<[string, number]> = [
    ["Peças (venda)", sum((i) => i.receitaProdutos)],
    ["Serviços (venda)", sum((i) => i.receitaServicos)],
    ["Custo das peças", -sum((i) => i.custoProdutos)],
    ["Custo dos serviços", -sum((i) => i.custoServicos)],
    [
      `Custo de deslocamento ${
        g.deslocamento.modo === "ignorar"
          ? "(desconsiderado)"
          : `(${g.deslocamento.km.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km × ${formatBRL(
              g.deslocamento.custoPorKm
            )})`
      }`,
      -g.deslocamento.custoEstimado,
    ],
    ["Estorno do deslocamento já embutido nos serviços", g.deslocamento.custoJaNasLinhas],
    ["Pedágio", -g.extras.pedagio],
    ["Hospedagem", -g.extras.hospedagem],
    ["Alimentação", -g.extras.alimentacao],
    ["MO administrativa", -g.extras.moAdmin],
    ["Premiação do técnico", -g.extras.premiacao],
    [
      `Custo do parcelamento (${formatPct(g.extras.parcelamentoPct, 2)} em ${g.extras.parcelas}x)`,
      -g.extras.parcelamento,
    ],
    [`Restorno Sapore (${formatPct(g.extras.restornoPct, 0)})`, -g.extras.restorno],
    [`Impostos (${formatPct(g.config.impostoPct, 0)})`, -g.imposto],
    [`Custo fixo (${formatPct(g.config.custoFixoPct, 0)})`, -g.custoFixo],
    [`Garantia (${formatPct(g.config.garantiaPct, 0)})`, -g.garantia],
  ];
  return rows.filter(([, v]) => v !== 0);
}

// ---------------------------------------------------------------------------
// Excel — orçamento individual
// ---------------------------------------------------------------------------

export function exportOrcamentoXLSX(a: OrcamentoAnalysis) {
  const parecer = buildParecer(a);
  const wb = XLSX.utils.book_new();

  addSheet(wb, "Resumo", [
    ["Análise de custos do orçamento"],
    ["Gerado em", stamp()],
    [],
    ["Orçamento", a.codigo],
    ["Cliente", a.nomeCliente],
    ["Vendedor", a.nomeVendedor || "—"],
    ["Data", a.data ? a.data.split("-").reverse().join("/") : "—"],
    ["Situação", a.nomeSituacao || "—"],
    [],
    ["Indicador", "Valor (R$)"],
    ["Receita de peças", money(a.receitaProdutos)],
    ["Receita de serviços", money(a.receitaServicos)],
    ["Frete", money(a.receitaFrete)],
    ["Desconto do cabeçalho", money(a.descontoCabecalho)],
    ["Receita bruta", money(a.receitaBruta)],
    ["Receita líquida (venda)", money(a.receitaLiquida)],
    ["Custo das peças", money(a.custoProdutos)],
    ["Custo dos serviços", money(a.custoServicos)],
    ["Custo de deslocamento", money(a.custoDeslocamento)],
    ["Custos operacionais (extras)", money(a.extras.total)],
    ["Custo total", money(a.custoTotal)],
    ["Impostos", money(a.imposto)],
    ["Custo fixo", money(a.custoFixo)],
    ["Garantia", money(a.garantia)],
    ["Lucro líquido", money(a.lucro)],
    [],
    ["Indicador", "Valor (%)"],
    ["Margem bruta", pct(a.margemBrutaPct)],
    ["Margem líquida", pct(a.margemLiquidaPct)],
    ["Desconto total", pct(a.descontoTotalPct)],
    [],
    ["Parecer", parecer.titulo],
    ["Resumo", parecer.resumo],
    ["Alçada", parecer.alcada],
    ...parecer.recomendacoes.map((r, i) => [`Recomendação ${i + 1}`, r] as (string | number)[]),
  ]);

  addSheet(wb, "Composicao", [
    ["Composição do resultado"],
    ["Descrição", "Valor (R$)"],
    ...composicaoIndividual(a).map(([l, v]) => [l, money(v)] as (string | number)[]),
    ["Resultado", money(a.lucro)],
    ["Margem líquida (%)", pct(a.margemLiquidaPct)],
  ]);

  addSheet(wb, "Itens", [LINE_HEADER, ...a.linhas.map((l) => lineRow(a.codigo, l))]);

  addSheet(wb, "Deslocamento", [
    ["Modo", a.deslocamento.modo],
    ["Km detectados no orçamento", pct(a.deslocamento.kmDetectado)],
    ["Km considerados", pct(a.deslocamento.km)],
    ["Custo por km (R$)", money(a.deslocamento.custoPorKm)],
    ["Custo estimado (R$)", money(a.deslocamento.custoEstimado)],
    ["Custo já nas linhas (R$)", money(a.deslocamento.custoJaNasLinhas)],
    ["Custo adicional (R$)", money(a.deslocamento.custoAdicional)],
    ["Faturado ao cliente (R$)", money(a.deslocamento.receita)],
    [],
    ["Linhas identificadas"],
    ...a.deslocamento.linhas.map((l) => [l] as (string | number)[]),
  ]);

  addSheet(wb, "Custos operacionais", [
    ["Item", "Valor (R$)"],
    ["Alimentação", money(a.extras.alimentacao)],
    ["MO administrativa", money(a.extras.moAdmin)],
    ["Premiação (peças)", money(a.extras.premiacaoPecas)],
    ["Premiação (serviços)", money(a.extras.premiacaoServicos)],
    ["Premiação total", money(a.extras.premiacao)],
    ["Pedágio", money(a.extras.pedagio)],
    ["Hospedagem", money(a.extras.hospedagem)],
    [`Parcelamento (${formatPct(a.extras.parcelamentoPct, 2)} em ${a.extras.parcelas}x)`, money(a.extras.parcelamento)],
    [`Restorno (${formatPct(a.extras.restornoPct, 0)})`, money(a.extras.restorno)],
    ["Total", money(a.extras.total)],
  ]);

  addSheet(wb, "Parametros", configRows(a.config));

  XLSX.writeFile(wb, `analise-orcamento-${a.codigo}-${fileStamp()}.xlsx`);
}

// ---------------------------------------------------------------------------
// Excel — conjunto
// ---------------------------------------------------------------------------

export function exportGrupoXLSX(g: GrupoAnalysis) {
  const wb = XLSX.utils.book_new();
  const cliente = g.clientes.join(" / ") || "Conjunto";

  addSheet(wb, "Resumo", [
    ["Análise de custos — conjunto de orçamentos"],
    ["Gerado em", stamp()],
    ["Cliente(s)", cliente],
    ["Orçamentos", g.itens.map((i) => `#${i.codigo}`).join(", ")],
    [],
    ["Indicador", "Valor (R$)"],
    ["Receita líquida", money(g.receitaLiquida)],
    ["Custo direto (peças + serviços)", money(g.custoDireto)],
    ["Custo de deslocamento adicional", money(g.custoDeslocamentoAdicional)],
    ["Custos operacionais (extras)", money(g.extras.total)],
    ["Custo total", money(g.custoTotal)],
    ["Impostos", money(g.imposto)],
    ["Custo fixo", money(g.custoFixo)],
    ["Garantia", money(g.garantia)],
    ["Lucro líquido", money(g.lucro)],
    ["Margem líquida (%)", pct(g.margemLiquidaPct)],
    [],
    ["Desconto máximo mantendo margem mínima (R$)", money(g.descontoMaxMinima)],
    ["Desconto máximo mantendo margem mínima (%)", pct(g.descontoMaxMinimaPct)],
    ["Desconto máximo mantendo margem meta (R$)", money(g.descontoMaxMeta)],
    ["Desconto máximo mantendo margem meta (%)", pct(g.descontoMaxMetaPct)],
  ]);

  addSheet(wb, "Orcamentos", [
    [
      "Orçamento",
      "Cliente",
      "Data",
      "Situação",
      "Receita (R$)",
      "Receita peças (R$)",
      "Receita serviços (R$)",
      "Custo direto (R$)",
      "Custo peças (R$)",
      "Custo serviços (R$)",
      "Km detectados",
      "Margem direta (%)",
    ],
    ...g.itens.map((i) => [
      i.codigo,
      i.nomeCliente,
      i.data ? i.data.split("-").reverse().join("/") : "",
      i.nomeSituacao || "",
      money(i.receita),
      money(i.receitaProdutos),
      money(i.receitaServicos),
      money(i.custoDireto),
      money(i.custoProdutos),
      money(i.custoServicos),
      pct(i.kmDetectado),
      pct(i.margemDiretaPct),
    ]),
  ]);

  addSheet(wb, "Itens", [
    LINE_HEADER,
    ...g.itens.flatMap((i) => i.linhas.map((l) => lineRow(i.codigo, l))),
  ]);

  addSheet(wb, "Composicao", [
    ["Composição do resultado do conjunto"],
    ["Descrição", "Valor (R$)"],
    ...composicaoGrupo(g).map(([l, v]) => [l, money(v)] as (string | number)[]),
    ["Resultado", money(g.lucro)],
    ["Margem líquida (%)", pct(g.margemLiquidaPct)],
  ]);

  addSheet(wb, "Custos operacionais", [
    ["Item", "Valor (R$)"],
    ["Alimentação", money(g.extras.alimentacao)],
    ["MO administrativa", money(g.extras.moAdmin)],
    ["Premiação (peças)", money(g.extras.premiacaoPecas)],
    ["Premiação (serviços)", money(g.extras.premiacaoServicos)],
    ["Premiação total", money(g.extras.premiacao)],
    ["Pedágio", money(g.extras.pedagio)],
    ["Hospedagem", money(g.extras.hospedagem)],
    [`Parcelamento (${formatPct(g.extras.parcelamentoPct, 2)} em ${g.extras.parcelas}x)`, money(g.extras.parcelamento)],
    [`Restorno (${formatPct(g.extras.restornoPct, 0)})`, money(g.extras.restorno)],
    ["Total", money(g.extras.total)],
  ]);

  addSheet(wb, "Parametros", configRows(g.config));

  XLSX.writeFile(wb, `analise-conjunto-${fileStamp()}.xlsx`);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const PRIMARY: [number, number, number] = [26, 47, 94];

function lastY(doc: jsPDF, fallback: number) {
  const y = (doc as any).lastAutoTable?.finalY;
  return typeof y === "number" ? y : fallback;
}

function pdfHeader(doc: jsPDF, titulo: string, subtitulo: string) {
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.text(titulo, 12, 10);
  doc.setFontSize(9);
  doc.text(subtitulo, 12, 16.5);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(8);
  doc.text(`Gerado em ${stamp()}`, doc.internal.pageSize.getWidth() - 12, 16.5, { align: "right" });
  doc.setTextColor(0, 0, 0);
}

function pdfFooter(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `WeDo · Análise de custos · página ${i} de ${pages}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 6,
      { align: "center" }
    );
  }
  doc.setTextColor(0, 0, 0);
}

function sectionTable(
  doc: jsPDF,
  startY: number,
  head: string[][],
  body: (string | number)[][],
  opts: Record<string, any> = {}
) {
  autoTable(doc, {
    startY,
    head,
    body,
    theme: "striped",
    styles: { fontSize: 8, cellPadding: 1.6, overflow: "linebreak" },
    headStyles: { fillColor: PRIMARY, textColor: 255, fontSize: 8 },
    ...opts,
  });
  return lastY(doc, startY) + 6;
}

export function exportOrcamentoPDF(a: OrcamentoAnalysis) {
  const parecer = buildParecer(a);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  pdfHeader(
    doc,
    `Análise de custos — Orçamento #${a.codigo}`,
    `${a.nomeCliente}${a.nomeVendedor ? ` · Vendedor: ${a.nomeVendedor}` : ""}${
      a.data ? ` · ${a.data.split("-").reverse().join("/")}` : ""
    }${a.nomeSituacao ? ` · ${a.nomeSituacao}` : ""}`
  );

  let y = 28;

  y = sectionTable(
    doc,
    y,
    [["Indicador", "Valor", "Indicador", "Valor"]],
    [
      ["Receita (venda)", formatBRL(a.receitaLiquida), "Custo total", formatBRL(a.custoTotal)],
      ["Peças", formatBRL(a.receitaProdutos), "Custo das peças", formatBRL(a.custoProdutos)],
      ["Serviços", formatBRL(a.receitaServicos), "Custo dos serviços", formatBRL(a.custoServicos)],
      ["Frete", formatBRL(a.receitaFrete), "Deslocamento", formatBRL(a.custoDeslocamento)],
      ["Desconto do cabeçalho", formatBRL(a.descontoCabecalho), "Custos operacionais", formatBRL(a.extras.total)],
      ["Impostos", formatBRL(a.imposto), "Custo fixo / garantia", formatBRL(a.custoFixo + a.garantia)],
      ["Margem bruta", formatPct(a.margemBrutaPct), "Margem líquida", formatPct(a.margemLiquidaPct)],
      ["Lucro líquido", formatBRL(a.lucro), "Desconto total", formatPct(a.descontoTotalPct)],
    ],
    { columnStyles: { 1: { halign: "right" }, 3: { halign: "right" } } }
  );

  y = sectionTable(
    doc,
    y,
    [["Parecer", ""]],
    [
      ["Situação", parecer.titulo],
      ["Resumo", parecer.resumo],
      ["Alçada", parecer.alcada],
      ...parecer.recomendacoes.map((r, i) => [`Recomendação ${i + 1}`, r]),
    ],
    { columnStyles: { 0: { cellWidth: 40, fontStyle: "bold" } } }
  );

  y = sectionTable(
    doc,
    y,
    [["Composição do resultado", "Valor"]],
    [
      ...composicaoIndividual(a).map(([l, v]) => [l, formatBRL(v)]),
      ["RESULTADO", `${formatBRL(a.lucro)} (${formatPct(a.margemLiquidaPct)})`],
    ],
    { columnStyles: { 1: { halign: "right" } } }
  );

  y = sectionTable(
    doc,
    y,
    [["Custos operacionais", "Valor"]],
    [
      ["Alimentação", formatBRL(a.extras.alimentacao)],
      ["MO administrativa", formatBRL(a.extras.moAdmin)],
      ["Premiação (peças / serviços)", `${formatBRL(a.extras.premiacaoPecas)} / ${formatBRL(a.extras.premiacaoServicos)}`],
      ["Pedágio", formatBRL(a.extras.pedagio)],
      ["Hospedagem", formatBRL(a.extras.hospedagem)],
      [
        `Parcelamento (${formatPct(a.extras.parcelamentoPct, 2)} em ${a.extras.parcelas}x)`,
        formatBRL(a.extras.parcelamento),
      ],
      [`Restorno (${formatPct(a.extras.restornoPct, 0)})`, formatBRL(a.extras.restorno)],
      ["Total", formatBRL(a.extras.total)],
    ],
    { columnStyles: { 1: { halign: "right" } } }
  );

  y = sectionTable(
    doc,
    y,
    [["Itens", "Tipo", "Qtd", "Custo un.", "Venda un.", "Custo total", "Receita", "Margem", "Markup"]],
    a.linhas.map((l) => [
      [l.nome, l.detalhes].filter(Boolean).join(" · "),
      l.tipo === "produto" ? "Peça" : "Serviço",
      l.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
      l.semCusto ? "sem custo" : formatBRL(l.valorUnitCusto),
      formatBRL(l.valorUnitVenda),
      formatBRL(l.custo),
      formatBRL(l.receita),
      `${formatBRL(l.margemBruta)} (${formatPct(l.margemBrutaPct)})`,
      l.semCusto ? "—" : formatPct(l.markupPct, 0),
    ]),
    {
      columnStyles: {
        0: { cellWidth: 80 },
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" },
        8: { halign: "right" },
      },
    }
  );

  sectionTable(doc, y, [["Parâmetros globais", "Valor"]], configRows(a.config).slice(1).map(([l, v]) => [
    String(l),
    String(v).replace(".", ","),
  ]), { columnStyles: { 1: { halign: "right" } } });

  pdfFooter(doc);
  doc.save(`analise-orcamento-${a.codigo}-${fileStamp()}.pdf`);
}

export function exportGrupoPDF(g: GrupoAnalysis) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  pdfHeader(
    doc,
    "Análise de custos — Conjunto de orçamentos",
    `${g.clientes.join(" / ") || "Vários clientes"} · ${g.itens.length} orçamento(s): ${g.itens
      .map((i) => `#${i.codigo}`)
      .join(", ")}`
  );

  let y = 28;

  y = sectionTable(
    doc,
    y,
    [["Indicador", "Valor", "Indicador", "Valor"]],
    [
      ["Receita líquida", formatBRL(g.receitaLiquida), "Custo direto", formatBRL(g.custoDireto)],
      ["Custos operacionais", formatBRL(g.extras.total), "Deslocamento adicional", formatBRL(g.custoDeslocamentoAdicional)],
      ["Impostos", formatBRL(g.imposto), "Custo fixo / garantia", formatBRL(g.custoFixo + g.garantia)],
      ["Custo total", formatBRL(g.custoTotal), "Lucro líquido", formatBRL(g.lucro)],
      [
        "Margem líquida",
        formatPct(g.margemLiquidaPct),
        "Desconto máx. (mínima / meta)",
        `${formatBRL(g.descontoMaxMinima)} (${formatPct(g.descontoMaxMinimaPct)}) / ${formatBRL(
          g.descontoMaxMeta
        )} (${formatPct(g.descontoMaxMetaPct)})`,
      ],
    ],
    { columnStyles: { 1: { halign: "right" }, 3: { halign: "right" } } }
  );

  y = sectionTable(
    doc,
    y,
    [["Orçamento", "Cliente", "Data", "Situação", "Receita", "Peças", "Serviços", "Custo direto", "Margem direta"]],
    g.itens.map((i) => [
      `#${i.codigo}`,
      i.nomeCliente,
      i.data ? i.data.split("-").reverse().join("/") : "",
      i.nomeSituacao || "",
      formatBRL(i.receita),
      formatBRL(i.receitaProdutos),
      formatBRL(i.receitaServicos),
      formatBRL(i.custoDireto),
      formatPct(i.margemDiretaPct),
    ]),
    {
      columnStyles: {
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" },
        8: { halign: "right" },
      },
    }
  );

  y = sectionTable(
    doc,
    y,
    [["Composição do resultado do conjunto", "Valor"]],
    [
      ...composicaoGrupo(g).map(([l, v]) => [l, formatBRL(v)]),
      ["RESULTADO", `${formatBRL(g.lucro)} (${formatPct(g.margemLiquidaPct)})`],
    ],
    { columnStyles: { 1: { halign: "right" } } }
  );

  for (const item of g.itens) {
    y = sectionTable(
      doc,
      y,
      [[`Itens do orçamento #${item.codigo}`, "Tipo", "Qtd", "Custo un.", "Venda un.", "Custo total", "Receita", "Margem"]],
      item.linhas.map((l) => [
        [l.nome, l.detalhes].filter(Boolean).join(" · "),
        l.tipo === "produto" ? "Peça" : "Serviço",
        l.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
        l.semCusto ? "sem custo" : formatBRL(l.valorUnitCusto),
        formatBRL(l.valorUnitVenda),
        formatBRL(l.custo),
        formatBRL(l.receita),
        `${formatBRL(l.margemBruta)} (${formatPct(l.margemBrutaPct)})`,
      ]),
      {
        columnStyles: {
          0: { cellWidth: 85 },
          2: { halign: "right" },
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right" },
          6: { halign: "right" },
          7: { halign: "right" },
        },
      }
    );
  }

  sectionTable(doc, y, [["Parâmetros globais", "Valor"]], configRows(g.config).slice(1).map(([l, v]) => [
    String(l),
    String(v).replace(".", ","),
  ]), { columnStyles: { 1: { halign: "right" } } });

  pdfFooter(doc);
  doc.save(`analise-conjunto-${fileStamp()}.pdf`);
}
