import { useState, useEffect } from "react";
import { UserCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { BoxData } from "./BoxDetailDialog";
import BoxHandoffReceipt from "./BoxHandoffReceipt";

interface Technician {
  id: string;
  gc_id: string;
  name: string;
}

interface ReceiptData {
  boxName: string;
  technicianName: string;
  technicianGcId: string;
  items: { nome_produto: string; quantidade: number; preco_unitario: number | null }[];
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
      setReceiptData(null);
    }
  }, [box]);

  const handleSave = async () => {
    if (!selectedId || !box) return;
    const tech = technicians.find((t) => t.id === selectedId);
    if (!tech) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("boxes")
        .update({
          technician_name: tech.name,
          technician_gc_id: tech.gc_id,
        })
        .eq("id", box.id);
      if (error) throw error;

      // Fetch box items for the receipt
      const { data: items } = await supabase
        .from("box_items")
        .select("nome_produto, quantidade, preco_unitario")
        .eq("box_id", box.id)
        .order("nome_produto");

      setReceiptData({
        boxName: box.name,
        technicianName: tech.name,
        technicianGcId: tech.gc_id,
        items: (items || []).map((i) => ({
          nome_produto: i.nome_produto,
          quantidade: i.quantidade,
          preco_unitario: i.preco_unitario,
        })),
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
            <div className="space-y-2">
              <label className="text-sm font-medium">Selecione o técnico</label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha um técnico..." />
                </SelectTrigger>
                <SelectContent>
                  {technicians.map((tech) => (
                    <SelectItem key={tech.id} value={tech.id}>
                      {tech.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
