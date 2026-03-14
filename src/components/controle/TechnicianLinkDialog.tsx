import { useState } from "react";
import { UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface Props {
  box: BoxData | null;
  onClose: () => void;
  onLinked: () => void;
}

export default function TechnicianLinkDialog({ box, onClose, onLinked }: Props) {
  const [name, setName] = useState(box?.technician_name || "");
  const [gcId, setGcId] = useState(box?.technician_gc_id || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !box) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("boxes")
        .update({
          technician_name: name.trim(),
          technician_gc_id: gcId.trim() || null,
        })
        .eq("id", box.id);
      if (error) throw error;
      toast.success(`Técnico "${name.trim()}" vinculado à caixa "${box.name}"`);
      onLinked();
      onClose();
    } catch (e) {
      toast.error("Erro ao vincular técnico");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

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
          <div className="space-y-2">
            <Label htmlFor="tech-name">Nome do técnico *</Label>
            <Input
              id="tech-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: João Silva"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tech-gc-id">ID GestãoClick (opcional)</Label>
            <Input
              id="tech-gc-id"
              value={gcId}
              onChange={(e) => setGcId(e.target.value)}
              placeholder="Ex: 12345"
            />
            <p className="text-xs text-muted-foreground">
              Encontre na URL do perfil do usuário no GestãoClick
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? "Salvando..." : "Vincular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
