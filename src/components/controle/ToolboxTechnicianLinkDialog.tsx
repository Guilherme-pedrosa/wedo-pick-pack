import { useState, useEffect } from "react";
import { UserCheck, Search, Loader2 } from "lucide-react";
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
import { executeStockSaida } from "@/api/stockMovement";
import type { ToolboxData, ToolboxItemData } from "./ToolboxDetailDialog";

interface Technician {
  id: string;
  gc_id: string;
  name: string;
}

interface Props {
  toolbox: ToolboxData | null;
  onClose: () => void;
  onLinked: (techName?: string, techGcId?: string) => void;
  onShowReceipt?: (toolbox: ToolboxData, techName: string, techGcId: string) => void;
}

export default function ToolboxTechnicianLinkDialog({ toolbox, onClose, onLinked, onShowReceipt }: Props) {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [stockProgress, setStockProgress] = useState<string | null>(null);

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
    if (!toolbox || linking) return;
    setLinking(true);
    setStockProgress(null);

    console.info("[ToolboxLink] Iniciando vínculo", { toolboxId: toolbox.id, toolboxName: toolbox.name, techName: tech.name, techGcId: tech.gc_id });

    try {
      // 1) Carregar itens da maleta
      const { data: items } = await (supabase.from("toolbox_items") as any)
        .select("*")
        .eq("toolbox_id", toolbox.id);

      // 2) Primeiro cria a venda/baixa de estoque; se falhar, aborta sem vincular a maleta
      let vendaGcId: string | null = null;
      let vendaCodigo: string | null = null;
      let vendaSummary: string | null = null;

      if (items && items.length > 0) {
        setStockProgress(`Aplicando ajuste de estoque (${items.length} itens)...`);

        const result = await executeStockSaida({
          items: items.map((i: any) => ({
            produto_id: i.produto_id,
            nome_produto: i.nome_produto,
            quantidade: i.quantidade,
            preco_unitario: i.preco_unitario || 0,
          })),
          justificativa: `Empréstimo de ferramenta - Maleta "${toolbox.name}"`,
          toolboxName: toolbox.name,
          technicianName: tech.name,
          technicianGcId: tech.gc_id,
        });

        console.info("[ToolboxLink] Resultado estoque:", result);

        if (!result.success || !result.venda_gc_id) {
          throw new Error(result.error || "Falha ao aplicar ajuste de estoque no ERP.");
        }

        vendaGcId = result.venda_gc_id;
        vendaCodigo = result.venda_codigo || null;
        vendaSummary = result.summary || null;
      }

      // 3) Só após venda confirmada: vincula técnico na maleta
      const toolboxUpdatePayload: Record<string, any> = {
        technician_name: tech.name,
        technician_gc_id: tech.gc_id,
      };

      if (vendaGcId) {
        toolboxUpdatePayload.venda_gc_id = vendaGcId;
      }

      console.info("[ToolboxLink] Enviando UPDATE", { toolboxId: toolbox.id, payload: toolboxUpdatePayload });

      const { data: updatedToolbox, error: linkError } = await (supabase.from("toolboxes") as any)
        .update(toolboxUpdatePayload)
        .eq("id", toolbox.id)
        .select("id, technician_name, technician_gc_id")
        .maybeSingle();

      console.info("[ToolboxLink] Resultado UPDATE", { updatedToolbox, linkError });

      if (linkError) {
        console.error("[ToolboxLink] Supabase UPDATE error:", linkError);
        throw linkError;
      }
      if (!updatedToolbox) {
        console.error("[ToolboxLink] UPDATE retornou null — possível RLS ou ID inválido", { toolboxId: toolbox.id });
        throw new Error("Falha ao vincular: o registro não foi encontrado ou a permissão foi negada. Recarregue a página e tente novamente.");
      }

      console.info("[ToolboxLink] UPDATE confirmado, chamando onLinked() com dados do técnico");
      // Optimistic: pass tech data back so parent can patch state immediately
      onLinked(tech.name, tech.gc_id);

      let warningMessage: string | null = null;
      try {
        await logToolboxMovement({
          toolboxId: toolbox.id,
          toolboxName: toolbox.name,
          action: "vinculacao",
          technicianName: tech.name,
          technicianGcId: tech.gc_id,
          details: `Maleta vinculada ao técnico ${tech.name}`,
        });

        if (vendaGcId) {
          toast.success(`Ajuste de estoque aplicado (${vendaCodigo || "ref interna"})`);

          await logToolboxMovement({
            toolboxId: toolbox.id,
            toolboxName: toolbox.name,
            action: "saida_estoque",
            technicianName: tech.name,
            technicianGcId: tech.gc_id,
            details: `Ajuste ERP ${vendaCodigo || "(sem código)"} — ${vendaSummary || "Saída registrada"}`,
          });
        }
      } catch (logError) {
        console.error("[ToolboxLink] Erro ao registrar logs:", logError);
        warningMessage = "Vínculo salvo, mas houve falha ao registrar movimentação.";
      }

      toast.success(`Técnico ${tech.name} vinculado à maleta "${toolbox.name}"`);
      if (warningMessage) toast.warning(warningMessage);

      if (onShowReceipt) {
        onShowReceipt(toolbox, tech.name, tech.gc_id);
      }

      onClose();
    } catch (error) {
      console.error("[ToolboxLink] ERRO PRINCIPAL:", error);
      const message = error instanceof Error ? error.message : "Erro ao vincular técnico";
      toast.error(message);
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
