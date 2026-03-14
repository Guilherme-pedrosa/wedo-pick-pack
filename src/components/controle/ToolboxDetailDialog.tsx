import { useState } from "react";
import {
  Wrench,
  Trash2,
  Plus,
  Minus,
  Pencil,
  Check,
  X,
  Copy,
  ClipboardCheck,
  UserCheck,
  UserX,
  Undo2,
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
import { logToolboxMovement } from "@/lib/toolboxMovementLog";
import { executeStockEntrada } from "@/api/stockMovement";

export interface ToolboxData {
  id: string;
  name: string;
  status: "active" | "closed" | "cancelled";
  created_at: string;
  closed_at: string | null;
  user_id: string;
  technician_name?: string | null;
  technician_gc_id?: string | null;
  venda_gc_id?: string | null;
  items_count?: number;
  total_value?: number;
}

export interface ToolboxItemData {
  id: string;
  toolbox_id: string;
  produto_id: string;
  nome_produto: string;
  quantidade: number;
  preco_unitario: number;
  added_at: string;
}

interface Props {
  toolbox: ToolboxData | null;
  items: ToolboxItemData[];
  loadingItems: boolean;
  isAdmin?: boolean;
  onClose: () => void;
  onItemsChanged: () => void;
  onLinkTechnician: (toolbox: ToolboxData) => void;
  onUnlinkTechnician: (toolbox: ToolboxData) => void;
  onConference: (toolbox: ToolboxData) => void;
  onDelete?: (toolbox: ToolboxData) => void;
  onClone?: (toolbox: ToolboxData) => void;
}

export default function ToolboxDetailDialog({
  toolbox,
  items,
  loadingItems,
  isAdmin,
  onClose,
  onItemsChanged,
  onLinkTechnician,
  onUnlinkTechnician,
  onConference,
  onDelete,
  onClone,
}: Props) {
  const [selectedProduct, setSelectedProduct] = useState<ProductResult | null>(null);
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [returningItem, setReturningItem] = useState<ToolboxItemData | null>(null);
  const [returnQty, setReturnQty] = useState(1);
  const [returning, setReturning] = useState(false);

  const handleRename = async () => {
    if (!toolbox || !newName.trim() || newName.trim() === toolbox.name) {
      setEditingName(false);
      return;
    }
    try {
      const { error } = await (supabase.from("toolboxes") as any)
        .update({ name: newName.trim() })
        .eq("id", toolbox.id);
      if (error) throw error;
      toast.success("Nome atualizado");
      setEditingName(false);
      onItemsChanged();
    } catch {
      toast.error("Erro ao renomear");
    }
  };

  const handleAddItem = async () => {
    if (!selectedProduct || !toolbox || qty < 1) return;
    setAdding(true);
    try {
      const preco = parseFloat(selectedProduct.payload_min_json?.preco_venda || "0") || 0;
      const existing = items.find((i) => i.produto_id === selectedProduct.produto_id);
      if (existing) {
        const { error } = await (supabase.from("toolbox_items") as any)
          .update({ quantidade: existing.quantidade + qty, preco_unitario: preco })
          .eq("id", existing.id);
        if (error) throw error;
        toast.success(`Quantidade atualizada: ${existing.quantidade + qty}`);
      } else {
        const { error } = await (supabase.from("toolbox_items") as any).insert({
          toolbox_id: toolbox.id,
          produto_id: selectedProduct.produto_id,
          nome_produto: selectedProduct.nome,
          quantidade: qty,
          preco_unitario: preco,
        });
        if (error) throw error;
        toast.success(`${selectedProduct.nome} adicionado`);
      }

      await logToolboxMovement({
        toolboxId: toolbox.id,
        toolboxName: toolbox.name,
        action: "adicao",
        produtoId: selectedProduct.produto_id,
        produtoNome: selectedProduct.nome,
        quantidade: qty,
        precoUnitario: preco,
        technicianName: toolbox.technician_name || undefined,
        technicianGcId: toolbox.technician_gc_id || undefined,
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

  const handleRemoveItem = async (item: ToolboxItemData) => {
    if (!toolbox) return;
    try {
      const { error } = await (supabase.from("toolbox_items") as any).delete().eq("id", item.id);
      if (error) throw error;

      await logToolboxMovement({
        toolboxId: toolbox.id,
        toolboxName: toolbox.name,
        action: "remocao",
        produtoId: item.produto_id,
        produtoNome: item.nome_produto,
        quantidade: item.quantidade,
        precoUnitario: item.preco_unitario,
        technicianName: toolbox.technician_name || undefined,
        technicianGcId: toolbox.technician_gc_id || undefined,
        details: `Removido ${item.quantidade}x "${item.nome_produto}"`,
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
        body: { query: code, source: "toolbox_scan" },
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

  const handleReturnItem = async () => {
    if (!returningItem || !toolbox || returnQty < 1) return;
    setReturning(true);
    try {
      if (returnQty >= returningItem.quantidade) {
        // Remove entirely
        const { error } = await (supabase.from("toolbox_items") as any).delete().eq("id", returningItem.id);
        if (error) throw error;
      } else {
        // Decrease quantity
        const { error } = await (supabase.from("toolbox_items") as any)
          .update({ quantidade: returningItem.quantidade - returnQty })
          .eq("id", returningItem.id);
        if (error) throw error;
      }

      await logToolboxMovement({
        toolboxId: toolbox.id,
        toolboxName: toolbox.name,
        action: "devolucao",
        produtoId: returningItem.produto_id,
        produtoNome: returningItem.nome_produto,
        quantidade: Math.min(returnQty, returningItem.quantidade),
        precoUnitario: returningItem.preco_unitario,
        technicianName: toolbox.technician_name || undefined,
        technicianGcId: toolbox.technician_gc_id || undefined,
        details: `Devolvido ${Math.min(returnQty, returningItem.quantidade)}x "${returningItem.nome_produto}"`,
      });

      toast.success(`${returningItem.nome_produto} devolvido`);

      // Estorna ajuste de estoque no ERP quando houver referência vinculada
      if (toolbox.venda_gc_id) {
        try {
          toast.info("Estornando ajuste de estoque no ERP...");
          const result = await executeStockEntrada({
            vendaGcId: toolbox.venda_gc_id,
            toolboxName: toolbox.name,
            technicianName: toolbox.technician_name || "",
          });
          if (result.success) {
            // Clear venda_gc_id from toolbox
            await (supabase.from("toolboxes") as any)
              .update({ venda_gc_id: null })
              .eq("id", toolbox.id);
            toast.success("Ajuste de estoque estornado no ERP");
          } else {
            toast.error(`Erro ao estornar ajuste: ${result.error}`);
          }
        } catch (err) {
          console.error("Error reverting stock adjustment:", err);
          toast.error("Erro ao estornar ajuste de estoque no ERP");
        }
      }

      setReturningItem(null);
      setReturnQty(1);
      onItemsChanged();
    } catch (e) {
      toast.error("Erro ao devolver item");
      console.error(e);
    } finally {
      setReturning(false);
    }
  };

  const totalItems = items.reduce((sum, i) => sum + i.quantidade, 0);
  const totalValue = items.reduce((sum, i) => sum + i.quantidade * (i.preco_unitario || 0), 0);
  const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <>
      <Dialog open={!!toolbox} onOpenChange={() => onClose()}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              {editingName ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleRename()}
                    className="h-7 text-sm w-48"
                    autoFocus
                  />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRename}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingName(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <>
                  <span>{toolbox?.name}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setNewName(toolbox?.name || ""); setEditingName(true); }}>
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </>
              )}
              {toolbox?.technician_name && (
                <Badge variant="outline" className="ml-2 text-xs bg-primary/10 text-primary border-primary/20">
                  <UserCheck className="h-3 w-3 mr-1" />
                  {toolbox.technician_name}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Add Item Section */}
          <div className="space-y-3 p-3 bg-muted/50 rounded-lg border border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Adicionar ferramenta
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
                <Wrench className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Nenhuma ferramenta nesta maleta</p>
                <p className="text-xs mt-1">Use a busca acima para adicionar ferramentas</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-2 py-1 mb-1">
                  <span className="text-xs text-muted-foreground">
                    {items.length} ferramenta(s) · {totalItems} unidade(s)
                  </span>
                  <span className="text-xs font-semibold text-foreground">
                    {formatCurrency(totalValue)}
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {items.map((item) => (
                    <div key={item.id} className="py-2 px-2">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {item.nome_produto}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            ID: {item.produto_id} · Qtd: {item.quantidade}
                            {item.preco_unitario > 0 && ` · ${formatCurrency(item.preco_unitario)}`}
                          </p>
                        </div>
                        <Button variant="ghost" size="icon"
                          className="h-7 w-7 text-primary hover:text-primary"
                          title="Devolver peça"
                          onClick={() => { setReturningItem(item); setReturnQty(1); }}>
                          <Undo2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleRemoveItem(item)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {returningItem?.id === item.id && (
                        <div className="flex items-center gap-2 mt-2 p-2 bg-primary/5 rounded-md border border-primary/20">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">Devolver:</span>
                          <div className="flex items-center gap-1">
                            <Button variant="outline" size="icon" className="h-6 w-6"
                              onClick={() => setReturnQty(Math.max(1, returnQty - 1))}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <Input type="number" value={returnQty}
                              onChange={(e) => setReturnQty(Math.max(1, Math.min(item.quantidade, parseInt(e.target.value) || 1)))}
                              className="w-12 h-6 text-center text-xs" min={1} max={item.quantidade} />
                            <Button variant="outline" size="icon" className="h-6 w-6"
                              onClick={() => setReturnQty(Math.min(item.quantidade, returnQty + 1))}>
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                          <span className="text-xs text-muted-foreground">de {item.quantidade}</span>
                          <Button size="sm" className="h-6 text-xs ml-auto" onClick={handleReturnItem} disabled={returning}>
                            {returning ? "..." : "Confirmar"}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setReturningItem(null)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Action buttons */}
          {toolbox && (
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border">
              {!toolbox.technician_name ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => onLinkTechnician(toolbox)} className="text-xs">
                    <UserCheck className="h-3.5 w-3.5 mr-1" />
                    Vincular técnico
                  </Button>
                  {items.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => onConference(toolbox)} className="text-xs">
                      <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                      Conferência
                    </Button>
                  )}
                  {onClone && (
                    <Button variant="outline" size="sm" onClick={() => onClone(toolbox)} className="text-xs">
                      <Copy className="h-3.5 w-3.5 mr-1" />
                      Clonar
                    </Button>
                  )}
                  {isAdmin && onDelete && (
                    <Button variant="ghost" size="sm" onClick={() => onDelete(toolbox)}
                      className="text-xs text-destructive hover:text-destructive ml-auto">
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Excluir maleta
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {items.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => onConference(toolbox)} className="text-xs">
                      <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                      Conferência
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => {
                    if (items.length > 0) {
                      onConference(toolbox);
                    } else {
                      onUnlinkTechnician(toolbox);
                    }
                  }}
                    className="text-xs text-muted-foreground">
                    <UserX className="h-3.5 w-3.5 mr-1" />
                    Desvincular técnico
                  </Button>
                  {onClone && (
                    <Button variant="outline" size="sm" onClick={() => onClone(toolbox)} className="text-xs">
                      <Copy className="h-3.5 w-3.5 mr-1" />
                      Clonar
                    </Button>
                  )}
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
    </>
  );
}
