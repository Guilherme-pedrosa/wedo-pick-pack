import { useState, useEffect } from "react";
import {
  ClipboardCheck,
  AlertTriangle,
  CheckCircle2,
  Search,
  RotateCcw,
  ShieldAlert,
  PackageOpen,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { logBoxMovement } from "@/lib/boxMovementLog";

interface BaixaSuggestion {
  produtoId: string;
  quantidade: number;
  refTipo: "os" | "venda";
  refNumero: string;
}

interface CheckinItemState {
  item: BoxItemData;
  devolvido: number;
  divergencia: number;
  tipo: "os" | "venda" | "divergencia" | "";
  ref: string;
  validado: boolean;
  reposto: boolean;
  baixaSuggestions: BaixaSuggestion[];
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
  const [observacao, setObservacao] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loadingBaixas, setLoadingBaixas] = useState(false);

  useEffect(() => {
    if (!box || items.length === 0) return;

    const loadBaixaSuggestions = async () => {
      setLoadingBaixas(true);
      try {
        // Fetch all "baixa" movements for this box
        const { data: baixaLogs } = await supabase
          .from("box_movement_logs")
          .select("produto_id, produto_nome, quantidade, ref_tipo, ref_numero")
          .eq("box_id", box.id)
          .eq("action", "baixa")
          .not("ref_numero", "is", null);

        // Group by produto_id
        const suggestionsByProduct = new Map<string, BaixaSuggestion[]>();
        for (const log of baixaLogs || []) {
          if (!log.produto_id || !log.ref_tipo || !log.ref_numero) continue;
          const existing = suggestionsByProduct.get(log.produto_id) || [];
          // Merge same ref
          const sameRef = existing.find(
            (s) => s.refTipo === log.ref_tipo && s.refNumero === log.ref_numero
          );
          if (sameRef) {
            sameRef.quantidade += log.quantidade || 0;
          } else {
            existing.push({
              produtoId: log.produto_id,
              quantidade: log.quantidade || 0,
              refTipo: log.ref_tipo as "os" | "venda",
              refNumero: log.ref_numero,
            });
          }
          suggestionsByProduct.set(log.produto_id, existing);
        }

        setCheckinItems(
          items.map((item) => {
            const suggestions = suggestionsByProduct.get(item.produto_id) || [];
            const totalBaixa = suggestions.reduce((s, b) => s + b.quantidade, 0);
            const expectedReturn = Math.max(0, item.quantidade - totalBaixa);
            // If there are baixas, pre-fill devolvido and divergence info
            if (suggestions.length > 0) {
              return {
                item,
                devolvido: expectedReturn,
                divergencia: totalBaixa,
                tipo: suggestions[0].refTipo,
                ref: suggestions[0].refNumero,
                validado: false,
                reposto: false,
                baixaSuggestions: suggestions,
              };
            }
            return {
              item,
              devolvido: 0,
              divergencia: 0,
              tipo: "",
              ref: "",
              validado: false,
              reposto: false,
              baixaSuggestions: [],
            };
          })
        );
      } catch (e) {
        console.error("Error loading baixa suggestions:", e);
        // Fallback: no suggestions
        setCheckinItems(
          items.map((item) => ({
            item,
            devolvido: 0,
            divergencia: 0,
            tipo: "",
            ref: "",
            validado: false,
            reposto: false,
            baixaSuggestions: [],
          }))
        );
      } finally {
        setLoadingBaixas(false);
      }
    };

    loadBaixaSuggestions();
  }, [items, box]);

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

      // Check if the OS/Venda date is after the box creation date
      const orderData = detailData?.data;
      const orderDateStr = orderData?.cadastrado_em || orderData?.created_at;
      if (orderDateStr && box) {
        let orderDate: Date;
        const brMatch = String(orderDateStr).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (brMatch) {
          orderDate = new Date(parseInt(brMatch[3]), parseInt(brMatch[2]) - 1, parseInt(brMatch[1]));
        } else {
          orderDate = new Date(orderDateStr);
        }
        const boxCreatedAt = new Date(box.created_at);
        const orderDay = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate());
        const boxDay = new Date(boxCreatedAt.getFullYear(), boxCreatedAt.getMonth(), boxCreatedAt.getDate());
        if (isNaN(orderDay.getTime())) {
          console.warn("Could not parse order date:", orderDateStr);
        } else if (orderDay < boxDay) {
          toast.error(
            `${label} #${ci.ref} é de ${orderDay.toLocaleDateString("pt-BR")}, anterior à saída da caixa (${boxDay.toLocaleDateString("pt-BR")}). Não é permitido.`
          );
          return;
        }
      }

      // Check if product exists in the order
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

    // Safeguard: warn if ALL items will be removed (devolvido=0 and not restocked)
    const allWillBeRemoved = checkinItems.every((ci) => ci.devolvido === 0 && !ci.reposto);
    if (allWillBeRemoved && checkinItems.length > 0) {
      const confirmed = window.confirm(
        "⚠️ ATENÇÃO: Todos os itens estão com devolução ZERO e sem reposição. " +
        "Isso vai REMOVER todos os itens da caixa!\n\n" +
        "Se você quer devolver a caixa com todos os itens intactos, clique em 'Cancelar' " +
        "e use o botão 'Devolver tudo' na tela anterior.\n\n" +
        "Deseja continuar mesmo assim?"
      );
      if (!confirmed) return;
    }

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
          notes: observacao.trim() || null,
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

      // === REPLENISHMENT: update box_items for items marked as "reposto" ===
      const itemsToReplenish = checkinItems.filter(
        (ci) => ci.reposto && ci.baixaSuggestions.length > 0
      );
      for (const ci of itemsToReplenish) {
        const totalBaixa = ci.baixaSuggestions.reduce((s, b) => s + b.quantidade, 0);
        if (totalBaixa <= 0) continue;

        // Increase quantity back in box_items
        const { data: currentItem } = await supabase
          .from("box_items")
          .select("id, quantidade")
          .eq("box_id", box.id)
          .eq("produto_id", ci.item.produto_id)
          .maybeSingle();

        if (currentItem) {
          await supabase
            .from("box_items")
            .update({ quantidade: currentItem.quantidade + totalBaixa })
            .eq("id", currentItem.id);
        }

        // Log the replenishment
        const refs = ci.baixaSuggestions
          .map((s) => `${s.refTipo === "os" ? "OS" : "Venda"} #${s.refNumero} (${s.quantidade}x)`)
          .join(", ");
        await logBoxMovement({
          boxId: box.id,
          boxName: box.name,
          action: "adicao",
          produtoId: ci.item.produto_id,
          produtoNome: ci.item.nome_produto,
          quantidade: totalBaixa,
          precoUnitario: ci.item.preco_unitario || 0,
          details: `Reposição no check-in: ${refs}`,
        });
      }

      // Return box to stand by after check-in
      await supabase
        .from("boxes")
        .update({
          status: "active",
          closed_at: null,
          technician_name: null,
          technician_gc_id: null,
        })
        .eq("id", box.id);

      const totalDevolvido = checkinItems.reduce((s, ci) => s + ci.devolvido, 0);
      const totalEsperado = checkinItems.reduce((s, ci) => s + ci.item.quantidade, 0);
      const totalDivergencia = checkinItems.reduce((s, ci) => s + ci.divergencia, 0);
      const totalReposto = itemsToReplenish.reduce(
        (s, ci) => s + ci.baixaSuggestions.reduce((ss, b) => ss + b.quantidade, 0),
        0
      );

      await logBoxMovement({
        boxId: box.id,
        boxName: box.name,
        action: "entrada",
        quantidade: totalDevolvido,
        technicianName: box.technician_name || undefined,
        technicianGcId: box.technician_gc_id || undefined,
        details: `Check-in concluído. Esperado: ${totalEsperado}, Devolvido: ${totalDevolvido}, Divergências: ${totalDivergencia}${totalReposto > 0 ? `, Repostos: ${totalReposto}` : ""}`,
      });

      toast.success("Check-in concluído! Caixa retornou para Stand By.");
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
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {loadingBaixas ? (
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Carregando baixas...
                  </span>
                ) : (
                  "Informe a quantidade devolvida para cada item. Divergências precisam de justificativa."
                )}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="text-xs shrink-0"
                onClick={() => {
                  setCheckinItems((prev) =>
                    prev.map((ci) => ({
                      ...ci,
                      devolvido: ci.item.quantidade,
                      divergencia: 0,
                      tipo: "",
                      ref: "",
                      validado: false,
                    }))
                  );
                  toast.info("Todos os itens marcados como devolvidos integralmente.");
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Devolver tudo
              </Button>
            </div>
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

                  {/* Baixa suggestions */}
                  {ci.baixaSuggestions.length > 0 && (
                    <div className="mb-2 p-2 rounded-md bg-primary/5 border border-primary/20">
                      <div className="flex items-center gap-1.5 mb-1">
                        <PackageOpen className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-medium text-primary">Baixas registradas:</span>
                      </div>
                      <div className="space-y-0.5">
                        {ci.baixaSuggestions.map((s, si) => (
                          <p key={si} className="text-xs text-muted-foreground">
                            • {s.quantidade}x saiu na {s.refTipo === "os" ? "OS" : "Venda"} #{s.refNumero}
                            {" — "}
                            <button
                              type="button"
                              className="text-primary underline hover:text-primary/80"
                              onClick={() => updateItem(index, { tipo: s.refTipo, ref: s.refNumero, validado: false })}
                            >
                              usar como justificativa
                            </button>
                          </p>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 italic">
                        Devolução esperada: {Math.max(0, ci.item.quantidade - ci.baixaSuggestions.reduce((s, b) => s + b.quantidade, 0))} de {ci.item.quantidade}
                      </p>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs whitespace-nowrap">Devolvido:</Label>
                      <Input
                        type="number"
                        value={ci.devolvido || ""}
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
              Peças consumidas em OS/Vendas e divergências. Deseja repor na caixa?
            </p>
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
              {/* Baixa replenishment suggestions */}
              {checkinItems
                .filter((ci) => ci.baixaSuggestions.length > 0)
                .map((ci) => {
                  const index = checkinItems.indexOf(ci);
                  const totalBaixa = ci.baixaSuggestions.reduce((s, b) => s + b.quantidade, 0);
                  return (
                    <div key={`baixa-${ci.item.id}`} className={`p-3 rounded-lg border ${
                      ci.reposto ? "border-success/30 bg-success/5" : "border-primary/30 bg-primary/5"
                    }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{ci.item.nome_produto}</p>
                          <div className="mt-1 space-y-0.5">
                            {ci.baixaSuggestions.map((s, si) => (
                              <p key={si} className="text-xs text-muted-foreground">
                                <PackageOpen className="h-3 w-3 inline mr-1" />
                                {s.quantidade}x saiu na {s.refTipo === "os" ? "OS" : "Venda"} #{s.refNumero}
                              </p>
                            ))}
                          </div>
                          <p className="text-xs font-medium mt-1 text-primary">
                            Repor {totalBaixa}x na caixa?
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button
                            variant={ci.reposto ? "default" : "outline"}
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => updateItem(index, { reposto: true })}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Sim, repor
                          </Button>
                          <Button
                            variant={!ci.reposto ? "default" : "outline"}
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => updateItem(index, { reposto: false })}
                          >
                            Não
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}

              {/* Regular divergence items (without baixa) */}
              {checkinItems
                .filter((ci) => ci.divergencia > 0 && ci.baixaSuggestions.length === 0)
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

              {checkinItems.every((ci) => ci.baixaSuggestions.length === 0 && ci.divergencia <= 0) && (
                <div className="text-center py-6 text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-success" />
                  <p className="text-sm">Tudo confere! Nenhuma divergência ou baixa encontrada.</p>
                </div>
              )}

              {/* Observações */}
              <div className="space-y-2 pt-2">
                <Label className="text-xs">Observações (opcional)</Label>
                <Textarea
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Alguma observação sobre o estado dos itens, condições da caixa, etc..."
                  className="text-sm min-h-[60px] resize-none"
                />
              </div>

              {/* Termo de responsabilidade */}
              <div className="flex items-start gap-3 p-3 rounded-lg border border-warning/30 bg-warning/5">
                <Checkbox
                  id="aceite-responsabilidade"
                  checked={accepted}
                  onCheckedChange={(v) => setAccepted(v === true)}
                  className="mt-0.5"
                />
                <label htmlFor="aceite-responsabilidade" className="text-xs text-foreground leading-relaxed cursor-pointer">
                  <ShieldAlert className="h-3.5 w-3.5 inline mr-1 text-warning" />
                  <strong>Declaro que conferi todos os itens desta caixa.</strong> Estou ciente de que, a partir deste momento, a responsabilidade pelas peças devolvidas ao estoque é minha, e que qualquer peça faltante que não tenha sido devidamente conferida e justificada será cobrada de mim.
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("conference")}>
                Voltar
              </Button>
              <Button onClick={handleComplete} disabled={saving || !accepted || (hasDivergencias && !allDivergenciasValidated)}>
                {saving ? "Salvando..." : "Concluir Check-in"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
