import { useState, useEffect } from "react";
import { UserCheck, Loader2, Search, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { BoxData } from "./BoxDetailDialog";
import BoxHandoffReceipt from "./BoxHandoffReceipt";
import { logBoxMovement } from "@/lib/boxMovementLog";
import { getProdutoDetalhe } from "@/api/compras";

interface Technician {
  id: string;
  gc_id: string;
  name: string;
}

interface ReceiptData {
  boxName: string;
  technicianName: string;
  technicianGcId: string;
  items: { produto_id: string; nome_produto: string; quantidade: number; preco_unitario: number | null }[];
  date: string;
}

interface Props {
  box: BoxData | null;
  onClose: () => void;
  onLinked: (techName?: string, techGcId?: string) => void;
}

export default function TechnicianLinkDialog({ box, onClose, onLinked }: Props) {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [stockIssues, setStockIssues] = useState<Array<{ nome: string; naBox: number; estoqueGC: number }>>([]);
  const [stockChecked, setStockChecked] = useState(false);
  const [checkingStock, setCheckingStock] = useState(false);

  useEffect(() => {
    if (box) {
      setLoading(true);
      supabase
        .from("technicians")
        .select("id, gc_id, name")
        .eq("active", true)
        .order("name")
        .then(({ data, error }) => {
          if (error) {
            toast.error("Erro ao carregar técnicos");
          }
          setTechnicians(data || []);
          if (box.technician_gc_id) {
            const match = data?.find((t) => t.gc_id === box.technician_gc_id);
            if (match) setSelectedId(match.id);
          }
          setLoading(false);
        });
    } else {
      setSelectedId("");
      setSearch("");
      setReceiptData(null);
      setStockIssues([]);
      setStockChecked(false);
    }
  }, [box]);

  // Re-check stock for all box items before handoff
  const checkBoxStock = async () => {
    if (!box) return;
    setCheckingStock(true);
    setStockIssues([]);
    try {
      const { data: boxItems } = await supabase
        .from("box_items")
        .select("produto_id, nome_produto, quantidade")
        .eq("box_id", box.id);

      if (!boxItems?.length) {
        setStockChecked(true);
        setCheckingStock(false);
        return;
      }

      const issues: Array<{ nome: string; naBox: number; estoqueGC: number }> = [];

      // Check stock in batches of 3 to respect rate limits
      for (let i = 0; i < boxItems.length; i += 3) {
        const batch = boxItems.slice(i, i + 3);
        const results = await Promise.all(
          batch.map(async (item) => {
            const detail = await getProdutoDetalhe(item.produto_id);
            if (!detail) return { item, estoque: null };
            const raw = detail.estoque;
            const estoque = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", ".")) || 0;
            return { item, estoque: Math.max(0, Math.floor(estoque)) };
          })
        );

        for (const { item, estoque } of results) {
          if (estoque !== null) {
            // Update stored stock in DB
            await supabase
              .from("box_items")
              .update({ estoque_gc: estoque })
              .eq("box_id", box.id)
              .eq("produto_id", item.produto_id);

            if (item.quantidade > estoque) {
              issues.push({ nome: item.nome_produto, naBox: item.quantidade, estoqueGC: estoque });
            }
          }
        }

        // Small delay between batches
        if (i + 3 < boxItems.length) await new Promise(r => setTimeout(r, 1100));
      }

      setStockIssues(issues);
      setStockChecked(true);

      if (issues.length === 0) {
        toast.success("Estoque validado — todos os itens disponíveis");
      } else {
        toast.warning(`${issues.length} item(ns) com estoque insuficiente no GC`);
      }
    } catch (e) {
      console.error("Erro ao verificar estoque:", e);
      toast.error("Erro ao verificar estoque no GestãoClick");
    } finally {
      setCheckingStock(false);
    }
  };

  const handleSave = async () => {
    if (!selectedId || !box) return;
    const tech = technicians.find((t) => t.id === selectedId);
    if (!tech) return;

    // If stock wasn't checked yet, run check first
    if (!stockChecked) {
      await checkBoxStock();
      return; // User will need to click Vincular again after reviewing
    }

    // If there are stock issues, warn but allow (user already saw the issues)
    if (stockIssues.length > 0) {
      const confirmed = window.confirm(
        `Existem ${stockIssues.length} item(ns) com estoque insuficiente no GC.\n\n` +
        stockIssues.map(i => `• ${i.nome}: ${i.naBox} na caixa, ${i.estoqueGC} no GC`).join("\n") +
        "\n\nDeseja vincular mesmo assim?"
      );
      if (!confirmed) return;
    }

    // Guard against double-submit
    if (saving) return;
    setSaving(true);

    console.info("[TechLink] Iniciando vínculo", { boxId: box.id, boxName: box.name, techName: tech.name, techGcId: tech.gc_id });

    try {
      const { data: updatedBox, error } = await supabase
        .from("boxes")
        .update({
          technician_name: tech.name,
          technician_gc_id: tech.gc_id,
        })
        .eq("id", box.id)
        .select("id, technician_name, technician_gc_id")
        .maybeSingle();

      console.info("[TechLink] Resultado UPDATE", { updatedBox, error });

      if (error) {
        console.error("[TechLink] Supabase UPDATE error:", error);
        throw error;
      }
      if (!updatedBox) {
        console.error("[TechLink] UPDATE retornou null — possível RLS bloqueando ou ID inválido", { boxId: box.id });
        throw new Error("Falha ao vincular: o registro não foi encontrado ou a permissão foi negada. Recarregue a página e tente novamente.");
      }

      console.info("[TechLink] UPDATE confirmado, chamando onLinked() com dados do técnico");
      // Optimistic: pass tech data back so parent can patch state immediately
      onLinked(tech.name, tech.gc_id);

      let receiptItems: ReceiptData["items"] = [];
      let warningMessage: string | null = null;

      try {
        const { data: items } = await supabase
          .from("box_items")
          .select("produto_id, nome_produto, quantidade, preco_unitario")
          .eq("box_id", box.id)
          .order("nome_produto");

        receiptItems = (items || []).map((i) => ({
          produto_id: i.produto_id,
          nome_produto: i.nome_produto,
          quantidade: i.quantidade,
          preco_unitario: i.preco_unitario,
        }));

        const totalItems = receiptItems.reduce((s, i) => s + i.quantidade, 0);
        const totalValue = receiptItems.reduce(
          (s, i) => s + i.quantidade * (Number(i.preco_unitario) || 0),
          0
        );

        const {
          data: { user: currentUser },
        } = await supabase.auth.getUser();

        if (currentUser) {
          let operatorName = currentUser.email || "";
          const { data: prof } = await supabase
            .from("profiles")
            .select("name")
            .eq("id", currentUser.id)
            .maybeSingle();
          if (prof?.name) operatorName = prof.name;

          const { error: handoffError } = await supabase.from("box_handoff_logs").insert({
            box_id: box.id,
            box_name: box.name,
            technician_name: tech.name,
            technician_gc_id: tech.gc_id,
            operator_id: currentUser.id,
            operator_name: operatorName,
            items_count: totalItems,
            total_value: totalValue,
          });

          if (handoffError) {
            console.error("[TechLink] handoff_logs insert error:", handoffError);
            throw handoffError;
          }
        } else {
          console.warn("[TechLink] currentUser null — skipping handoff log");
          warningMessage = "Vínculo salvo, mas não foi possível identificar o operador para o recibo.";
        }

        await logBoxMovement({
          boxId: box.id,
          boxName: box.name,
          action: "saida",
          quantidade: totalItems,
          technicianName: tech.name,
          technicianGcId: tech.gc_id,
          details: `Caixa entregue ao técnico ${tech.name} com ${totalItems} itens (${totalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})`,
        });
      } catch (secondaryError) {
        console.error("[TechLink] Erro secundário (recibo/log):", secondaryError);
        warningMessage = warningMessage || "Vínculo salvo, mas houve falha ao registrar recibo/log.";
      }

      setReceiptData({
        boxName: box.name,
        technicianName: tech.name,
        technicianGcId: tech.gc_id,
        items: receiptItems,
        date: new Date().toISOString(),
      });

      toast.success(`Técnico "${tech.name}" vinculado à caixa "${box.name}"`);
      if (warningMessage) toast.warning(warningMessage);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro ao vincular técnico";
      toast.error(message);
      console.error("[TechLink] ERRO PRINCIPAL:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleCloseReceipt = () => {
    setReceiptData(null);
    onClose();
  };

  // Show receipt if available
  if (receiptData) {
    return (
      <BoxHandoffReceipt
        open
        onClose={handleCloseReceipt}
        boxName={receiptData.boxName}
        technicianName={receiptData.technicianName}
        technicianGcId={receiptData.technicianGcId}
        items={receiptData.items}
        date={receiptData.date}
      />
    );
  }

  return (
    <Dialog open={!!box} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5" />
            Vincular Técnico
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : technicians.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum técnico cadastrado. Cadastre primeiro em{" "}
              <span className="font-medium text-foreground">Controle e Saída → Técnicos</span>.
            </p>
          ) : (
            <div className="space-y-3">
              <label className="text-sm font-medium">Selecione o técnico</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar técnico..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-border rounded-md border">
                {technicians
                  .filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
                  .map((tech) => (
                    <button
                      key={tech.id}
                      onClick={() => setSelectedId(tech.id)}
                      className={`flex items-center gap-3 w-full px-3 py-2 text-left transition-colors hover:bg-accent/30 ${
                        selectedId === tech.id ? "bg-accent text-accent-foreground" : ""
                      }`}
                    >
                      <UserCheck className="h-4 w-4 text-primary shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{tech.name}</p>
                        <p className="text-xs text-muted-foreground">Nº Identificação: {tech.gc_id}</p>
                      </div>
                    </button>
                  ))}
                {technicians.filter((t) => t.name.toLowerCase().includes(search.toLowerCase())).length === 0 && (
                  <div className="py-3 text-center text-sm text-muted-foreground">Nenhum técnico encontrado</div>
                )}
              </div>
            </div>
          )}
          {/* Stock issues warning */}
          {stockChecked && stockIssues.length > 0 && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg space-y-1">
              <p className="text-xs font-semibold text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Itens com estoque insuficiente no GC:
              </p>
              {stockIssues.map((issue, idx) => (
                <p key={idx} className="text-xs text-destructive/80 pl-5">
                  • {issue.nome}: <strong>{issue.naBox}</strong> na caixa, <strong>{issue.estoqueGC}</strong> disponível
                </p>
              ))}
            </div>
          )}
          {stockChecked && stockIssues.length === 0 && (
            <div className="p-2 bg-success/10 border border-success/20 rounded-lg">
              <p className="text-xs text-success font-medium">✅ Estoque validado — todos os itens disponíveis</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          {!stockChecked ? (
            <Button
              onClick={checkBoxStock}
              disabled={!selectedId || checkingStock || technicians.length === 0}
            >
              {checkingStock ? "Verificando estoque..." : "Verificar estoque e vincular"}
            </Button>
          ) : (
            <Button
              onClick={handleSave}
              disabled={!selectedId || saving || technicians.length === 0}
              variant={stockIssues.length > 0 ? "destructive" : "default"}
            >
              {saving ? "Salvando..." : stockIssues.length > 0 ? "Vincular mesmo assim" : "Vincular"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
