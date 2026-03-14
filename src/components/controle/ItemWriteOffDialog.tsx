import { useState } from "react";
import {
  FileText,
  Search,
  CheckCircle2,
  Minus,
  Plus,
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
import type { BoxData, BoxItemData } from "./BoxDetailDialog";

interface Props {
  open: boolean;
  item: BoxItemData | null;
  box: BoxData | null;
  onClose: () => void;
  onCompleted: () => void;
}

export default function ItemWriteOffDialog({ open, item, box, onClose, onCompleted }: Props) {
  const [tipo, setTipo] = useState<"os" | "venda">("os");
  const [ref, setRef] = useState("");
  const [qty, setQty] = useState(1);
  const [validado, setValidado] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);

  const resetState = () => {
    setTipo("os");
    setRef("");
    setQty(1);
    setValidado(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleValidate = async () => {
    if (!ref || !item || !box) return;

    const label = tipo === "os" ? "OS" : "Venda";
    setValidating(true);
    try {
      const refTrimmed = ref.trim();
      const endpoint = tipo === "os" ? "ordens_servicos" : "vendas";
      
      // Strategy 1 & 2: Search by codigo, then pesquisa
      const searchPaths = [
        `/api/${endpoint}?codigo=${encodeURIComponent(refTrimmed)}`,
        `/api/${endpoint}?pesquisa=${encodeURIComponent(refTrimmed)}`,
      ];

      let match: any = null;

      for (const searchPath of searchPaths) {
        if (match) break;
        try {
          const { data: searchData, error: searchError } = await supabase.functions.invoke("gc-proxy", {
            body: { path: searchPath, method: "GET" },
          });
          if (searchError) continue;
          if (!searchData?._proxy?.ok) continue;

          const results: any[] = searchData?.data || [];
          match = results.find(
            (r: any) =>
              String(r.codigo).trim() === refTrimmed ||
              String(r.numero).trim() === refTrimmed ||
              String(r.id).trim() === refTrimmed
          );
        } catch {
          continue;
        }
      }

      // Strategy 3: Direct fetch by ID if ref looks numeric
      if (!match && /^\d+$/.test(refTrimmed)) {
        try {
          const directPath = `/api/${endpoint}/${refTrimmed}`;
          const { data: directData, error: directError } = await supabase.functions.invoke("gc-proxy", {
            body: { path: directPath, method: "GET" },
          });
          if (!directError && directData?._proxy?.ok && directData?.data) {
            match = directData.data;
          }
        } catch {
          // ignore
        }
      }

      if (!match) {
        toast.error(`${label} #${ref} não encontrada no GestãoClick`);
        return;
      }

      // Fetch detail
      const detailId = match.id || match.ordem_servico_id || match.venda_id;
      let orderData = match;
      if (!match.produtos) {
        const detailPath = `/api/${endpoint}/${detailId}`;
        const { data: detailData, error: detailError } = await supabase.functions.invoke("gc-proxy", {
          body: { path: detailPath, method: "GET" },
        });
        if (detailError) throw detailError;
        if (!detailData?._proxy?.ok) {
          toast.error(`Erro ao carregar detalhes da ${label} #${ref}`);
          return;
        }
        orderData = detailData?.data;
      }

      // Date validation
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
            `${label} #${ref} é de ${orderDay.toLocaleDateString("pt-BR")}, anterior à saída da caixa (${boxDay.toLocaleDateString("pt-BR")}). Não é permitido.`
          );
          return;
        }
      }

      // Product validation
      const produtos = orderData?.produtos || [];
      const found = produtos.some(
        (p: any) =>
          p?.produto?.produto_id === item.produto_id ||
          String(p?.produto?.produto_id) === item.produto_id
      );

      if (!found) {
        toast.warning(`Produto "${item.nome_produto}" não encontrado na ${label} #${ref}`);
        return;
      }

      setValidado(true);
      toast.success(`Validado: produto encontrado na ${label} #${ref}`);
    } catch (e) {
      toast.error("Erro ao validar referência");
      console.error(e);
    } finally {
      setValidating(false);
    }
  };

  const handleConfirm = async () => {
    if (!item || !box || !validado || qty < 1) return;
    setSaving(true);
    try {
      const newQty = item.quantidade - qty;
      if (newQty <= 0) {
        const { error } = await supabase.from("box_items").delete().eq("id", item.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("box_items")
          .update({ quantidade: newQty })
          .eq("id", item.id);
        if (error) throw error;
      }

      const label = tipo === "os" ? "OS" : "Venda";
      toast.success(`Baixa de ${qty}x "${item.nome_produto}" vinculada à ${label} #${ref}`);
      handleClose();
      onCompleted();
    } catch (e) {
      toast.error("Erro ao realizar baixa");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!item) return null;

  const maxQty = item.quantidade;

  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-5 w-5" />
            Baixa por OS/Venda
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Item info */}
          <div className="p-3 bg-muted/50 rounded-lg border border-border">
            <p className="text-sm font-medium">{item.nome_produto}</p>
            <p className="text-xs text-muted-foreground">
              ID: {item.produto_id} · Estoque na caixa: {item.quantidade}
            </p>
          </div>

          {/* Type + Reference */}
          <div className="space-y-2">
            <Label className="text-xs">Tipo de documento</Label>
            <div className="flex gap-2">
              <Select value={tipo} onValueChange={(v) => { setTipo(v as any); setValidado(false); }}>
                <SelectTrigger className="w-28 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="os">OS</SelectItem>
                  <SelectItem value="venda">Venda</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={ref}
                onChange={(e) => { setRef(e.target.value); setValidado(false); }}
                placeholder={`Nº da ${tipo === "os" ? "OS" : "Venda"}`}
                className="flex-1 h-8 text-sm"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={handleValidate}
                disabled={!ref || validating}
              >
                {validating ? (
                  "..."
                ) : (
                  <>
                    <Search className="h-3 w-3 mr-1" />
                    Validar
                  </>
                )}
              </Button>
            </div>
            {validado && (
              <Badge className="bg-success/10 text-success border-success/20 text-xs">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Validado
              </Badge>
            )}
          </div>

          {/* Quantity */}
          {validado && (
            <div className="space-y-2">
              <Label className="text-xs">Quantidade a dar baixa</Label>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8"
                  onClick={() => setQty(Math.max(1, qty - 1))}>
                  <Minus className="h-3 w-3" />
                </Button>
                <Input
                  type="number"
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Math.min(maxQty, parseInt(e.target.value) || 1)))}
                  className="w-16 h-8 text-center text-sm"
                  min={1}
                  max={maxQty}
                />
                <Button variant="outline" size="icon" className="h-8 w-8"
                  onClick={() => setQty(Math.min(maxQty, qty + 1))}>
                  <Plus className="h-3 w-3" />
                </Button>
                <span className="text-xs text-muted-foreground">de {maxQty}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!validado || saving || qty < 1}>
            {saving ? "Salvando..." : `Confirmar baixa (${qty}x)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
