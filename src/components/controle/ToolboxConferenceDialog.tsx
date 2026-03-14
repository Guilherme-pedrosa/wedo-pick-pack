import { useState } from "react";
import { ClipboardCheck, Check, X, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ToolboxData, ToolboxItemData } from "./ToolboxDetailDialog";
import { logToolboxMovement } from "@/lib/toolboxMovementLog";


interface Props {
  toolbox: ToolboxData | null;
  items: ToolboxItemData[];
  onClose: () => void;
  onCompleted: () => void;
  unlinkOnComplete?: boolean;
}

interface CheckItem {
  produto_id: string;
  nome_produto: string;
  quantidade: number;
  presente: boolean;
  observacao: string;
}

export default function ToolboxConferenceDialog({ toolbox, items, onClose, onCompleted, unlinkOnComplete }: Props) {
  const [checkItems, setCheckItems] = useState<CheckItem[]>(() =>
    items.map((i) => ({
      produto_id: i.produto_id,
      nome_produto: i.nome_produto,
      quantidade: i.quantidade,
      presente: false,
      observacao: "",
    }))
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  

  // Reset when items change
  useState(() => {
    setCheckItems(
      items.map((i) => ({
        produto_id: i.produto_id,
        nome_produto: i.nome_produto,
        quantidade: i.quantidade,
        presente: false,
        observacao: "",
      }))
    );
  });

  const toggleItem = (idx: number) => {
    setCheckItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, presente: !item.presente } : item))
    );
  };

  const setObservacao = (idx: number, obs: string) => {
    setCheckItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, observacao: obs } : item))
    );
  };

  const markAll = (present: boolean) => {
    setCheckItems((prev) => prev.map((item) => ({ ...item, presente: present })));
  };

  const presentCount = checkItems.filter((i) => i.presente).length;
  const missingCount = checkItems.filter((i) => !i.presente).length;

  const handleSave = async () => {
    if (!toolbox) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", user.id)
        .maybeSingle();

      const operatorName = profile?.name || user.email || "";

      // Create conference record
      const { data: record, error: recError } = await (supabase.from("toolbox_conference_records") as any)
        .insert({
          toolbox_id: toolbox.id,
          operator_id: user.id,
          operator_name: operatorName,
          items_total: checkItems.length,
          items_present: presentCount,
          items_missing: missingCount,
          notes: notes || null,
        })
        .select("id")
        .single();

      if (recError || !record) throw recError;

      // Insert conference items
      const confItems = checkItems.map((item) => ({
        conference_id: record.id,
        toolbox_id: toolbox.id,
        produto_id: item.produto_id,
        nome_produto: item.nome_produto,
        quantidade_esperada: item.quantidade,
        presente: item.presente,
        observacao: item.observacao || null,
      }));

      await (supabase.from("toolbox_conference_items") as any).insert(confItems);

      // Log the conference
      await logToolboxMovement({
        toolboxId: toolbox.id,
        toolboxName: toolbox.name,
        action: "conferencia",
        technicianName: toolbox.technician_name || undefined,
        technicianGcId: toolbox.technician_gc_id || undefined,
        details: `Conferência: ${presentCount}/${checkItems.length} presentes, ${missingCount} ausentes`,
      });

      // Log missing items
      if (unlinkOnComplete && toolbox.technician_name) {
        const missingItems = checkItems.filter(i => !i.presente);
        if (missingItems.length > 0) {
          const missingDetails = missingItems
            .map(i => `${i.nome_produto} (${i.quantidade}x)${i.observacao ? ` - ${i.observacao}` : ''}`)
            .join('; ');

          await logToolboxMovement({
            toolboxId: toolbox.id,
            toolboxName: toolbox.name,
            action: "extravio",
            technicianName: toolbox.technician_name || undefined,
            technicianGcId: toolbox.technician_gc_id || undefined,
            details: `Itens ausentes: ${missingDetails}`,
          });

          toast.warning(`${missingItems.length} ferramenta(s) ausente(s)!`, { duration: 8000 });
        }

        // Unlink technician
        await (supabase.from("toolboxes") as any)
          .update({ technician_name: null, technician_gc_id: null })
          .eq("id", toolbox.id);

        await logToolboxMovement({
          toolboxId: toolbox.id,
          toolboxName: toolbox.name,
          action: "devolucao",
          technicianName: toolbox.technician_name || undefined,
          technicianGcId: toolbox.technician_gc_id || undefined,
          details: `Técnico ${toolbox.technician_name} desvinculado após conferência`,
        });

        toast.success(`Técnico "${toolbox.technician_name}" desvinculado de "${toolbox.name}"`);
      }

      toast.success(`Conferência salva: ${presentCount}/${checkItems.length} presentes`);
      if (missingCount > 0 && !unlinkOnComplete) {
        toast.warning(`${missingCount} ferramenta(s) ausente(s)!`);
      }
      onCompleted();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao salvar conferência");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!toolbox} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Conferência — {toolbox?.name}
            {toolbox?.technician_name && (
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                {toolbox.technician_name}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Summary */}
        <div className="flex items-center gap-4 text-sm">
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
            <Check className="h-3 w-3 mr-1" />
            {presentCount} presentes
          </Badge>
          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
            <X className="h-3 w-3 mr-1" />
            {missingCount} ausentes
          </Badge>
          <div className="flex gap-1 ml-auto">
            <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => markAll(true)}>
              Marcar todos
            </Button>
            <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => markAll(false)}>
              Desmarcar todos
            </Button>
          </div>
        </div>

        {/* Checklist */}
        <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-border">
          {checkItems.map((item, idx) => (
            <div key={item.produto_id} className="flex items-start gap-3 py-2.5 px-2">
              <Checkbox
                checked={item.presente}
                onCheckedChange={() => toggleItem(idx)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${item.presente ? "text-foreground" : "text-destructive"}`}>
                  {item.nome_produto}
                </p>
                <p className="text-xs text-muted-foreground">
                  Qtd esperada: {item.quantidade}
                </p>
                {!item.presente && (
                  <Input
                    placeholder="Observação (ex: danificada, extraviada...)"
                    value={item.observacao}
                    onChange={(e) => setObservacao(idx, e.target.value)}
                    className="h-6 text-xs mt-1"
                  />
                )}
              </div>
              {!item.presente && (
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              )}
            </div>
          ))}
        </div>

        {/* Notes */}
        <div>
          <Input
            placeholder="Observações gerais da conferência..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="text-sm"
          />
        </div>

        {stockProgress && (
          <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
            <span className="text-sm text-primary font-medium">{stockProgress}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : unlinkOnComplete ? "Finalizar e Devolver" : "Finalizar Conferência"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
