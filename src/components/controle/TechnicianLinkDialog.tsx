import { useState, useEffect } from "react";
import { UserCheck, Loader2, Search } from "lucide-react";
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
  onLinked: () => void;
}

export default function TechnicianLinkDialog({ box, onClose, onLinked }: Props) {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

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
    }
  }, [box]);

  const handleSave = async () => {
    if (!selectedId || !box) return;
    const tech = technicians.find((t) => t.id === selectedId);
    if (!tech) return;
    setSaving(true);
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

      if (error) throw error;
      if (!updatedBox) throw new Error("Sem permissão para vincular esta caixa.");

      // Fetch box items for the receipt
      const { data: items } = await supabase
        .from("box_items")
        .select("produto_id, nome_produto, quantidade, preco_unitario")
        .eq("box_id", box.id)
        .order("nome_produto");

      const receiptItems = (items || []).map((i) => ({
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

      // Get current user info for operator attribution
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      let operatorName = currentUser?.email || "";
      if (currentUser) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("name")
          .eq("id", currentUser.id)
          .single();
        if (prof) operatorName = prof.name;
      }

      // Log the handoff (legacy table + unified log)
      await supabase.from("box_handoff_logs").insert({
        box_id: box.id,
        box_name: box.name,
        technician_name: tech.name,
        technician_gc_id: tech.gc_id,
        operator_id: currentUser!.id,
        operator_name: operatorName,
        items_count: totalItems,
        total_value: totalValue,
      });

      await logBoxMovement({
        boxId: box.id,
        boxName: box.name,
        action: "saida",
        quantidade: totalItems,
        technicianName: tech.name,
        technicianGcId: tech.gc_id,
        details: `Caixa entregue ao técnico ${tech.name} com ${totalItems} itens (${totalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})`,
      });

      setReceiptData({
        boxName: box.name,
        technicianName: tech.name,
        technicianGcId: tech.gc_id,
        items: receiptItems,
        date: new Date().toISOString(),
      });

      toast.success(`Técnico "${tech.name}" vinculado à caixa "${box.name}"`);
      onLinked();
    } catch (e) {
      toast.error("Erro ao vincular técnico");
      console.error(e);
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={!selectedId || saving || technicians.length === 0}
          >
            {saving ? "Salvando..." : "Vincular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
