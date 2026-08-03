import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  Calculator,
  Route,
  Loader2,
  Search,
  Settings2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,

} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import ExtrasCard from "@/components/orcamento/ExtrasCard";
import GrupoAnalysisPanel from "@/components/orcamento/GrupoAnalysisPanel";
import {
  AnalysisConfig,
  OrcamentoAnalysis,
  DeslocamentoInput,
  DEFAULT_DESLOCAMENTO,
  ExtrasInput,
  analyzeOrcamento,
  buildParecer,
  defaultExtras,
  fetchOrcamentoByCodigo,
  formatBRL,
  formatPct,
  loadAnalysisConfig,
  fetchAnalysisConfig,
  saveAnalysisConfig,
} from "@/api/orcamentoAnalysis";


function KpiCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "warning";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={cn(
            "mt-1 text-xl font-bold tabular-nums",
            tone === "positive" && "text-emerald-500",
            tone === "negative" && "text-destructive",
            tone === "warning" && "text-amber-500"
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function OrcamentoAnalysisPage() {
  const [codigo, setCodigo] = useState("");
  const [tab, setTab] = useState("individual");
  const [config, setConfig] = useState<AnalysisConfig>(() => loadAnalysisConfig());
  const [showConfig, setShowConfig] = useState(false);
  const [rawOrc, setRawOrc] = useState<any | null>(null);
  const [analysis, setAnalysis] = useState<OrcamentoAnalysis | null>(null);
  const [desl, setDesl] = useState<DeslocamentoInput>({ ...DEFAULT_DESLOCAMENTO });
  const [extras, setExtras] = useState<ExtrasInput>(() => defaultExtras(loadAnalysisConfig()));
  const rawOrcRef = useRef<any | null>(null);
  const deslRef = useRef<DeslocamentoInput>(desl);
  const extrasRef = useRef<ExtrasInput>(extras);
  deslRef.current = desl;
  extrasRef.current = extras;
  rawOrcRef.current = rawOrc;

  // Parâmetros globais: carrega do banco (fonte da verdade para todos os usuários)
  useEffect(() => {
    let active = true;
    fetchAnalysisConfig()
      .then((cfg) => {
        if (!active) return;
        setConfig(cfg);
        setExtras((prev) => ({ ...prev, horasAdmin: prev.horasAdmin || cfg.moAdminHorasPadrao }));
        if (rawOrcRef.current) {
          setAnalysis(analyzeOrcamento(rawOrcRef.current, cfg, deslRef.current, extrasRef.current));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const mutation = useMutation({
    mutationFn: async (code: string) => fetchOrcamentoByCodigo(code),
    onSuccess: (orc) => {
      setRawOrc(orc);
      const next: DeslocamentoInput = { ...desl, modo: "auto" };
      setDesl(next);
      setAnalysis(analyzeOrcamento(orc, config, next, extras));
    },
    onError: () => {
      setRawOrc(null);
      setAnalysis(null);
    },
  });

  const updateConfig = (patch: Partial<AnalysisConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    if (rawOrc) setAnalysis(analyzeOrcamento(rawOrc, next, desl, extras));
    saveAnalysisConfig(next).catch(() => {
      toast.error("Não foi possível salvar os parâmetros para todos os usuários.");
    });
  };

  const updateDesl = (patch: Partial<DeslocamentoInput>) => {
    const next = { ...desl, ...patch };
    setDesl(next);
    if (rawOrc) setAnalysis(analyzeOrcamento(rawOrc, config, next, extras));
  };

  const updateExtras = (patch: Partial<ExtrasInput>) => {
    const next = { ...extras, ...patch };
    setExtras(next);
    if (rawOrc) setAnalysis(analyzeOrcamento(rawOrc, config, desl, next));
  };

  const parecer = analysis ? buildParecer(analysis) : null;




  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Calculator className="h-6 w-6 text-primary" />
            Análise de Custos de Orçamentos
          </h1>
          <p className="text-sm text-muted-foreground">
            Avalie venda, custo, impostos e rentabilidade de um orçamento ou de vários do mesmo cliente.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowConfig((v) => !v)}>
          <Settings2 className="mr-2 h-4 w-4" />
          Parâmetros
        </Button>
      </header>

      {showConfig && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Parâmetros globais</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              {(
                [
                  ["impostoPct", "Impostos (%)"],
                  ["custoFixoPct", "Custo fixo (%)"],
                  ["garantiaPct", "Garantia (%)"],
                  ["margemMinima", "Margem mínima (%)"],
                  ["margemMeta", "Margem meta (%)"],
                  ["custoPorKm", "Custo por km (R$)"],
                  ["alimentacaoDia", "Alimentação por dia/técnico (R$)"],
                  ["moAdminHora", "MO administrativa (R$/h)"],
                  ["moAdminHorasPadrao", "Horas administrativas padrão"],
                  ["premiacaoPecaPct", "Premiação peças (%)"],
                  ["premiacaoServicoPct", "Premiação serviços (%)"],
                  ["cdbAnualPct", "CDB anual (%)"],
                ] as Array<[keyof AnalysisConfig, string]>
              ).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={key} className="text-xs">
                    {label}
                  </Label>
                  <Input
                    id={key}
                    inputMode="decimal"
                    value={String(config[key]).replace(".", ",")}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value.replace(",", ".")) || 0;
                      updateConfig({ [key]: n } as Partial<AnalysisConfig>);
                    }}
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Os parâmetros ficam salvos no sistema e valem para todos os usuários até alguém alterá-los.
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="individual">Orçamento individual</TabsTrigger>
          <TabsTrigger value="conjunto">Conjunto (mesmo cliente)</TabsTrigger>
        </TabsList>

        <TabsContent value="individual" className="space-y-6">
      <Card>
        <CardContent className="p-4">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (codigo.trim()) mutation.mutate(codigo.trim());
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="codigo">Número do orçamento</Label>
              <Input
                id="codigo"
                inputMode="numeric"
                placeholder="Ex.: 6278"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={!codigo.trim() || mutation.isPending} className="sm:w-40">
              {mutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Analisar
            </Button>
          </form>

          {mutation.isError && (
            <p className="mt-3 flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {(mutation.error as Error)?.message || "Erro ao consultar o orçamento."}
            </p>
          )}
        </CardContent>
      </Card>


      {mutation.isPending && (
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {!mutation.isPending && !analysis && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Calculator className="h-10 w-10 text-muted-foreground/50" />
            <p className="font-medium text-foreground">Nenhum orçamento analisado</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Informe o número do orçamento (o mesmo código exibido no GestãoClick) para gerar o parecer
              financeiro com receita, custos, impostos, lucro e margem líquida.
            </p>
          </CardContent>
        </Card>
      )}

      {analysis && parecer && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-lg">
                  Orçamento #{analysis.codigo} — {analysis.nomeCliente}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{analysis.nomeSituacao}</Badge>
                  {analysis.data && (
                    <Badge variant="outline">
                      {analysis.data.split("-").reverse().join("/")}
                    </Badge>
                  )}
                  {analysis.nomeVendedor && (
                    <Badge variant="outline">Vendedor: {analysis.nomeVendedor}</Badge>
                  )}
                  <Button size="sm" variant="outline" onClick={() => exportOrcamentoXLSX(analysis)}>
                    <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                    Excel
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => exportOrcamentoPDF(analysis)}>
                    <FileText className="mr-1.5 h-4 w-4" />
                    PDF
                  </Button>
                </div>

              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Route className="h-4 w-4 text-primary" />
                Custo de deslocamento
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["auto", "Considerar (do orçamento)"],
                    ["manual", "Editar km"],
                    ["ignorar", "Não considerar"],
                  ] as Array<[typeof desl.modo, string]>
                ).map(([modo, label]) => (
                  <Button
                    key={modo}
                    type="button"
                    size="sm"
                    variant={desl.modo === modo ? "default" : "outline"}
                    onClick={() =>
                      updateDesl({
                        modo,
                        km: modo === "manual" && !desl.km ? analysis.deslocamento.kmDetectado : desl.km,
                      })
                    }
                  >
                    {label}
                  </Button>
                ))}
              </div>

              {desl.modo === "manual" && (
                <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                  <div className="space-y-1.5">
                    <Label htmlFor="km" className="text-xs">
                      Km rodados
                    </Label>
                    <Input
                      id="km"
                      inputMode="decimal"
                      value={String(desl.km).replace(".", ",")}
                      onChange={(e) => updateDesl({ km: parseFloat(e.target.value.replace(",", ".")) || 0 })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="custoKm" className="text-xs">
                      Custo por km (R$)
                    </Label>
                    <Input
                      id="custoKm"
                      inputMode="decimal"
                      value={String(desl.custoPorKm ?? config.custoPorKm).replace(".", ",")}
                      onChange={(e) =>
                        updateDesl({ custoPorKm: parseFloat(e.target.value.replace(",", ".")) || 0 })
                      }
                    />
                  </div>
                </div>
              )}

              <div className="grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Km considerados</p>
                  <p className="font-semibold tabular-nums">
                    {analysis.deslocamento.km.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km
                    {analysis.deslocamento.kmDetectado > 0 && desl.modo === "manual" && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        (orçamento: {analysis.deslocamento.kmDetectado.toLocaleString("pt-BR", { maximumFractionDigits: 1 })})
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Custo do deslocamento</p>
                  <p className="font-semibold tabular-nums">{formatBRL(analysis.deslocamento.custoEstimado)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Faturado ao cliente</p>
                  <p
                    className={cn(
                      "font-semibold tabular-nums",
                      analysis.deslocamento.receita < analysis.deslocamento.custoEstimado && "text-amber-500"
                    )}
                  >
                    {formatBRL(analysis.deslocamento.receita)}
                  </p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {desl.modo === "ignorar"
                  ? "Deslocamento desconsiderado — use quando a viagem for aproveitada de outro atendimento."
                  : `O custo entra no resultado mesmo quando o deslocamento é dado de desconto ao cliente. Custo padrão: ${formatBRL(config.custoPorKm)}/km (ajustável em Parâmetros).`}
              </p>
            </CardContent>
          </Card>

          <ExtrasCard
            config={config}
            extras={extras}
            resumo={analysis.extras}
            onChange={updateExtras}
          />


          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

            <KpiCard label="Receita (venda)" value={formatBRL(analysis.receitaLiquida)} hint={`Peças ${formatBRL(analysis.receitaProdutos)} · Serviços ${formatBRL(analysis.receitaServicos)}`} />
            <KpiCard label="Custo total" value={formatBRL(analysis.custoTotal)} hint={`Margem bruta ${formatPct(analysis.margemBrutaPct)}`} />
            <KpiCard
              label={`Impostos (${formatPct(analysis.config.impostoPct, 0)})`}
              value={formatBRL(analysis.imposto)}
              hint={
                analysis.custoFixo + analysis.garantia > 0
                  ? `+ ${formatBRL(analysis.custoFixo + analysis.garantia)} custo fixo/garantia`
                  : undefined
              }
            />
            <KpiCard
              label="Lucro líquido"
              value={formatBRL(analysis.lucro)}
              hint={`Margem líquida ${formatPct(analysis.margemLiquidaPct)}`}
              tone={analysis.lucro < 0 ? "negative" : analysis.margemLiquidaPct < analysis.config.margemMinima ? "warning" : "positive"}
            />
          </div>

          <Card
            className={cn(
              "border-l-4",
              parecer.veredito === "prejuizo" && "border-l-destructive",
              parecer.veredito === "lucro-baixo" && "border-l-amber-500",
              parecer.veredito === "lucro-ok" && "border-l-primary",
              parecer.veredito === "lucro-meta" && "border-l-emerald-500"
            )}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                {parecer.veredito === "prejuizo" ? (
                  <TrendingDown className="h-5 w-5 text-destructive" />
                ) : parecer.veredito === "lucro-meta" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : (
                  <TrendingUp className="h-5 w-5 text-primary" />
                )}
                {parecer.titulo}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">{parecer.resumo}</p>
              <p className="rounded-md bg-muted px-3 py-2 text-xs font-medium">{parecer.alcada}</p>
              <ul className="space-y-1.5">
                {parecer.recomendacoes.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Composição do resultado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {[
                ["Peças (venda)", analysis.receitaProdutos],
                ["Serviços (venda)", analysis.receitaServicos],
                ["Frete", analysis.receitaFrete],
                ["Desconto do cabeçalho", -analysis.descontoCabecalho],
                ["Custo das peças", -analysis.custoProdutos],
                ["Custo dos serviços", -analysis.custoServicos],
              ]
                .filter(([, v]) => (v as number) !== 0)
                .map(([label, v]) => (
                  <div key={label as string} className="flex justify-between border-b border-border/50 py-1">
                    <span className="text-muted-foreground">{label as string}</span>
                    <span className={cn("tabular-nums", (v as number) < 0 && "text-muted-foreground")}>
                      {formatBRL(v as number)}
                    </span>
                  </div>
                ))}

              {/* Deslocamento sempre visível, mesmo quando já está embutido no custo dos serviços */}
              <div className="flex justify-between border-b border-border/50 py-1">
                <span className="text-muted-foreground">
                  Custo de deslocamento{" "}
                  {analysis.deslocamento.modo === "ignorar"
                    ? "(desconsiderado)"
                    : `(${analysis.deslocamento.km.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km × ${formatBRL(analysis.deslocamento.custoPorKm)})`}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatBRL(-analysis.deslocamento.custoEstimado)}
                </span>
              </div>
              {analysis.deslocamento.custoJaNasLinhas > 0 && (
                <div className="flex justify-between border-b border-border/50 py-1">
                  <span className="text-muted-foreground">
                    (já contabilizado no custo dos serviços — estorno para não duplicar)
                  </span>
                  <span className="tabular-nums text-emerald-500">
                    {formatBRL(analysis.deslocamento.custoJaNasLinhas)}
                  </span>
                </div>
              )}

              {[

                ["Pedágio", -analysis.extras.pedagio],
                ["Hospedagem", -analysis.extras.hospedagem],
                ["Alimentação", -analysis.extras.alimentacao],
                ["MO administrativa", -analysis.extras.moAdmin],
                ["Premiação do técnico", -analysis.extras.premiacao],
                [
                  `Custo do parcelamento (${formatPct(analysis.extras.parcelamentoPct, 2)} em ${analysis.extras.parcelas}x)`,
                  -analysis.extras.parcelamento,
                ],
                [`Restorno Sapore (${formatPct(analysis.extras.restornoPct, 0)})`, -analysis.extras.restorno],
                [`Impostos (${formatPct(analysis.config.impostoPct, 0)})`, -analysis.imposto],
                ...(analysis.custoFixo > 0
                  ? ([[`Custo fixo (${formatPct(analysis.config.custoFixoPct, 0)})`, -analysis.custoFixo]] as Array<[string, number]>)
                  : []),
                ...(analysis.garantia > 0
                  ? ([[`Garantia (${formatPct(analysis.config.garantiaPct, 0)})`, -analysis.garantia]] as Array<[string, number]>)
                  : []),
              ]
                .filter(([, v]) => (v as number) !== 0)
                .map(([label, v]) => (
                  <div key={label as string} className="flex justify-between border-b border-border/50 py-1">
                    <span className="text-muted-foreground">{label as string}</span>
                    <span className={cn("tabular-nums", (v as number) < 0 && "text-muted-foreground")}>
                      {formatBRL(v as number)}
                    </span>
                  </div>
                ))}
              <div className="flex justify-between pt-2 text-base font-bold">
                <span>Resultado</span>
                <span className={cn("tabular-nums", analysis.lucro < 0 ? "text-destructive" : "text-emerald-500")}>
                  {formatBRL(analysis.lucro)} ({formatPct(analysis.margemLiquidaPct)})
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Itens do orçamento</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Custo un.</TableHead>
                      <TableHead className="text-right">Venda un.</TableHead>
                      <TableHead className="text-right">Custo total</TableHead>
                      <TableHead className="text-right">Receita</TableHead>
                      <TableHead className="text-right">Margem</TableHead>
                      <TableHead className="text-right">Markup</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analysis.linhas.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant={l.tipo === "produto" ? "secondary" : "outline"} className="shrink-0">
                              {l.tipo === "produto" ? "Peça" : "Serviço"}
                            </Badge>
                            <div className="min-w-0">
                              <p className="truncate font-medium">{l.nome}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {[l.detalhes, l.tabela].filter(Boolean).join(" · ")}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {l.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {l.semCusto ? (
                            <span className="text-amber-500">sem custo</span>
                          ) : (
                            formatBRL(l.valorUnitCusto)
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(l.valorUnitVenda)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(l.custo)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(l.receita)}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums font-medium",
                            l.margemBruta < 0
                              ? "text-destructive"
                              : l.margemBrutaPct < 10
                                ? "text-amber-500"
                                : "text-emerald-500"
                          )}
                        >
                          {formatBRL(l.margemBruta)}
                          <span className="ml-1 text-xs opacity-70">({formatPct(l.margemBrutaPct)})</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {l.semCusto ? "—" : formatPct(l.markupPct, 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
        </TabsContent>

        <TabsContent value="conjunto" className="space-y-6">
          <GrupoAnalysisPanel config={config} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

