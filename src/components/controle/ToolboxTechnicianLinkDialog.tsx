import { useState, useEffect } from "react";
import { UserCheck, Search } from "lucide-react";
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
import { logToolboxMovement } from "@/lib/toolboxMovementLog";
import type { ToolboxData, ToolboxItemData } from "./ToolboxDetailDialog";

interface Technician {
  id: string;
  gc_id: string;
  name: string;
}

interface Props {
  toolbox: ToolboxData | null;
  onClose: () => void;
  onLinked: () => void;
  onShowReceipt?: (toolbox: ToolboxData, techName: string, techGcId: string) => void;
}

export default function ToolboxTechnicianLinkDialog({ toolbox, onClose, onLinked, onShowReceipt }: Props) {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  

  useEffect(() => {
    if (!toolbox) return;
    loadTechnicians();
  }, [toolbox]);

  const loadTechnicians = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("technicians")
      .select("*")
      .eq("active", true)
      .order("name");
    setTechnicians(data || []);
    setLoading(false);
  };

  const handleLink = async (tech: Technician) => {
    if (!toolbox) return;
    setLinking(true);
    setStockProgress(null);
    try {
      // 1. Get toolbox items for stock movement
      const { data: items } = await (supabase.from("toolbox_items") as any)
        .select("*")
        .eq("toolbox_id", toolbox.id);

      // 2. Link technician
      const { error } = await (supabase.from("toolboxes") as any)
        .update({ technician_name: tech.name, technician_gc_id: tech.gc_id })
        .eq("id", toolbox.id);
      if (error) throw error;

      await logToolboxMovement({
        toolboxId: toolbox.id,
        toolboxName: toolbox.name,
        action: "vinculacao",
        technicianName: tech.name,
        technicianGcId: tech.gc_id,
        details: `Maleta vinculada ao técnico ${tech.name}`,
      });

      // 3. Execute stock OUT if there are items
      if (items && items.length > 0) {
        setStockProgress(`Baixando estoque de ${items.length} item(ns)...`);
        try {
          const result = await executeStockMovement({
            items: items.map((i: any) => ({
              produto_id: i.produto_id,
              nome_produto: i.nome_produto,
              quantidade: i.quantidade,
            })),
            justificativa: `Saída para maleta "${toolbox.name}" - Técnico: ${tech.name}`,
            toolboxName: toolbox.name,
            technicianName: tech.name,
            tipo: "saida",
          });

          const failedItems = result.results.filter(r => !r.success);
          if (failedItems.length > 0) {
            toast.warning(
              `Estoque baixado parcialmente: ${result.summary}. Verifique os itens com erro.`,
              { duration: 6000 }
            );
            failedItems.forEach(f => {
              console.error(`Stock OUT failed for ${f.nome_produto}:`, f.error);
            });
          } else {
            toast.success(`Estoque baixado: ${result.summary}`);
          }

          // Log stock movement
          await logToolboxMovement({
            toolboxId: toolbox.id,
            toolboxName: toolbox.name,
            action: "saida_estoque",
            technicianName: tech.name,
            technicianGcId: tech.gc_id,
            details: `Baixa de estoque: ${result.summary} (${items.length} itens)`,
          });
        } catch (stockErr) {
          console.error("Stock movement error:", stockErr);
          toast.error("Erro ao baixar estoque no ERP. A vinculação foi feita, mas o estoque NÃO foi ajustado.");
        }
      }

      toast.success(`Técnico ${tech.name} vinculado à maleta "${toolbox.name}"`);
      onLinked();
      
      if (onShowReceipt) {
        onShowReceipt(toolbox, tech.name, tech.gc_id);
      }
      
      onClose();
    } catch {
      toast.error("Erro ao vincular técnico");
    } finally {
      setLinking(false);
      setStockProgress(null);
    }
  };

  const filtered = technicians.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={!!toolbox} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5" />
            Vincular Técnico à Maleta
          </DialogTitle>
        </DialogHeader>

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

        {stockProgress && (
          <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
            <span className="text-sm text-primary font-medium">{stockProgress}</span>
          </div>
        )}

        <div className="max-h-60 overflow-y-auto divide-y divide-border">
          {loading ? (
            <div className="py-4 text-center text-sm text-muted-foreground">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">Nenhum técnico encontrado</div>
          ) : (
            filtered.map((tech) => (
              <button
                key={tech.id}
                onClick={() => handleLink(tech)}
                disabled={linking}
                className="flex items-center gap-3 w-full px-3 py-2.5 hover:bg-accent/30 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <UserCheck className="h-4 w-4 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-medium">{tech.name}</p>
                  <p className="text-xs text-muted-foreground">ID: {tech.gc_id}</p>
                </div>
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={linking}>Cancelar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
