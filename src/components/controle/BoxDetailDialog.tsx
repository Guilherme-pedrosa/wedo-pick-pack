import { useState } from "react";
import {
  Package,
  Trash2,
  Plus,
  Minus,
  UserCheck,
  UserX,
  ClipboardCheck,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ProductSearchInput, { ProductResult } from "./ProductSearchInput";
import BarcodeScannerModal from "@/components/checkout/BarcodeScannerModal";
import ItemWriteOffDialog from "./ItemWriteOffDialog";
import { logBoxMovement } from "@/lib/boxMovementLog";

export interface BoxData {
  id: string;
  name: string;
  status: "active" | "closed" | "cancelled";
  created_at: string;
  closed_at: string | null;
  user_id: string;
  technician_name?: string | null;
  technician_gc_id?: string | null;
  items_count?: number;
  total_value?: number;
}

export interface BoxItemData {
  id: string;
  box_id: string;
  produto_id: string;
  nome_produto: string;
  quantidade: number;
  preco_unitario: number;
  added_at: string;
}

interface Props {
  box: BoxData | null;
  items: BoxItemData[];
  loadingItems: boolean;
  onClose: () => void;
  onItemsChanged: () => void;
  onLinkTechnician: (box: BoxData) => void;
  onUnlinkTechnician: (box: BoxData) => void;
  onCheckin: (box: BoxData) => void;
}

export default function BoxDetailDialog({
  box,
  items,
  loadingItems,
  onClose,
  onItemsChanged,
  onLinkTechnician,
  onUnlinkTechnician,
  onCheckin,
}: Props) {
  const [selectedProduct, setSelectedProduct] = useState<ProductResult | null>(null);
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [writeOffItem, setWriteOffItem] = useState<BoxItemData | null>(null);

  const handleAddItem = async () => {
    if (!selectedProduct || !box || qty < 1) return;
    setAdding(true);
    try {
      const preco = parseFloat(selectedProduct.payload_min_json?.preco_venda || "0") || 0;
      const existing = items.find((i) => i.produto_id === selectedProduct.produto_id);
        if (existing) {
          const { error } = await supabase
            .from("box_items")
            .update({ quantidade: existing.quantidade + qty, preco_unitario: preco })
            .eq("id", existing.id);
          if (error) throw error;
          toast.success(`Quantidade atualizada: ${existing.quantidade + qty}`);
        } else {
          const { error } = await supabase.from("box_items").insert({
            box_id: box.id,
            produto_id: selectedProduct.produto_id,
            nome_produto: selectedProduct.nome,
            quantidade: qty,
            preco_unitario: preco,
          });
          if (error) throw error;
          toast.success(`${selectedProduct.nome} adicionado`);
        }

        await logBoxMovement({
          boxId: box.id,
          boxName: box.name,
          action: "adicao",
          produtoId: selectedProduct.produto_id,
          produtoNome: selectedProduct.nome,
          quantidade: qty,
          precoUnitario: preco,
          technicianName: box.technician_name || undefined,
          technicianGcId: box.technician_gc_id || undefined,
          details: `Adicionado ${qty}x "${selectedProduct.nome}"`,
        });
      setSelectedProduct(null);
      setQty(1);
      onItemsChanged();
    } catch (e) {
      toast.error("Erro ao adicionar item");
      console.error(e);
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveItem = async (itemToRemove: BoxItemData) => {
    if (!box) return;
    try {
      const { error } = await supabase.from("box_items").delete().eq("id", itemToRemove.id);
      if (error) throw error;

      await logBoxMovement({
        boxId: box.id,
        boxName: box.name,
        action: "remocao",
        produtoId: itemToRemove.produto_id,
        produtoNome: itemToRemove.nome_produto,
        quantidade: itemToRemove.quantidade,
        precoUnitario: itemToRemove.preco_unitario,
        technicianName: box.technician_name || undefined,
        technicianGcId: box.technician_gc_id || undefined,
        details: `Removido ${itemToRemove.quantidade}x "${itemToRemove.nome_produto}"`,
      });

      toast.success("Item removido");
      onItemsChanged();
    } catch {
      toast.error("Erro ao remover item");
    }
  };

  const handleScan = (code: string) => {
    supabase.functions
      .invoke("search-products-index", {
        body: { query: code, source: "box_scan" },
      })
      .then(({ data, error }) => {
        if (error || !data?.data?.length) {
          toast.error(`Produto não encontrado: ${code}`);
          return;
        }
        const product = data.data[0] as ProductResult;
        setSelectedProduct(product);
        toast.info(`Encontrado: ${product.nome}`);
      });
  };

  const isInOperation = !!box?.technician_name;
  const totalItems = items.reduce((sum, i) => sum + i.quantidade, 0);
  const totalValue = items.reduce((sum, i) => sum + i.quantidade * (i.preco_unitario || 0), 0);
  const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <>
      <Dialog open={!!box} onOpenChange={() => onClose()}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {box?.name}
              {box?.technician_name && (
                <Badge variant="outline" className="ml-2 text-xs bg-primary/10 text-primary border-primary/20">
                  <UserCheck className="h-3 w-3 mr-1" />
                  {box.technician_name}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Add Item Section - only when box is NOT in operation */}
          {isInOperation ? (
            <div className="p-3 bg-muted/30 rounded-lg border border-border text-center">
              <p className="text-xs text-muted-foreground">
                ⚠️ Caixa em operação com <span className="font-semibold">{box?.technician_name}</span> — não é possível adicionar ou remover itens.
              </p>
            </div>
          ) : (
            <div className="space-y-3 p-3 bg-muted/50 rounded-lg border border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Adicionar item
              </p>
              <ProductSearchInput
                onSelect={setSelectedProduct}
                onScanRequest={() => setScannerOpen(true)}
                autoFocus
              />
              {selectedProduct && (
                <div className="flex items-center gap-2 p-2 bg-card rounded-lg border border-border">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{selectedProduct.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      ID: {selectedProduct.produto_id}
                      {selectedProduct.codigo_interno && ` · Cód: ${selectedProduct.codigo_interno}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-7 w-7"
                      onClick={() => setQty(Math.max(1, qty - 1))}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Input type="number" value={qty}
                      onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-14 h-7 text-center text-sm" min={1} />
                    <Button variant="outline" size="icon" className="h-7 w-7"
                      onClick={() => setQty(qty + 1)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <Button size="sm" onClick={handleAddItem} disabled={adding} className="h-7">
                    {adding ? "..." : "Adicionar"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Items List */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loadingItems ? (
              <div className="space-y-2 p-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Nenhum item nesta caixa</p>
                <p className="text-xs mt-1">Use a busca acima para adicionar itens</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-2 py-1 mb-1">
                  <span className="text-xs text-muted-foreground">
                    {items.length} produto(s) · {totalItems} unidade(s)
                  </span>
                  <span className="text-xs font-semibold text-foreground">
                    {formatCurrency(totalValue)}
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 py-2 px-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {item.nome_produto}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          ID: {item.produto_id} · Qtd: {item.quantidade}
                          {item.preco_unitario > 0 && ` · ${formatCurrency(item.preco_unitario)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon"
                          className="h-7 w-7 text-primary hover:text-primary"
                          title="Baixa por OS/Venda"
                          onClick={() => setWriteOffItem(item)}>
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleRemoveItem(item)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Action buttons */}
          {box && (
            <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
              {!box.technician_name ? (
                <Button variant="outline" size="sm" onClick={() => onLinkTechnician(box)} className="text-xs">
                  <UserCheck className="h-3.5 w-3.5 mr-1" />
                  Vincular técnico
                </Button>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => onCheckin(box)} className="text-xs">
                    <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                    Check-in
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onUnlinkTechnician(box)}
                    className="text-xs text-muted-foreground">
                    <UserX className="h-3.5 w-3.5 mr-1" />
                    Desvincular técnico
                  </Button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScan}
      />
      <ItemWriteOffDialog
        open={!!writeOffItem}
        item={writeOffItem}
        box={box}
        onClose={() => setWriteOffItem(null)}
        onCompleted={onItemsChanged}
      />
    </>
  );
}
