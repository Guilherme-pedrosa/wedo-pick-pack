import { useState, useEffect } from "react";
import { Plus, Clock, UserCheck, Wrench, Pause, ArrowUpRight, Printer, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import ToolboxDetailDialog, {
  type ToolboxData,
  type ToolboxItemData,
} from "@/components/controle/ToolboxDetailDialog";
import ToolboxTechnicianLinkDialog from "@/components/controle/ToolboxTechnicianLinkDialog";
import ToolboxConferenceDialog from "@/components/controle/ToolboxConferenceDialog";
import ToolboxHandoffReceipt from "@/components/controle/ToolboxHandoffReceipt";

const ToolboxesPage = () => {
  const { user, isAdmin } = useAuth();
  const [toolboxes, setToolboxes] = useState<ToolboxData[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  // Detail dialog
  const [selectedToolbox, setSelectedToolbox] = useState<ToolboxData | null>(null);
  const [toolboxItems, setToolboxItems] = useState<ToolboxItemData[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // Technician link
  const [techToolbox, setTechToolbox] = useState<ToolboxData | null>(null);

  // Conference
  const [conferenceToolbox, setConferenceToolbox] = useState<ToolboxData | null>(null);
  const [conferenceItems, setConferenceItems] = useState<ToolboxItemData[]>([]);
  const [conferenceUnlink, setConferenceUnlink] = useState(false);
  // Receipt
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<{
    toolboxName: string;
    technicianName: string;
    technicianGcId: string;
    items: ToolboxItemData[];
    date: string;
  } | null>(null);

  useEffect(() => {
    loadToolboxes();
  }, []);

  const loadToolboxes = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase.from("toolboxes") as any)
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false });

      if (error) throw error;

      if (data?.length) {
        const { data: itemsData } = await (supabase.from("toolbox_items") as any)
          .select("toolbox_id, quantidade, preco_unitario");

        const countMap = new Map<string, number>();
        const valueMap = new Map<string, number>();
        itemsData?.forEach((c: any) => {
          countMap.set(c.toolbox_id, (countMap.get(c.toolbox_id) || 0) + 1);
          valueMap.set(c.toolbox_id, (valueMap.get(c.toolbox_id) || 0) + (c.quantidade || 0) * (c.preco_unitario || 0));
        });

        setToolboxes(
          data.map((t: any) => ({
            ...t,
            items_count: countMap.get(t.id) || 0,
            total_value: valueMap.get(t.id) || 0,
          }))
        );
      } else {
        setToolboxes([]);
      }
    } catch {
      toast.error("Erro ao carregar maletas");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim() || !user) return;
    try {
      const { error } = await (supabase.from("toolboxes") as any)
        .insert({ name: newName.trim(), user_id: user.id });
      if (error) throw error;
      toast.success("Maleta criada!");
      setCreateOpen(false);
      setNewName("");
      loadToolboxes();
    } catch {
      toast.error("Erro ao criar maleta");
    }
  };

  const loadToolboxItems = async (toolbox: ToolboxData) => {
    setSelectedToolbox(toolbox);
    setLoadingItems(true);
    try {
      const { data, error } = await (supabase.from("toolbox_items") as any)
        .select("*")
        .eq("toolbox_id", toolbox.id)
        .order("added_at", { ascending: false });
      if (error) throw error;
      setToolboxItems(data || []);
    } catch {
      toast.error("Erro ao carregar ferramentas");
    } finally {
      setLoadingItems(false);
    }
  };


  const handleOpenConference = async (toolbox: ToolboxData, unlink = false) => {
    try {
      const { data, error } = await (supabase.from("toolbox_items") as any)
        .select("*")
        .eq("toolbox_id", toolbox.id)
        .order("added_at", { ascending: false });
      if (error) throw error;
      setConferenceItems(data || []);
      setConferenceUnlink(unlink);
      setConferenceToolbox(toolbox);
      setSelectedToolbox(null);
    } catch {
      toast.error("Erro ao carregar itens para conferência");
    }
  };

  const handleUnlinkTechnician = async (toolbox: ToolboxData) => {
    // If toolbox has items, require conference first
    const { data: items } = await (supabase.from("toolbox_items") as any)
      .select("id")
      .eq("toolbox_id", toolbox.id)
      .limit(1);
    if (items && items.length > 0) {
      handleOpenConference(toolbox, true);
      return;
    }
    // No items, unlink directly (also clear venda_gc_id)
    try {
      const { error } = await (supabase.from("toolboxes") as any)
        .update({ technician_name: null, technician_gc_id: null, venda_gc_id: null })
        .eq("id", toolbox.id);
      if (error) throw error;
      toast.success(`Técnico desvinculado de "${toolbox.name}"`);
      loadToolboxes();
      setSelectedToolbox(null);
    } catch {
      toast.error("Erro ao desvincular técnico");
    }
  };

  const handleDeleteToolbox = async (toolbox: ToolboxData) => {
    if (!confirm(`Tem certeza que deseja excluir a maleta "${toolbox.name}"? As ferramentas serão removidas, mas o histórico será mantido.`)) return;
    try {
      await (supabase.from("toolbox_items") as any).delete().eq("toolbox_id", toolbox.id);
      const { error } = await (supabase.from("toolboxes") as any)
        .update({ status: "cancelled" })
        .eq("id", toolbox.id);
      if (error) throw error;
      toast.success(`Maleta "${toolbox.name}" excluída`);
      setSelectedToolbox(null);
      loadToolboxes();
    } catch {
      toast.error("Erro ao excluir maleta");
    }
  };

  const handleCloneToolbox = async (toolbox: ToolboxData) => {
    if (!user) return;
    try {
      const cloneName = `${toolbox.name} (cópia)`;
      const { data: newTb, error } = await (supabase.from("toolboxes") as any)
        .insert({ name: cloneName, user_id: user.id })
        .select("id")
        .single();
      if (error || !newTb) throw error;

      const { data: sourceItems } = await (supabase.from("toolbox_items") as any)
        .select("*")
        .eq("toolbox_id", toolbox.id);

      if (sourceItems?.length) {
        const cloned = sourceItems.map((item: any) => ({
          toolbox_id: newTb.id,
          produto_id: item.produto_id,
          nome_produto: item.nome_produto,
          quantidade: item.quantidade,
          preco_unitario: item.preco_unitario,
        }));
        await (supabase.from("toolbox_items") as any).insert(cloned);
      }

      toast.success(`Maleta "${cloneName}" criada com ${sourceItems?.length || 0} itens`);
      setSelectedToolbox(null);
      loadToolboxes();
    } catch {
      toast.error("Erro ao clonar maleta");
    }
  };

  const handleShowReceipt = async (toolbox: ToolboxData, techName: string, techGcId: string) => {
    const { data: items } = await (supabase.from("toolbox_items") as any)
      .select("*")
      .eq("toolbox_id", toolbox.id);

    // Enrich items with codigo_interno and valor_venda from products_index
    const produtoIds = (items || []).map((i: any) => i.produto_id);
    let productMap = new Map<string, { codigo_interno?: string; preco_venda?: number }>();
    if (produtoIds.length > 0) {
      const { data: products } = await supabase
        .from("products_index")
        .select("produto_id, codigo_interno, payload_min_json")
        .in("produto_id", produtoIds);
      products?.forEach((p) => {
        const payload = p.payload_min_json as any;
        const precoVenda = parseFloat(payload?.preco_venda || payload?.valor_venda || "0") || 0;
        productMap.set(p.produto_id, {
          codigo_interno: p.codigo_interno || undefined,
          preco_venda: precoVenda,
        });
      });
    }

    const enrichedItems = (items || []).map((i: any) => {
      const info = productMap.get(i.produto_id);
      return {
        ...i,
        codigo_interno: info?.codigo_interno || "",
        preco_unitario: i.preco_unitario && i.preco_unitario > 0 ? i.preco_unitario : (info?.preco_venda || 0),
      };
    });

    setReceiptData({
      toolboxName: toolbox.name,
      technicianName: techName,
      technicianGcId: techGcId,
      items: enrichedItems,
      date: new Date().toISOString(),
    });
    setReceiptOpen(true);
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const linkedToolboxes = toolboxes.filter((t) => t.technician_name);
  const unlinkedToolboxes = toolboxes.filter((t) => !t.technician_name);

  const renderRow = (toolbox: ToolboxData, variant: "linked" | "unlinked") => {
    const isLinked = variant === "linked";
    return (
      <div
        key={toolbox.id}
        className="flex items-center gap-4 px-4 py-3 hover:bg-accent/30 transition-colors cursor-pointer group"
        onClick={() => loadToolboxItems(toolbox)}
      >
        <div className={`flex items-center justify-center h-10 w-10 rounded-lg shrink-0 ${
          isLinked ? "bg-primary/10 text-primary" : "bg-warning/10 text-warning"
        }`}>
          <Wrench className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground text-sm truncate">{toolbox.name}</h3>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${
              isLinked
                ? "bg-primary/10 text-primary border-primary/20"
                : "bg-warning/10 text-warning border-warning/20"
            }`}>
              {isLinked ? "Com técnico" : "Sem vínculo"}
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {toolbox.technician_name && (
              <span className="flex items-center gap-1 text-xs text-primary font-medium">
                <UserCheck className="h-3 w-3" />
                {toolbox.technician_name}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{toolbox.items_count || 0} ferramentas</span>
            {(toolbox.total_value || 0) > 0 && (
              <span className="text-xs font-semibold text-foreground">
                {formatCurrency(toolbox.total_value || 0)}
              </span>
            )}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatDate(toolbox.created_at)}
            </span>
          </div>
        </div>
        {isLinked && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => { e.stopPropagation(); handleOpenConference(toolbox); }}
            >
              <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
              Conferência
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                handleShowReceipt(toolbox, toolbox.technician_name!, toolbox.technician_gc_id!);
              }}
            >
              <Printer className="h-3.5 w-3.5 mr-1" />
              Minuta
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">
            Gerencie as maletas de ferramentas dos técnicos
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Maleta
        </Button>
      </div>

      {/* Com Técnico */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ArrowUpRight className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            Com Técnico ({linkedToolboxes.length})
          </h3>
        </div>
        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        ) : linkedToolboxes.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-6 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma maleta vinculada</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Vincule um técnico a uma maleta para começar</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border">
            {linkedToolboxes.map((t) => renderRow(t, "linked"))}
          </div>
        )}
      </div>

      {/* Sem Vínculo */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Pause className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            Sem Vínculo ({unlinkedToolboxes.length})
          </h3>
        </div>
        {!loading && unlinkedToolboxes.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-6 text-center">
            <Wrench className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma maleta sem vínculo</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Criar maleta
            </Button>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border">
            {unlinkedToolboxes.map((t) => renderRow(t, "unlinked"))}
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      <ToolboxDetailDialog
        toolbox={selectedToolbox}
        items={toolboxItems}
        loadingItems={loadingItems}
        isAdmin={isAdmin}
        onClose={() => setSelectedToolbox(null)}
        onItemsChanged={() => {
          if (selectedToolbox) loadToolboxItems(selectedToolbox);
          loadToolboxes();
        }}
        onLinkTechnician={(t) => {
          setTechToolbox(t);
          setSelectedToolbox(null);
        }}
        onUnlinkTechnician={handleUnlinkTechnician}
        onConference={handleOpenConference}
        onDelete={handleDeleteToolbox}
        onClone={handleCloneToolbox}
      />

      {/* Technician Link Dialog */}
      <ToolboxTechnicianLinkDialog
        toolbox={techToolbox}
        onClose={() => setTechToolbox(null)}
        onLinked={loadToolboxes}
        onShowReceipt={handleShowReceipt}
      />

      {/* Conference Dialog */}
      <ToolboxConferenceDialog
        toolbox={conferenceToolbox}
        items={conferenceItems}
        onClose={() => { setConferenceToolbox(null); setConferenceUnlink(false); }}
        onCompleted={() => {
          setConferenceToolbox(null);
          setConferenceUnlink(false);
          loadToolboxes();
        }}
        unlinkOnComplete={conferenceUnlink}
      />

      {/* Receipt */}
      {receiptData && (
        <ToolboxHandoffReceipt
          open={receiptOpen}
          onClose={() => { setReceiptOpen(false); setReceiptData(null); }}
          toolboxName={receiptData.toolboxName}
          technicianName={receiptData.technicianName}
          technicianGcId={receiptData.technicianGcId}
          items={receiptData.items}
          date={receiptData.date}
        />
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova Maleta</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Nome da maleta (ex: Maleta A, Kit Elétrica...)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!newName.trim()}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ToolboxesPage;
