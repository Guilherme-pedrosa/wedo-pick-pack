import { useState, useEffect } from "react";
import {
  ClipboardCheck,
  AlertTriangle,
  CheckCircle2,
  Search,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import type { BoxData, BoxItemData } from "./BoxDetailDialog";

interface CheckinItemState {
  item: BoxItemData;
  devolvido: number;
  divergencia: number;
  tipo: "os" | "venda" | "divergencia" | "";
  ref: string;
  validado: boolean;
  reposto: boolean;
}

interface Props {
  box: BoxData | null;
  items: BoxItemData[];
  onClose: () => void;
  onCompleted: () => void;
}

export default function CheckinDialog({ box, items, onClose, onCompleted }: Props) {
  const { user, profile } = useAuth();
  const [checkinItems, setCheckinItems] = useState<CheckinItemState[]>([]);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState<string | null>(null);
  const [step, setStep] = useState<"conference" | "review">("conference");

  useEffect(() => {
    if (items.length > 0) {
      setCheckinItems(
        items.map((item) => ({
          item,
          devolvido: item.quantidade, // default: all returned
          divergencia: 0,
          tipo: "",
          ref: "",
          validado: false,
          reposto: false,
        }))
      );
    }
  }, [items]);

  const updateItem = (index: number, updates: Partial<CheckinItemState>) => {
    setCheckinItems((prev) =>
      prev.map((ci, i) => {
        if (i !== index) return ci;
        const updated = { ...ci, ...updates };
        updated.divergencia = ci.item.quantidade - updated.devolvido;
        return updated;
      })
    );
  };

  const hasDivergencias = checkinItems.some((ci) => ci.divergencia > 0);
  const allDivergenciasValidated = checkinItems
    .filter((ci) => ci.divergencia > 0)
    .every((ci) => ci.tipo && ci.ref && ci.validado);

  const handleValidateRef = async (index: number) => {
    const ci = checkinItems[index];
    if (!ci.ref || !ci.tipo) return;

    const label = ci.tipo === "os" ? "OS" : "Venda";
    setValidating(ci.item.id);
    try {
      // Step 1: Search by code to find the internal ID
      const searchPath =
        ci.tipo === "os"
          ? `/api/ordens_servicos?pesquisa=${encodeURIComponent(ci.ref)}`
          : `/api/vendas?pesquisa=${encodeURIComponent(ci.ref)}`;

      const { data: searchData, error: searchError } = await supabase.functions.invoke("gc-proxy", {
        body: { path: searchPath, method: "GET" },
      });

      if (searchError) throw searchError;

      if (!searchData?._proxy?.ok) {
        toast.error(`Erro ao buscar ${label} #${ci.ref}`);
        return;
      }

      // Find the matching record by code
      const results: any[] = searchData?.data || [];
      const match = results.find(
        (r: any) => String(r.codigo) === String(ci.ref) || String(r.numero) === String(ci.ref)
      );

      if (!match) {
        toast.error(`${label} #${ci.ref} não encontrada no GestãoClick`);
        return;
      }

      // Step 2: Fetch the full record by internal ID to get products
      const detailId = match.id || match.ordem_servico_id || match.venda_id;
      const detailPath =
        ci.tipo === "os"
          ? `/api/ordens_servicos/${detailId}`
          : `/api/vendas/${detailId}`;

      const { data: detailData, error: detailError } = await supabase.functions.invoke("gc-proxy", {
        body: { path: detailPath, method: "GET" },
      });

      if (detailError) throw detailError;

      if (!detailData?._proxy?.ok) {
        toast.error(`Erro ao carregar detalhes da ${label} #${ci.ref}`);
        return;
      }

      // Check if product exists in the order
      const orderData = detailData?.data;
      const produtos = orderData?.produtos || [];
      const found = produtos.some(
        (p: any) =>
          p?.produto?.produto_id === ci.item.produto_id ||
          String(p?.produto?.produto_id) === ci.item.produto_id
      );

      if (!found) {
        toast.warning(
          `Produto "${ci.item.nome_produto}" não encontrado na ${label} #${ci.ref}`
        );
        return;
      }

      updateItem(index, { validado: true });
      toast.success(`Validado: produto encontrado na ${label} #${ci.ref}`);
    } catch (e) {
      toast.error("Erro ao validar referência");
      console.error(e);
    } finally {
      setValidating(null);
    }
  };

  const handleComplete = async () => {
    if (!box || !user) return;
    setSaving(true);
    try {
      // Create checkin record
      const { data: record, error: recordError } = await supabase
        .from("box_checkin_records")
        .insert({
          box_id: box.id,
          operator_id: user.id,
          operator_name: profile?.name || user.email || "",
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (recordError) throw recordError;

      // Insert checkin items
      const checkinItemsData = checkinItems.map((ci) => ({
        checkin_id: record.id,
        box_id: box.id,
        produto_id: ci.item.produto_id,
        nome_produto: ci.item.nome_produto,
        quantidade_esperada: ci.item.quantidade,
        quantidade_devolvida: ci.devolvido,
        divergencia: ci.divergencia,
        justificativa_tipo: ci.divergencia > 0 ? ci.tipo || null : null,
        justificativa_ref: ci.divergencia > 0 ? ci.ref || null : null,
        justificativa_validada: ci.validado,
        reposto: ci.reposto,
      }));

      const { error: itemsError } = await supabase
        .from("box_checkin_items")
        .insert(checkinItemsData);

      if (itemsError) throw itemsError;

      // Update box items based on restock decisions
      for (const ci of checkinItems) {
        if (ci.reposto) {
          // Keep original quantity (restocked)
          continue;
        } else {
          // Set quantity to returned amount
          if (ci.devolvido === 0) {
            await supabase.from("box_items").delete().eq("id", ci.item.id);
          } else {
            await supabase
              .from("box_items")
              .update({ quantidade: ci.devolvido })
              .eq("id", ci.item.id);
          }
        }
      }

      // Close the box after check-in
      await supabase
        .from("boxes")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("id", box.id);

      toast.success("Check-in concluído! Caixa fechada.");
      onCompleted();
    } catch (e) {
      toast.error("Erro ao concluir check-in");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!box) return null;

  return (
    <Dialog open={!!box} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Check-in: {box.name}
            {box.technician_name && (
              <Badge variant="outline" className="text-xs">
                Técnico: {box.technician_name}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {step === "conference" && (
          <>
            <p className="text-sm text-muted-foreground">
              Informe a quantidade devolvida para cada item. Divergências precisam de justificativa.
            </p>
            <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
              {checkinItems.map((ci, index) => (
                <div
                  key={ci.item.id}
                  className={`p-3 rounded-lg border ${
                    ci.divergencia > 0
                      ? "border-warning/30 bg-warning/5"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ci.item.nome_produto}</p>
                      <p className="text-xs text-muted-foreground">
                        ID: {ci.item.produto_id} · Esperado: {ci.item.quantidade}
                      </p>
                    </div>
                    {ci.divergencia > 0 && (
                      <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-xs">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        -{ci.divergencia}
                      </Badge>
                    )}
                    {ci.divergencia === 0 && ci.devolvido > 0 && (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs whitespace-nowrap">Devolvido:</Label>
                      <Input
                        type="number"
                        value={ci.devolvido}
                        onChange={(e) =>
                          updateItem(index, {
                            devolvido: Math.max(
                              0,
                              Math.min(ci.item.quantidade, parseInt(e.target.value) || 0)
                            ),
                          })
                        }
                        className="w-16 h-7 text-center text-sm"
                        min={0}
                        max={ci.item.quantidade}
                      />
                    </div>
                  </div>

                  {/* Divergence justification */}
                  {ci.divergencia > 0 && (
                    <div className="mt-3 space-y-2 pl-2 border-l-2 border-warning/30">
                      <p className="text-xs font-medium text-warning">
                        Justifique a divergência de {ci.divergencia} unidade(s):
                      </p>
                      <div className="flex gap-2">
                        <Select
                          value={ci.tipo}
                          onValueChange={(v) =>
                            updateItem(index, { tipo: v as any, validado: false })
                          }
                        >
                          <SelectTrigger className="w-28 h-7 text-xs">
                            <SelectValue placeholder="Tipo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="os">OS</SelectItem>
                            <SelectItem value="venda">Venda</SelectItem>
                          </SelectContent>
                        </Select>
                        {ci.tipo && (
                          <>
                            <Input
                              value={ci.ref}
                              onChange={(e) =>
                                updateItem(index, { ref: e.target.value, validado: false })
                              }
                              placeholder={`Nº da ${ci.tipo === "os" ? "OS" : "Venda"}`}
                              className="flex-1 h-7 text-xs"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => handleValidateRef(index)}
                              disabled={!ci.ref || validating === ci.item.id}
                            >
                              {validating === ci.item.id ? "..." : "Validar"}
                            </Button>
                          </>
                        )}
                      </div>
                      {ci.validado && (
                        <Badge className="bg-success/10 text-success border-success/20 text-xs">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Validado
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                onClick={() => setStep("review")}
                disabled={hasDivergencias && !allDivergenciasValidated}
              >
                Próximo: Reposição
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "review" && (
          <>
            <p className="text-sm text-muted-foreground">
              Para cada item com divergência, informe se o saldo foi reposto na caixa.
            </p>
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
              {checkinItems
                .filter((ci) => ci.divergencia > 0)
                .map((ci) => {
                  const index = checkinItems.indexOf(ci);
                  return (
                    <div key={ci.item.id} className={`flex items-center gap-3 p-3 rounded-lg border ${
                      !ci.validado ? "bg-destructive/5 border-destructive/30" : "bg-card border-border"
                    }`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{ci.item.nome_produto}</p>
                        <p className="text-xs text-muted-foreground">
                          Divergência: {ci.divergencia} · {ci.tipo === "os" ? "OS" : ci.tipo === "venda" ? "Venda" : "Divergência"}: {ci.ref}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant={ci.reposto ? "default" : "outline"}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => updateItem(index, { reposto: true })}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Repor
                        </Button>
                        <Button
                          variant={!ci.reposto ? "default" : "outline"}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => updateItem(index, { reposto: false })}
                        >
                          Não repor
                        </Button>
                      </div>
                    </div>
                  );
                })}
              {!hasDivergencias && (
                <div className="text-center py-6 text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-success" />
                  <p className="text-sm">Tudo confere! Nenhuma divergência encontrada.</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("conference")}>
                Voltar
              </Button>
              <Button onClick={handleComplete} disabled={saving || (hasDivergencias && !allDivergenciasValidated)}>
                {saving ? "Salvando..." : "Concluir Check-in"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
