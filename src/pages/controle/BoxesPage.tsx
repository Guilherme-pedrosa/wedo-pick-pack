import { useState, useEffect, useRef } from "react";
import { Plus, Package, Clock, UserCheck, RefreshCw, ArrowUpRight, Box, Pause, FileText } from "lucide-react";
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
import BoxDetailDialog, {
  type BoxData,
  type BoxItemData,
} from "@/components/controle/BoxDetailDialog";
import TechnicianLinkDialog from "@/components/controle/TechnicianLinkDialog";
import CheckinDialog from "@/components/controle/CheckinDialog";
import QuickWriteOffDialog from "@/components/controle/QuickWriteOffDialog";

const BoxesPage = () => {
  const { user } = useAuth();
  const [boxes, setBoxes] = useState<BoxData[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newBoxName, setNewBoxName] = useState("");

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ fetched: number; total: number } | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [productsCount, setProductsCount] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Detail dialog state
  const [selectedBox, setSelectedBox] = useState<BoxData | null>(null);
  const [boxItems, setBoxItems] = useState<BoxItemData[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // Technician link dialog
  const [techBox, setTechBox] = useState<BoxData | null>(null);

  // Check-in dialog
  const [checkinBox, setCheckinBox] = useState<BoxData | null>(null);
  const [checkinItems, setCheckinItems] = useState<BoxItemData[]>([]);

  // Quick write-off dialog
  const [writeOffBox, setWriteOffBox] = useState<BoxData | null>(null);

  useEffect(() => {
    loadBoxes();
    loadLastSync();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const loadLastSync = async () => {
    const [syncResult, countResult] = await Promise.all([
      supabase
        .from("sync_runs")
        .select("finished_at, status")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("products_index")
        .select("produto_id", { count: "exact", head: true }),
    ]);
    if (syncResult.data?.finished_at) {
      setLastSync(syncResult.data.finished_at);
    }
    if (countResult.count !== null) {
      setProductsCount(countResult.count);
    }
  };

  const startProgressPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from("sync_runs")
        .select("fetched_count, total_count, status, finished_at")
        .eq("status", "running")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setSyncProgress({ fetched: data.fetched_count, total: data.total_count });
      }

      if (!data || data.finished_at) {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 2000);
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncProgress({ fetched: 0, total: 0 });
    startProgressPolling();
    try {
      const { data, error } = await supabase.functions.invoke("sync-products", {
        body: { run_type: "full" },
      });
      if (error) throw error;
      toast.success(`Sync concluído! ${data?.upsertCount || 0} produtos atualizados`);
      loadLastSync();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao sincronizar produtos");
    } finally {
      if (pollRef.current) clearInterval(pollRef.current);
      setSyncProgress(null);
      setSyncing(false);
    }
  };

  const loadBoxes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("boxes")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false });

      if (error) throw error;

      if (data && data.length > 0) {
        const { data: itemsData } = await supabase
          .from("box_items")
          .select("box_id, quantidade, preco_unitario");
        const countMap = new Map<string, number>();
        const valueMap = new Map<string, number>();
        itemsData?.forEach((c: any) => {
          countMap.set(c.box_id, (countMap.get(c.box_id) || 0) + 1);
          valueMap.set(c.box_id, (valueMap.get(c.box_id) || 0) + (c.quantidade || 0) * (c.preco_unitario || 0));
        });

        setBoxes(
          data.map((b) => ({
            ...b,
            status: b.status as BoxData["status"],
            items_count: countMap.get(b.id) || 0,
            total_value: valueMap.get(b.id) || 0,
          }))
        );
      } else {
        setBoxes([]);
      }
    } catch {
      toast.error("Erro ao carregar caixas");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newBoxName.trim() || !user) return;
    try {
      const { error } = await supabase
        .from("boxes")
        .insert({ name: newBoxName.trim(), user_id: user.id });
      if (error) throw error;
      toast.success("Caixa criada!");
      setCreateOpen(false);
      setNewBoxName("");
      loadBoxes();
    } catch {
      toast.error("Erro ao criar caixa");
    }
  };

  const handleUnlinkTechnician = async (box: BoxData) => {
    try {
      const { error } = await supabase
        .from("boxes")
        .update({ technician_name: null, technician_gc_id: null })
        .eq("id", box.id);
      if (error) throw error;
      toast.success(`Técnico desvinculado de "${box.name}"`);
      loadBoxes();
      setSelectedBox(null);
    } catch {
      toast.error("Erro ao desvincular técnico");
    }
  };

  const loadBoxItems = async (box: BoxData) => {
    setSelectedBox(box);
    setLoadingItems(true);
    try {
      const { data, error } = await supabase
        .from("box_items")
        .select("*")
        .eq("box_id", box.id)
        .order("added_at", { ascending: false });
      if (error) throw error;
      setBoxItems(data || []);
    } catch {
      toast.error("Erro ao carregar itens");
    } finally {
      setLoadingItems(false);
    }
  };

  const handleOpenCheckin = async (box: BoxData) => {
    try {
      const { data, error } = await supabase
        .from("box_items")
        .select("*")
        .eq("box_id", box.id)
        .order("added_at", { ascending: false });
      if (error) throw error;
      setCheckinItems(data || []);
      setCheckinBox(box);
      setSelectedBox(null);
    } catch {
      toast.error("Erro ao carregar itens para check-in");
    }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const inOperationBoxes = boxes.filter((b) => b.technician_name);
  const standByBoxes = boxes.filter((b) => !b.technician_name);

  const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const renderBoxRow = (box: BoxData, variant: "operation" | "standby") => {
    const isOperation = variant === "operation";
    return (
      <div
        key={box.id}
        className="flex items-center gap-4 px-4 py-3 hover:bg-accent/30 transition-colors cursor-pointer group"
        onClick={() => loadBoxItems(box)}
      >
        <div className={`flex items-center justify-center h-10 w-10 rounded-lg shrink-0 ${
          isOperation ? "bg-primary/10 text-primary" : "bg-warning/10 text-warning"
        }`}>
          <Box className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground text-sm truncate">{box.name}</h3>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${
              isOperation
                ? "bg-primary/10 text-primary border-primary/20"
                : "bg-warning/10 text-warning border-warning/20"
            }`}>
              {isOperation ? "Em campo" : "Aguardando"}
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {box.technician_name && (
              <span className="flex items-center gap-1 text-xs text-primary font-medium">
                <UserCheck className="h-3 w-3" />
                {box.technician_name}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{box.items_count || 0} itens</span>
            {(box.total_value || 0) > 0 && (
              <span className="text-xs font-semibold text-foreground">
                {formatCurrency(box.total_value || 0)}
              </span>
            )}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatDate(box.created_at)}
            </span>
          </div>
        </div>
        {isOperation && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); setWriteOffBox(box); }}
          >
            <FileText className="h-3.5 w-3.5 mr-1" />
            Baixa
          </Button>
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
            Gerencie as caixas — armazéns virtuais de peças
          </p>
          {(lastSync || productsCount !== null) && (
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              {lastSync && <>Última sync: {new Date(lastSync).toLocaleString("pt-BR")}</>}
              {lastSync && productsCount !== null && <> · </>}
              {productsCount !== null && <>{productsCount.toLocaleString("pt-BR")} produtos no banco</>}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
            {syncing
              ? syncProgress && syncProgress.total > 0
                ? `Sincronizando (${syncProgress.fetched}/${syncProgress.total})`
                : "Buscando produtos..."
              : "Sincronizar Produtos"}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nova Caixa
          </Button>
        </div>
      </div>

      {/* Em Operação */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ArrowUpRight className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            Em Operação ({inOperationBoxes.length})
          </h3>
        </div>
        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        ) : inOperationBoxes.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-6 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma caixa em operação</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Vincule um técnico a uma caixa para colocá-la em operação</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border">
            {inOperationBoxes.map((box) => renderBoxRow(box, "operation"))}
          </div>
        )}
      </div>

      {/* Stand By */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Pause className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            Stand By ({standByBoxes.length})
          </h3>
        </div>
        {!loading && standByBoxes.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-6 text-center">
            <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma caixa em stand by</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Criar caixa
            </Button>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border">
            {standByBoxes.map((box) => renderBoxRow(box, "standby"))}
          </div>
        )}
      </div>

      {/* Box Detail Dialog */}
      <BoxDetailDialog
        box={selectedBox}
        items={boxItems}
        loadingItems={loadingItems}
        onClose={() => setSelectedBox(null)}
        onItemsChanged={() => {
          if (selectedBox) loadBoxItems(selectedBox);
          loadBoxes();
        }}
        onLinkTechnician={(box) => {
          setTechBox(box);
          setSelectedBox(null);
        }}
        onUnlinkTechnician={handleUnlinkTechnician}
        onCheckin={handleOpenCheckin}
      />

      {/* Technician Link Dialog */}
      <TechnicianLinkDialog
        box={techBox}
        onClose={() => setTechBox(null)}
        onLinked={() => {
          loadBoxes();
          setTechBox(null);
        }}
      />

      {/* Check-in Dialog */}
      <CheckinDialog
        box={checkinBox}
        items={checkinItems}
        onClose={() => setCheckinBox(null)}
        onCompleted={() => {
          setCheckinBox(null);
          loadBoxes();
        }}
      />

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova Caixa</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Nome da caixa (ex: Caixa A, Mesa 2...)"
            value={newBoxName}
            onChange={(e) => setNewBoxName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={!newBoxName.trim()}>
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BoxesPage;
