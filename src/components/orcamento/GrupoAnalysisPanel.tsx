import { useMemo, useState } from "react";
import { Loader2, Plus, Search, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ExtrasCard from "./ExtrasCard";
import {
  AnalysisConfig,
  DEFAULT_DESLOCAMENTO,
  DeslocamentoInput,
  ExtrasInput,
  analyzeGrupo,
  defaultExtras,
  fetchOrcamentoByCodigo,
  formatBRL,
  formatPct,
} from "@/api/orcamentoAnalysis";

export default function GrupoAnalysisPanel({ config }: { config: AnalysisConfig }) {
  const [codigo, setCodigo] = useState("");
  const [loading, setLoading] = useState(false);
  const [orcamentos, setOrcamentos] = useState<any[]>([]);
  const [desl, setDesl] = useState<DeslocamentoInput>(DEFAULT_DESLOCAMENTO);
  const [extras, setExtras] = useState<ExtrasInput>(() => defaultExtras(config));

  const analysis = useMemo(
    () => (orcamentos.length ? analyzeGrupo(orcamentos, config, desl, extras) : null),
    [orcamentos, config, desl, extras]
  );

  const add = async () => {
    const cod = codigo.trim();
    if (!cod) return;
    setLoading(true);
    try {
      const orc = await fetchOrcamentoByCodigo(cod);
      const id = String(orc?.id ?? cod);
      if (orcamentos.some((o) => String(o?.id ?? "") === id)) {
        toast.info("Esse orçamento já está no conjunto.");
      } else {
        setOrcamentos((prev) => [...prev, orc]);
        setCodigo("");
      }
    } catch (e) {
      toast.error((e as Error)?.message || "Erro ao consultar o orçamento.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="grupo-codigo">Adicionar orçamento ao conjunto</Label>
              <Input
                id="grupo-codigo"
                inputMode="numeric"
                placeholder="Nº do orçamento"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={!codigo.trim() || loading} className="sm:w-40">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Adicionar
            </Button>
          </form>
        </CardContent>
      </Card>

      {!analysis && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <Search className="h-6 w-6" />
            Adicione dois ou mais orçamentos do mesmo cliente para avaliar o desconto total possível quando o
            atendimento é feito na mesma viagem.
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
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-primary" />
                Orçamentos do conjunto ({analysis.itens.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
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
                    {analysis.itens.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>
                          <p className="font-medium">#{i.codigo}</p>
                          <p className="text-xs text-muted-foreground">
                            {[i.data, i.nomeSituacao].filter(Boolean).join(" · ")}
                          </p>
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate">{i.nomeCliente}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(i.receita)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(i.custoDireto)}</TableCell>
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
                    ))}
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
