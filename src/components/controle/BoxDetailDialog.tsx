import { useState, useEffect } from "react";
import {
  Package,
  Trash2,
  Plus,
  Minus,
  UserCheck,
  UserX,
  ClipboardCheck,
  FileText,
  AlertTriangle,
  Pencil,
  Check,
  X,
  Copy,
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
import BoxHandoffReceipt from "./BoxHandoffReceipt";
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
  isAdmin?: boolean;
  onClose: () => void;
  onItemsChanged: () => void;
  onLinkTechnician: (box: BoxData) => void;
  onUnlinkTechnician: (box: BoxData) => void;
  onCheckin: (box: BoxData) => void;
  onDelete?: (box: BoxData) => void;
  onClone?: (box: BoxData) => void;
}

export default function BoxDetailDialog({
  box,
  items,
  loadingItems,
  isAdmin,
  onClose,
  onItemsChanged,
  onLinkTechnician,
  onUnlinkTechnician,
  onCheckin,
  onDelete,
  onClone,
}: Props) {
  const [selectedProduct, setSelectedProduct] = useState<ProductResult | null>(null);
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [writeOffItem, setWriteOffItem] = useState<BoxItemData | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");

  const handleRename = async () => {
    if (!box || !newName.trim() || newName.trim() === box.name) {
      setEditingName(false);
      return;
    }
    try {
      const { error } = await supabase
        .from("boxes")
        .update({ name: newName.trim() })
        .eq("id", box.id);
      if (error) throw error;
      toast.success("Nome atualizado");
      setEditingName(false);
      onItemsChanged();
    } catch {
      toast.error("Erro ao renomear");
    }
  };
  const [reversalLogs, setReversalLogs] = useState<Record<string, { reason: string; date: string; operator: string }>>({});

  const isPendenciasBox = box?.name?.includes("Pendências");

  useEffect(() => {
    if (!box || !isPendenciasBox) {
      setReversalLogs({});
      return;
    }
    // Fetch reversal logs for items in this box
    supabase
      .from("box_movement_logs")
      .select("*")
      .eq("box_id", box.id)
      .eq("action", "adicao")
      .like("details", "Estorno automático:%")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        const map: Record<string, { reason: string; date: string; operator: string }> = {};
        for (const log of data || []) {
          if (log.produto_id && !map[log.produto_id]) {
            map[log.produto_id] = {
              reason: log.details?.replace("Estorno automático: ", "").split(" | ref:")[0] || "Estorno automático",
              date: log.created_at,
              operator: log.operator_name || "",
            };
          }
        }
        setReversalLogs(map);
      });
  }, [box?.id, isPendenciasBox]);

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
                  <span>{box?.name}</span>
                  {!isPendenciasBox && (
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setNewName(box?.name || ""); setEditingName(true); }}>
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  )}
                </>
              )}
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
                        {isPendenciasBox && reversalLogs[item.produto_id] && (
                          <div className="mt-1 p-1.5 bg-warning/10 border border-warning/20 rounded text-[11px] space-y-0.5">
                            <p className="flex items-center gap-1 font-medium text-warning">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              {reversalLogs[item.produto_id].reason}
                            </p>
                            <p className="text-muted-foreground pl-4">
                              Estornado em {new Date(reversalLogs[item.produto_id].date).toLocaleString("pt-BR")}
                              {reversalLogs[item.produto_id].operator && <> · Operador: {reversalLogs[item.produto_id].operator}</>}
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon"
                          className="h-7 w-7 text-primary hover:text-primary"
                          title="Baixa por OS/Venda"
                          onClick={() => setWriteOffItem(item)}>
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                        {!isInOperation && !isPendenciasBox && (
                          <Button variant="ghost" size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => handleRemoveItem(item)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Action buttons */}
          {box && (
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border">
              {!box.technician_name ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => onLinkTechnician(box)} className="text-xs">
                    <UserCheck className="h-3.5 w-3.5 mr-1" />
                    Vincular técnico
                  </Button>
                  {onClone && (
                    <Button variant="outline" size="sm" onClick={() => onClone(box)} className="text-xs">
                      <Copy className="h-3.5 w-3.5 mr-1" />
                      Clonar
                    </Button>
                  )}
                  {isAdmin && onDelete && !isPendenciasBox && (
                    <Button variant="ghost" size="sm" onClick={() => onDelete(box)}
                      className="text-xs text-destructive hover:text-destructive ml-auto">
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Excluir caixa
                    </Button>
                  )}
                </>
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
                  {onClone && (
                    <Button variant="outline" size="sm" onClick={() => onClone(box)} className="text-xs">
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
