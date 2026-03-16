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
import { logBoxMovement } from "@/lib/boxMovementLog";

interface Props {
  open: boolean;
  box: BoxData | null;
  onClose: () => void;
  onCompleted: () => void;
}

export default function QuickWriteOffDialog({ open, box, onClose, onCompleted }: Props) {
  const [boxItems, setBoxItems] = useState<BoxItemData[]>([]);
  const [productCodes, setProductCodes] = useState<Record<string, string>>({});
  const [matchedItem, setMatchedItem] = useState<BoxItemData | null>(null);
  const [comboOpen, setComboOpen] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);

  const [tipo, setTipo] = useState<"os" | "venda">("os");
  const [ref, setRef] = useState("");
  const [qty, setQty] = useState(1);
  const [validado, setValidado] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [maxAllowedQty, setMaxAllowedQty] = useState(1);

  const resetState = () => {
    setMatchedItem(null);
    setTipo("os");
    setRef("");
    setQty(1);
    setValidado(false);
    setBoxItems([]);
    setComboOpen(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // Load box items when dialog opens
  const loadItems = async () => {
    if (!box) return;
    setLoadingItems(true);

    const { data } = await supabase
      .from("box_items")
      .select("*")
      .eq("box_id", box.id)
      .order("nome_produto", { ascending: true });

    const items = data || [];
    setBoxItems(items);

    const produtoIds = [...new Set(items.map((item) => item.produto_id).filter(Boolean))];
    if (produtoIds.length > 0) {
      const { data: indexData } = await supabase
        .from("products_index")
        .select("produto_id, codigo_interno")
        .in("produto_id", produtoIds);

      const codesMap: Record<string, string> = {};
      (indexData || []).forEach((p) => {
        if (p.codigo_interno) {
          codesMap[p.produto_id] = p.codigo_interno;
        }
      });
      setProductCodes(codesMap);
    } else {
      setProductCodes({});
    }

    setLoadingItems(false);
  };

  useEffect(() => {
    if (open && box) {
      loadItems();
    }
  }, [open, box?.id]);

  const handleItemSelect = (item: BoxItemData) => {
    setMatchedItem(item);
    setComboOpen(false);
    setQty(1);
    setValidado(false);
    setRef("");
  };

  const handleValidate = async () => {
    if (!ref || !matchedItem || !box) return;
    const label = tipo === "os" ? "OS" : "Venda";
    setValidating(true);
    try {
      // Try multiple search strategies to find the OS/Venda
      const refTrimmed = ref.trim();
      const endpoint = tipo === "os" ? "ordens_servicos" : "vendas";
      
      // Strategy 1: Search by codigo parameter
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

      const detailId = match.id || match.ordem_servico_id || match.venda_id;
      
      // If match already has produtos (from direct fetch), skip detail fetch
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

      // Date validation — compare against last technician link date (handoff)
      const orderDateStr = orderData?.cadastrado_em || orderData?.created_at;
      if (orderDateStr && box) {
        let orderDate: Date;
        const brMatch = String(orderDateStr).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (brMatch) {
          orderDate = new Date(parseInt(brMatch[3]), parseInt(brMatch[2]) - 1, parseInt(brMatch[1]));
        } else {
          orderDate = new Date(orderDateStr);
        }

        // Get latest handoff date for this box
        const { data: lastHandoff } = await supabase
          .from("box_handoff_logs")
          .select("handed_at")
          .eq("box_id", box.id)
          .order("handed_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const referenceDate = lastHandoff?.handed_at ? new Date(lastHandoff.handed_at) : new Date(box.created_at);
        const orderDay = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate());
        const refDay = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());

        if (isNaN(orderDay.getTime())) {
          console.warn("Could not parse order date:", orderDateStr);
        } else if (orderDay < refDay) {
          toast.error(
            `${label} #${ref} é de ${orderDay.toLocaleDateString("pt-BR")}, anterior à vinculação da caixa (${refDay.toLocaleDateString("pt-BR")}). Não é permitido.`
          );
          return;
        }
      }

      // Product validation + quantity check
      const produtos = orderData?.produtos || [];
      const productInOrder = produtos.find(
        (p: any) =>
          p?.produto?.produto_id === matchedItem.produto_id ||
          String(p?.produto?.produto_id) === matchedItem.produto_id
      );
      if (!productInOrder) {
        toast.warning(`Produto "${matchedItem.nome_produto}" não encontrado na ${label} #${ref}`);
        return;
      }

      const orderQty = parseFloat(productInOrder.quantidade) || 1;

      // Check how many units of this product were already used with this ref
      const { data: existingLogs } = await supabase
        .from("box_movement_logs")
        .select("quantidade")
        .eq("action", "baixa")
        .eq("ref_tipo", tipo)
        .eq("ref_numero", ref.trim())
        .eq("produto_id", matchedItem.produto_id);

      const alreadyUsed = (existingLogs || []).reduce((sum, l) => sum + (l.quantidade || 0), 0);
      const remaining = orderQty - alreadyUsed;

      if (remaining <= 0) {
        toast.error(`${label} #${ref} já foi totalmente utilizada para baixa deste produto (${orderQty}x já usadas)`);
        return;
      }

      setMaxAllowedQty(Math.min(remaining, matchedItem.quantidade));
      setQty(1);
      setValidado(true);
      toast.success(`Validado: ${remaining}x disponível na ${label} #${ref}`);
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

      await logBoxMovement({
        boxId: box.id,
        boxName: box.name,
        action: "baixa",
        produtoId: matchedItem.produto_id,
        produtoNome: matchedItem.nome_produto,
        quantidade: qty,
        precoUnitario: matchedItem.preco_unitario,
        refTipo: tipo,
        refNumero: ref.trim(),
        technicianName: box.technician_name || undefined,
        technicianGcId: box.technician_gc_id || undefined,
        details: `Baixa de ${qty}x vinculada à ${tipo === "os" ? "OS" : "Venda"} #${ref.trim()}`,
      });

      const label = tipo === "os" ? "OS" : "Venda";
      toast.success(`Baixa de ${qty}x "${matchedItem.nome_produto}" vinculada à ${label} #${ref}`);
      // Reset for next item
      setMatchedItem(null);
      setRef("");
      setQty(1);
      setValidado(false);
      // Reload items
      await loadItems();
      onCompleted();
    } catch (e) {
      toast.error("Erro ao realizar baixa");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!box) return null;
  const maxQty = validado ? maxAllowedQty : (matchedItem?.quantidade || 1);

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5" />
              Baixa por OS/Venda — {box.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 flex-1 overflow-y-auto">
            {/* Step 1: Select item from box */}
            {!matchedItem && (
              <div className="space-y-3">
                <Label className="text-xs">Selecione o item utilizado</Label>
                <Popover open={comboOpen} onOpenChange={setComboOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={comboOpen}
                      className="w-full justify-between h-9 text-sm font-normal"
                    >
                      {loadingItems ? "Carregando..." : "Selecionar produto..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Filtrar por nome, código ou ID..." />
                      <CommandList>
                        <CommandEmpty>Nenhum item encontrado.</CommandEmpty>
                        <CommandGroup>
                          {boxItems.map((item) => {
                            const codigoInterno = productCodes[item.produto_id];
                            return (
                              <CommandItem
                                key={item.id}
                                value={`${codigoInterno || ""} ${item.produto_id} ${item.nome_produto}`.trim()}
                                onSelect={() => handleItemSelect(item)}
                                className="flex flex-col items-start gap-0.5 py-2"
                              >
                                <span className="text-sm font-medium">{item.nome_produto}</span>
                                <span className="text-xs text-muted-foreground">
                                  Código: {codigoInterno || "—"} · ID: {item.produto_id} · Qtd: {item.quantidade}
                                  {item.preco_unitario > 0 && ` · R$ ${item.preco_unitario.toFixed(2)}`}
                                </span>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
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
                        Código: {productCodes[matchedItem.produto_id] || "—"} · ID: {matchedItem.produto_id} · Na caixa: {matchedItem.quantidade}
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

    </>
  );
}
