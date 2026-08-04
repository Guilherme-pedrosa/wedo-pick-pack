import { Fragment, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { exportGrupoPDF, exportGrupoXLSX } from "@/lib/orcamentoExport";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { deslocamentoMemoRows, extrasMemoRows, resultadoMemo } from "@/lib/orcamentoMemoria";

import ExtrasCard from "./ExtrasCard";
import {
  AnalysisConfig,
  ClienteResumo,
  DEFAULT_DESLOCAMENTO,
  DeslocamentoInput,
  ExtrasInput,
  OrcamentoResumo,
  analyzeGrupo,
  defaultExtras,
  fetchOrcamentoById,
  formatBRL,
  formatPct,
  searchClientes,
  searchOrcamentosByCliente,
} from "@/api/orcamentoAnalysis";

export default function GrupoAnalysisPanel({ config }: { config: AnalysisConfig }) {
  const [cliente, setCliente] = useState("");
  const [dias, setDias] = useState(30);
  const [buscando, setBuscando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [clientes, setClientes] = useState<ClienteResumo[] | null>(null);
  const [clienteSel, setClienteSel] = useState<ClienteResumo | null>(null);
  const [resultados, setResultados] = useState<OrcamentoResumo[] | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [orcamentos, setOrcamentos] = useState<any[]>([]);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [desl, setDesl] = useState<DeslocamentoInput>(DEFAULT_DESLOCAMENTO);
  const [extras, setExtras] = useState<ExtrasInput>(() => defaultExtras(config));
  const [mostrarMemoria, setMostrarMemoria] = useState(true);


  const analysis = useMemo(
    () => (orcamentos.length ? analyzeGrupo(orcamentos, config, desl, extras) : null),
    [orcamentos, config, desl, extras]
  );

  const buscarClientes = async () => {
    setBuscando(true);
    setResultados(null);
    setClienteSel(null);
    try {
      const list = await searchClientes(cliente);
      setClientes(list);
      if (!list.length) toast.info("Nenhum cliente encontrado com esse termo.");
    } catch (e) {
      toast.error((e as Error)?.message || "Erro ao buscar clientes.");
    } finally {
      setBuscando(false);
    }
  };

  const carregarOrcamentos = async (c: ClienteResumo, janela = dias) => {
    setClienteSel(c);
    setBuscando(true);
    try {
      const list = await searchOrcamentosByCliente({ id: c.id, nome: c.nome }, janela);
      setResultados(list);
      setSelecionados(new Set());
      if (!list.length) toast.info(`Nenhum orçamento de ${c.nome} nos últimos ${janela} dias.`);
    } catch (e) {
      toast.error((e as Error)?.message || "Erro ao buscar orçamentos.");
    } finally {
      setBuscando(false);
    }
  };


  const toggle = (id: string) =>
    setSelecionados((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const carregarSelecionados = async () => {
    const ids = Array.from(selecionados);
    if (!ids.length) return;
    setCarregando(true);
    try {
      const carregados = await Promise.all(ids.map((id) => fetchOrcamentoById(id)));
      setOrcamentos((prev) => {
        const map = new Map(prev.map((o) => [String(o?.id ?? ""), o]));
        carregados.forEach((o) => map.set(String(o?.id ?? ""), o));
        return Array.from(map.values());
      });
      setSelecionados(new Set());
    } catch (e) {
      toast.error((e as Error)?.message || "Erro ao carregar orçamentos.");
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-4">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              buscarClientes();
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="grupo-cliente">Cliente</Label>
              <Input
                id="grupo-cliente"
                placeholder="Digite parte do nome do cliente (ex.: sapore)"
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
              />
            </div>
            <div className="w-32 space-y-1.5">
              <Label htmlFor="grupo-dias">Últimos (dias)</Label>
              <Input
                id="grupo-dias"
                inputMode="numeric"
                value={String(dias)}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10) || 0;
                  setDias(v);
                }}
                onBlur={() => clienteSel && carregarOrcamentos(clienteSel)}
              />
            </div>
            <Button type="submit" disabled={cliente.trim().length < 3 || buscando} className="sm:w-40">
              {buscando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Buscar cliente
            </Button>
          </form>

          {clientes && clientes.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                {clienteSel ? "Cliente selecionado" : "Selecione o cliente"}
              </Label>
              <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
                {clientes.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => carregarOrcamentos(c)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/60",
                      clienteSel?.id === c.id && "bg-primary/10"
                    )}
                  >
                    <span className="truncate font-medium">{c.nome}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {[c.documento, c.cidade].filter(Boolean).join(" • ")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {clienteSel && resultados && resultados.length === 0 && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Nenhum orçamento de {clienteSel.nome} nos últimos {dias} dias. Aumente a janela de dias.
            </p>
          )}

          {resultados && resultados.length > 0 && (

            <div className="space-y-3">
              <div className="max-h-80 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Orçamento</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultados.map((r) => {
                      const jaNoConjunto = orcamentos.some((o) => String(o?.id ?? "") === r.id);
                      return (
                        <TableRow
                          key={r.id}
                          className={cn("cursor-pointer", jaNoConjunto && "opacity-50")}
                          onClick={() => !jaNoConjunto && toggle(r.id)}
                        >
                          <TableCell>
                            <Checkbox checked={jaNoConjunto || selecionados.has(r.id)} disabled={jaNoConjunto} />
                          </TableCell>
                          <TableCell>
                            <p className="font-medium">#{r.codigo}</p>
                            <p className="text-xs text-muted-foreground">{r.data}</p>
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate">{r.nomeCliente}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{r.nomeSituacao}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatBRL(r.valorTotal)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <Button onClick={carregarSelecionados} disabled={!selecionados.size || carregando}>
                {carregando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Adicionar {selecionados.size || ""} ao conjunto
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!analysis && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <Search className="h-6 w-6" />
            Busque pelo cliente, selecione os orçamentos dos últimos {dias} dias e avalie o desconto total possível
            quando o atendimento é feito na mesma viagem.
          </CardContent>
        </Card>
      )}


      {analysis && (
        <>
          {!analysis.mesmoCliente && (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
              Atenção: o conjunto tem clientes diferentes ({analysis.clientes.join(", ")}). Os custos compartilhados só
              fazem sentido se o atendimento for realmente na mesma viagem.
            </p>
          )}

          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4 text-primary" />
                  Orçamentos do conjunto ({analysis.itens.length})
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => exportGrupoXLSX(analysis)}>
                    <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                    Excel
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => exportGrupoPDF(analysis)}>
                    <FileText className="mr-1.5 h-4 w-4" />
                    PDF
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Orçamento</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="text-right">Receita</TableHead>
                      <TableHead className="text-right">Custo direto</TableHead>
                      <TableHead className="text-right">Margem direta</TableHead>
                      <TableHead className="text-right">Km</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analysis.itens.map((i) => {
                      const aberto = expandidos.has(i.id);
                      const produtos = i.linhas.filter((l) => l.tipo === "produto");
                      const servicos = i.linhas.filter((l) => l.tipo === "servico");
                      return (
                        <Fragment key={i.id}>
                          <TableRow>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={aberto ? "Ocultar itens" : "Ver itens"}
                                onClick={() =>
                                  setExpandidos((prev) => {
                                    const next = new Set(prev);
                                    next.has(i.id) ? next.delete(i.id) : next.add(i.id);
                                    return next;
                                  })
                                }
                              >
                                {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </Button>
                            </TableCell>
                            <TableCell>
                              <p className="font-medium">#{i.codigo}</p>
                              <p className="text-xs text-muted-foreground">
                                {[i.data, i.nomeSituacao].filter(Boolean).join(" · ")}
                              </p>
                            </TableCell>
                            <TableCell className="max-w-[220px] truncate">{i.nomeCliente}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatBRL(i.receita)}
                              <p className="text-xs text-muted-foreground">
                                Peças {formatBRL(i.receitaProdutos)} · Serv. {formatBRL(i.receitaServicos)}
                              </p>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatBRL(i.custoDireto)}
                              <p className="text-xs text-muted-foreground">
                                Peças {formatBRL(i.custoProdutos)} · Serv. {formatBRL(i.custoServicos)}
                              </p>
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right tabular-nums",
                                i.margemDiretaPct < 0 ? "text-destructive" : "text-emerald-500"
                              )}
                            >
                              {formatPct(i.margemDiretaPct)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{i.kmDetectado || "—"}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  setOrcamentos((prev) => prev.filter((o) => String(o?.id ?? "") !== i.id))
                                }
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </TableCell>
                          </TableRow>
                          {aberto && (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={8} className="bg-muted/30 p-0">
                                {i.linhas.length === 0 ? (
                                  <p className="px-4 py-3 text-xs text-muted-foreground">
                                    Este orçamento não tem itens detalhados no GestãoClick.
                                  </p>
                                ) : (
                                  <div className="overflow-x-auto p-3">
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
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {[...produtos, ...servicos].map((l, idx) => (
                                          <TableRow key={`${i.id}-l-${idx}`}>
                                            <TableCell>
                                              <div className="flex items-center gap-2">
                                                <Badge
                                                  variant={l.tipo === "produto" ? "secondary" : "outline"}
                                                  className="shrink-0"
                                                >
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
                                            <TableCell className="text-right tabular-nums">
                                              {formatBRL(l.valorUnitVenda)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                              {formatBRL(l.custo)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                              {formatBRL(l.receita)}
                                            </TableCell>
                                            <TableCell
                                              className={cn(
                                                "text-right font-medium tabular-nums",
                                                l.margemBruta < 0
                                                  ? "text-destructive"
                                                  : l.margemBrutaPct < 10
                                                    ? "text-amber-500"
                                                    : "text-emerald-500"
                                              )}
                                            >
                                              {formatBRL(l.margemBruta)}
                                              <span className="ml-1 text-xs opacity-70">
                                                ({formatPct(l.margemBrutaPct)})
                                              </span>
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>

              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Deslocamento do conjunto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["auto", "Automático (km dos orçamentos)"],
                    ["manual", "Informar km"],
                    ["ignorar", "Desconsiderar"],
                  ] as Array<[DeslocamentoInput["modo"], string]>
                ).map(([modo, label]) => (
                  <Button
                    key={modo}
                    size="sm"
                    variant={desl.modo === modo ? "default" : "outline"}
                    onClick={() => setDesl((d) => ({ ...d, modo }))}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {desl.modo === "manual" && (
                <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
                  <div className="space-y-1.5">
                    <Label htmlFor="grupo-km" className="text-xs">
                      Km totais
                    </Label>
                    <Input
                      id="grupo-km"
                      inputMode="decimal"
                      value={String(desl.km).replace(".", ",")}
                      onChange={(e) =>
                        setDesl((d) => ({ ...d, km: parseFloat(e.target.value.replace(",", ".")) || 0 }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="grupo-km-custo" className="text-xs">
                      Custo por km (R$)
                    </Label>
                    <Input
                      id="grupo-km-custo"
                      inputMode="decimal"
                      value={String(desl.custoPorKm ?? config.custoPorKm).replace(".", ",")}
                      onChange={(e) =>
                        setDesl((d) => ({
                          ...d,
                          custoPorKm: parseFloat(e.target.value.replace(",", ".")) || 0,
                        }))
                      }
                    />
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Custo do deslocamento do conjunto: {formatBRL(analysis.deslocamento.custoEstimado)} · adicional
                considerado: {formatBRL(analysis.custoDeslocamentoAdicional)}
              </p>
            </CardContent>
          </Card>

          <ExtrasCard
            config={config}
            extras={extras}
            resumo={analysis.extras}
            onChange={(patch) => setExtras((prev) => ({ ...prev, ...patch }))}
            title="Custos compartilhados do conjunto"
          />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Receita total", formatBRL(analysis.receitaLiquida), undefined],
              ["Custo total", formatBRL(analysis.custoTotal), `Direto ${formatBRL(analysis.custoDireto)}`],
              [
                "Impostos e rateios",
                formatBRL(analysis.imposto + analysis.custoFixo + analysis.garantia),
                undefined,
              ],
              [
                "Lucro líquido",
                formatBRL(analysis.lucro),
                `Margem ${formatPct(analysis.margemLiquidaPct)}`,
              ],
            ].map(([label, value, hint]) => (
              <Card key={label as string}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{label as string}</p>
                  <p
                    className={cn(
                      "text-xl font-bold tabular-nums",
                      label === "Lucro líquido" && (analysis.lucro < 0 ? "text-destructive" : "text-emerald-500")
                    )}
                  >
                    {value as string}
                  </p>
                  {hint && <p className="text-xs text-muted-foreground">{hint as string}</p>}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">

              <CardTitle className="text-base">Composição do resultado do conjunto</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setMostrarMemoria((v) => !v)}>
                  {mostrarMemoria ? "Ocultar memória de cálculo" : "Ver memória de cálculo"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => exportGrupoXLSX(analysis)}>
                  <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                  Excel
                </Button>
                <Button size="sm" variant="outline" onClick={() => exportGrupoPDF(analysis)}>
                  <FileText className="mr-1.5 h-4 w-4" />
                  PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {[
                {
                  label: "Peças (venda)",
                  valor: analysis.itens.reduce((s, i) => s + i.receitaProdutos, 0),
                  memo: `Soma da venda de peças de ${analysis.itens.length} orçamento(s): ${analysis.itens
                    .map((i) => `#${i.codigo} ${formatBRL(i.receitaProdutos)}`)
                    .join(" + ")}`,
                },
                {
                  label: "Serviços (venda)",
                  valor: analysis.itens.reduce((s, i) => s + i.receitaServicos, 0),
                  memo: `Soma da venda de serviços: ${analysis.itens
                    .map((i) => `#${i.codigo} ${formatBRL(i.receitaServicos)}`)
                    .join(" + ")}`,
                },
                {
                  label: "Custo das peças",
                  valor: -analysis.itens.reduce((s, i) => s + i.custoProdutos, 0),
                  memo: "Soma de (custo unitário × quantidade) das linhas de peças de cada orçamento.",
                },
                {
                  label: "Custo dos serviços",
                  valor: -analysis.itens.reduce((s, i) => s + i.custoServicos, 0),
                  memo: "Soma de (custo unitário × quantidade) das linhas de serviço de cada orçamento.",
                },
              ]
                .map((r) => (
                  <div key={r.label} className="border-b border-border/50 py-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className={cn("tabular-nums", r.valor < 0 && "text-muted-foreground")}>
                        {formatBRL(r.valor)}
                      </span>
                    </div>
                    {mostrarMemoria && <p className="pt-0.5 text-xs text-muted-foreground/70">{r.memo}</p>}
                  </div>
                ))}

              {[...deslocamentoMemoRows(analysis), ...extrasMemoRows(analysis, extras)]
                .filter((r) => r.valor !== 0 || r.tone !== "positivo")
                .map((r) => (
                  <div key={r.label} className="border-b border-border/50 py-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span
                        className={cn(
                          "tabular-nums",
                          r.tone === "positivo" ? "text-emerald-500" : "text-muted-foreground"
                        )}
                      >
                        {formatBRL(r.valor)}
                      </span>
                    </div>
                    {mostrarMemoria && <p className="pt-0.5 text-xs text-muted-foreground/70">{r.memo}</p>}
                  </div>
                ))}
              <div className="pt-2">
                <div className="flex justify-between text-base font-bold">
                  <span>Resultado</span>
                  <span className={cn("tabular-nums", analysis.lucro < 0 ? "text-destructive" : "text-emerald-500")}>
                    {formatBRL(analysis.lucro)} ({formatPct(analysis.margemLiquidaPct)})
                  </span>
                </div>
                {mostrarMemoria && (
                  <p className="pt-0.5 text-xs text-muted-foreground/70">{resultadoMemo(analysis)}</p>
                )}
              </div>

            </CardContent>
          </Card>



          <Card className="border-l-4 border-l-primary">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Desconto total possível no conjunto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Mantendo a margem mínima ({formatPct(config.margemMinima, 0)})
                  </p>
                  <p className="text-lg font-bold tabular-nums text-emerald-500">
                    {formatBRL(analysis.descontoMaxMinima)}{" "}
                    <span className="text-sm font-medium opacity-80">
                      ({formatPct(analysis.descontoMaxMinimaPct)})
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Mantendo a margem meta ({formatPct(config.margemMeta, 0)})
                  </p>
                  <p className="text-lg font-bold tabular-nums">
                    {formatBRL(analysis.descontoMaxMeta)}{" "}
                    <span className="text-sm font-medium opacity-80">
                      ({formatPct(analysis.descontoMaxMetaPct)})
                    </span>
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="font-normal">
                Valores considerando deslocamento, alimentação, hospedagem, pedágio, MO administrativa e premiação
                contados uma única vez para o conjunto.
              </Badge>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
