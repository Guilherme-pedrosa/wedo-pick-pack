import { useState, useEffect } from "react";
import { Plus, Package, X, CheckCircle2, Clock, UserCheck, RefreshCw } from "lucide-react";
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

const BoxesPage = () => {
  const { user } = useAuth();
  const [boxes, setBoxes] = useState<BoxData[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newBoxName, setNewBoxName] = useState("");

  // Detail dialog state
  const [selectedBox, setSelectedBox] = useState<BoxData | null>(null);
  const [boxItems, setBoxItems] = useState<BoxItemData[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // Technician link dialog
  const [techBox, setTechBox] = useState<BoxData | null>(null);

  // Check-in dialog
  const [checkinBox, setCheckinBox] = useState<BoxData | null>(null);
  const [checkinItems, setCheckinItems] = useState<BoxItemData[]>([]);

  useEffect(() => {
    loadBoxes();
  }, []);

  const loadBoxes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("boxes")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      if (data && data.length > 0) {
        const { data: counts } = await supabase.from("box_items").select("box_id");
        const countMap = new Map<string, number>();
        counts?.forEach((c) => {
          countMap.set(c.box_id, (countMap.get(c.box_id) || 0) + 1);
        });

        setBoxes(
          data.map((b) => ({
            ...b,
            status: b.status as BoxData["status"],
            items_count: countMap.get(b.id) || 0,
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

  const handleCloseBox = async (box: BoxData) => {
    try {
      const { error } = await supabase
        .from("boxes")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("id", box.id);
      if (error) throw error;
      toast.success(`Caixa "${box.name}" fechada`);
      loadBoxes();
      setSelectedBox(null);
    } catch {
      toast.error("Erro ao fechar caixa");
    }
  };

  const handleCancelBox = async (box: BoxData) => {
    try {
      const { error } = await supabase
        .from("boxes")
        .update({ status: "cancelled" })
        .eq("id", box.id);
      if (error) throw error;
      toast.success(`Caixa "${box.name}" cancelada`);
      loadBoxes();
      setSelectedBox(null);
    } catch {
      toast.error("Erro ao cancelar caixa");
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
    // Load items for check-in
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

  const statusConfig = {
    active: { label: "Ativa", color: "bg-success/10 text-success border-success/20" },
    closed: { label: "Fechada", color: "bg-muted text-muted-foreground border-border" },
    cancelled: { label: "Cancelada", color: "bg-destructive/10 text-destructive border-destructive/20" },
  };

  const activeBoxes = boxes.filter((b) => b.status === "active");
  const inactiveBoxes = boxes.filter((b) => b.status !== "active");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          Gerencie as caixas de separação e expedição
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Caixa
        </Button>
      </div>

      {/* Active Boxes */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Caixas Ativas ({activeBoxes.length})
        </h3>
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        ) : activeBoxes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 bg-card rounded-xl border border-border">
            <Package className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma caixa ativa</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Criar primeira caixa
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeBoxes.map((box) => (
              <div
                key={box.id}
                className="bg-card rounded-xl border border-border p-4 hover:border-primary/20 hover:shadow-md transition-all cursor-pointer"
                onClick={() => loadBoxItems(box)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-foreground">{box.name}</h3>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(box.created_at)}
                    </div>
                  </div>
                  <Badge variant="outline" className={statusConfig[box.status].color}>
                    {statusConfig[box.status].label}
                  </Badge>
                </div>
                {box.technician_name && (
                  <div className="flex items-center gap-1 text-xs text-primary mb-2">
                    <UserCheck className="h-3 w-3" />
                    {box.technician_name}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {box.items_count || 0} itens
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseBox(box);
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      Fechar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancelBox(box);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inactive Boxes */}
      {inactiveBoxes.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Histórico ({inactiveBoxes.length})
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {inactiveBoxes.slice(0, 6).map((box) => (
              <div
                key={box.id}
                className="bg-card rounded-xl border border-border p-4 opacity-60 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => loadBoxItems(box)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium text-foreground text-sm">{box.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(box.created_at)}
                    </p>
                  </div>
                  <Badge variant="outline" className={statusConfig[box.status].color}>
                    {statusConfig[box.status].label}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
        onCloseBox={handleCloseBox}
        onCancelBox={handleCancelBox}
        onLinkTechnician={(box) => {
          setTechBox(box);
          setSelectedBox(null);
        }}
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
