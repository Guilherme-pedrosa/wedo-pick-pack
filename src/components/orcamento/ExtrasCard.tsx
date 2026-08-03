import { Coins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AnalysisConfig,
  ExtrasInput,
  ExtrasResumo,
  formatBRL,
} from "@/api/orcamentoAnalysis";

interface Props {
  config: AnalysisConfig;
  extras: ExtrasInput;
  resumo: ExtrasResumo;
  onChange: (patch: Partial<ExtrasInput>) => void;
  title?: string;
}

function NumField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        value={String(value).replace(".", ",")}
        onChange={(e) => onChange(parseFloat(e.target.value.replace(",", ".")) || 0)}
      />
    </div>
  );
}

export default function ExtrasCard({ config, extras, resumo, onChange, title }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="h-4 w-4 text-primary" />
          {title ?? "Custos operacionais"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <NumField id="ex-dias" label="Dias de atendimento" value={extras.dias} onChange={(n) => onChange({ dias: n })} />
          <NumField id="ex-tec" label="Técnicos" value={extras.tecnicos} onChange={(n) => onChange({ tecnicos: n })} />
          <NumField
            id="ex-adm"
            label="Horas administrativas"
            value={extras.horasAdmin}
            onChange={(n) => onChange({ horasAdmin: n })}
          />
          <NumField id="ex-ped" label="Pedágio (R$)" value={extras.pedagio} onChange={(n) => onChange({ pedagio: n })} />
          <NumField
            id="ex-hot"
            label="Hospedagem (R$)"
            value={extras.hospedagem}
            onChange={(n) => onChange({ hospedagem: n })}
          />
          <NumField
            id="ex-parc"
            label="Parcelas"
            value={extras.parcelas}
            onChange={(n) => onChange({ parcelas: n })}
          />
        </div>

        <div className="flex flex-wrap gap-4">
          {(
            [
              ["considerarAlimentacao", `Alimentação (${formatBRL(config.alimentacaoDia)}/dia/técnico)`],
              ["considerarAdmin", `MO administrativa (${formatBRL(config.moAdminHora)}/h)`],
              [
                "considerarPremiacao",
                `Premiação (${config.premiacaoPecaPct}% peças / ${config.premiacaoServicoPct}% serviços)`,
              ],
              ["considerarParcelamento", `Custo do parcelamento (CDB ${config.cdbAnualPct}% a.a. — 1x = sem custo)`],
            ] as Array<[keyof ExtrasInput, string]>
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <Switch
                checked={Boolean(extras[key])}
                onCheckedChange={(v) => onChange({ [key]: v } as Partial<ExtrasInput>)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Alimentação", resumo.alimentacao],
            ["MO administrativa", resumo.moAdmin],
            ["Premiação", resumo.premiacao],
            ["Pedágio", resumo.pedagio],
            ["Hospedagem", resumo.hospedagem],
            ...(resumo.parcelamento > 0
              ? ([
                  [
                    `Parcelamento (${resumo.parcelamentoPct.toFixed(2).replace(".", ",")}% em ${resumo.parcelas}x)`,
                    resumo.parcelamento,
                  ],
                ] as [string, number][])
              : []),
            ...(resumo.restorno > 0
              ? ([[`Restorno (${resumo.restornoPct}%)`, resumo.restorno]] as [string, number][])
              : []),
            ["Total extras", resumo.total],
          ].map(([label, v], arr, all) => (
            <div key={label as string}>
              <p className="text-xs text-muted-foreground">{label as string}</p>
              <p
                className={
                  label === "Total extras" ? "font-bold tabular-nums" : "font-semibold tabular-nums"
                }
              >
                {formatBRL(v as number)}
              </p>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Premiação estimada: {formatBRL(resumo.premiacaoPecas)} em peças + {formatBRL(resumo.premiacaoServicos)} em
          serviços. Ajuste os percentuais em Parâmetros quando o cliente tiver contrato com taxa diferente.
          {` Custo do parcelamento: CDB de ${config.cdbAnualPct}% a.a. dividido por ${resumo.parcelas} parcela(s) sobre o faturamento.`}
          {resumo.restorno > 0 &&
            ` Cliente Sapore: restorno de ${resumo.restornoPct}% sobre o faturamento aplicado automaticamente.`}
        </p>

      </CardContent>
    </Card>
  );
}
