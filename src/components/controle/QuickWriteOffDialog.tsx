import { useState, useEffect } from "react";
import {
  FileText,
  Search,
  CheckCircle2,
  Minus,
  Plus,
  ChevronsUpDown,
  Check,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { BoxData, BoxItemData } from "./BoxDetailDialog";

interface Props {
  open: boolean;
  box: BoxData | null;
  onClose: () => void;
  onCompleted: () => void;
}

export default function QuickWriteOffDialog({ open, box, onClose, onCompleted }: Props) {
  const [boxItems, setBoxItems] = useState<BoxItemData[]>([]);
  const [matchedItem, setMatchedItem] = useState<BoxItemData | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);

  const [tipo, setTipo] = useState<"os" | "venda">("os");
  const [ref, setRef] = useState("");
  const [qty, setQty] = useState(1);
  const [validado, setValidado] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);

  const resetState = () => {
    setMatchedItem(null);
    setTipo("os");
    setRef("");
    setQty(1);
    setValidado(false);
    setBoxItems([]);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // Load box items when dialog opens
  const handleOpenChange = async (isOpen: boolean) => {
    if (!isOpen) {
      handleClose();
      return;
    }
    if (box) {
      setLoadingItems(true);
      const { data } = await supabase
        .from("box_items")
        .select("*")
        .eq("box_id", box.id)
        .order("added_at", { ascending: false });
      setBoxItems(data || []);
      setLoadingItems(false);
    }
  };

  // When dialog first opens, load items
  useState(() => {
    if (open && box) {
      handleOpenChange(true);
    }
  });

  const handleProductSelect = (product: ProductResult) => {
    const found = boxItems.find((i) => i.produto_id === product.produto_id);
    if (!found) {
      toast.error(`Produto "${product.nome}" não está nesta caixa`);
      return;
    }
    setMatchedItem(found);
    setQty(1);
    setValidado(false);
    setRef("");
  };

  const handleScan = (code: string) => {
    supabase.functions
      .invoke("search-products-index", {
        body: { query: code, source: "box_writeoff_scan" },
      })
      .then(({ data, error }) => {
        if (error || !data?.data?.length) {
          toast.error(`Produto não encontrado: ${code}`);
          return;
        }
        handleProductSelect(data.data[0] as ProductResult);
      });
  };

  const handleValidate = async () => {
    if (!ref || !matchedItem || !box) return;
    const label = tipo === "os" ? "OS" : "Venda";
    setValidating(true);
    try {
      const searchPath =
        tipo === "os"
          ? `/api/ordens_servicos?pesquisa=${encodeURIComponent(ref)}`
          : `/api/vendas?pesquisa=${encodeURIComponent(ref)}`;

      const { data: searchData, error: searchError } = await supabase.functions.invoke("gc-proxy", {
        body: { path: searchPath, method: "GET" },
      });
      if (searchError) throw searchError;
      if (!searchData?._proxy?.ok) {
        toast.error(`Erro ao buscar ${label} #${ref}`);
        return;
      }

      const results: any[] = searchData?.data || [];
      const match = results.find(
        (r: any) => String(r.codigo) === String(ref) || String(r.numero) === String(ref)
      );
      if (!match) {
        toast.error(`${label} #${ref} não encontrada no GestãoClick`);
        return;
      }

      const detailId = match.id || match.ordem_servico_id || match.venda_id;
      const detailPath =
        tipo === "os"
          ? `/api/ordens_servicos/${detailId}`
          : `/api/vendas/${detailId}`;

      const { data: detailData, error: detailError } = await supabase.functions.invoke("gc-proxy", {
        body: { path: detailPath, method: "GET" },
      });
      if (detailError) throw detailError;
      if (!detailData?._proxy?.ok) {
        toast.error(`Erro ao carregar detalhes da ${label} #${ref}`);
        return;
      }

      // Date validation
      const orderData = detailData?.data;
      const orderDateStr = orderData?.data || orderData?.data_emissao || orderData?.data_criacao;
      if (orderDateStr && box) {
        const orderDate = new Date(orderDateStr);
        const boxCreatedAt = new Date(box.created_at);
        const orderDay = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate());
        const boxDay = new Date(boxCreatedAt.getFullYear(), boxCreatedAt.getMonth(), boxCreatedAt.getDate());
        if (orderDay < boxDay) {
          toast.error(
            `${label} #${ref} é anterior à saída da caixa (${boxCreatedAt.toLocaleDateString("pt-BR")}). Não é permitido.`
          );
          return;
        }
      }

      // Product validation
      const produtos = orderData?.produtos || [];
      const found = produtos.some(
        (p: any) =>
          p?.produto?.produto_id === matchedItem.produto_id ||
          String(p?.produto?.produto_id) === matchedItem.produto_id
      );
      if (!found) {
        toast.warning(`Produto "${matchedItem.nome_produto}" não encontrado na ${label} #${ref}`);
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
    if (!matchedItem || !box || !validado || qty < 1) return;
    setSaving(true);
    try {
      const newQty = matchedItem.quantidade - qty;
      if (newQty <= 0) {
        const { error } = await supabase.from("box_items").delete().eq("id", matchedItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("box_items")
          .update({ quantidade: newQty })
          .eq("id", matchedItem.id);
        if (error) throw error;
      }

      const label = tipo === "os" ? "OS" : "Venda";
      toast.success(`Baixa de ${qty}x "${matchedItem.nome_produto}" vinculada à ${label} #${ref}`);
      // Reset for next item
      setMatchedItem(null);
      setRef("");
      setQty(1);
      setValidado(false);
      // Reload items
      const { data } = await supabase
        .from("box_items")
        .select("*")
        .eq("box_id", box.id)
        .order("added_at", { ascending: false });
      setBoxItems(data || []);
      onCompleted();
    } catch (e) {
      toast.error("Erro ao realizar baixa");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!box) return null;
  const maxQty = matchedItem?.quantidade || 1;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5" />
              Baixa por OS/Venda — {box.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 flex-1 overflow-y-auto">
            {/* Step 1: Search product */}
            {!matchedItem && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Busque o produto que foi utilizado:
                </p>
                <ProductSearchInput
                  onSelect={handleProductSelect}
                  onScanRequest={() => setScannerOpen(true)}
                  autoFocus
                />
                {loadingItems && (
                  <p className="text-xs text-muted-foreground">Carregando itens da caixa...</p>
                )}
              </div>
            )}

            {/* Step 2: Matched item + OS/Venda ref */}
            {matchedItem && (
              <>
                {/* Item info */}
                <div className="p-3 bg-muted/50 rounded-lg border border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{matchedItem.nome_produto}</p>
                      <p className="text-xs text-muted-foreground">
                        ID: {matchedItem.produto_id} · Na caixa: {matchedItem.quantidade}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" className="text-xs h-7"
                      onClick={() => { setMatchedItem(null); setValidado(false); setRef(""); }}>
                      Trocar
                    </Button>
                  </div>
                </div>

                {/* Type + Reference */}
                <div className="space-y-2">
                  <Label className="text-xs">Documento</Label>
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
                      autoFocus
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={handleValidate}
                      disabled={!ref || validating}
                    >
                      {validating ? "..." : (
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
                    <Label className="text-xs">Quantidade</Label>
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
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Fechar
            </Button>
            {matchedItem && validado && (
              <Button onClick={handleConfirm} disabled={saving || qty < 1}>
                {saving ? "Salvando..." : `Confirmar baixa (${qty}x)`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScan}
      />
    </>
  );
}
