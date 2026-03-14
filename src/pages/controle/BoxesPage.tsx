import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Package,
  X,
  CheckCircle2,
  Trash2,
  Clock,
  AlertTriangle,
} from "lucide-react";
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

interface Box {
  id: string;
  name: string;
  status: "active" | "closed" | "cancelled";
  created_at: string;
  closed_at: string | null;
  user_id: string;
  items_count?: number;
}

interface BoxItem {
  id: string;
  box_id: string;
  produto_id: string;
  nome_produto: string;
  quantidade: number;
  added_at: string;
}

const BoxesPage = () => {
  const { user } = useAuth();
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newBoxName, setNewBoxName] = useState("");
  const [selectedBox, setSelectedBox] = useState<Box | null>(null);
  const [boxItems, setBoxItems] = useState<BoxItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

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

      // Get item counts
      if (data && data.length > 0) {
        const { data: counts } = await supabase
          .from("box_items")
          .select("box_id");

        const countMap = new Map<string, number>();
        counts?.forEach((c) => {
          countMap.set(c.box_id, (countMap.get(c.box_id) || 0) + 1);
        });

        setBoxes(
          data.map((b) => ({
            ...b,
            status: b.status as Box["status"],
            items_count: countMap.get(b.id) || 0,
          }))
        );
      } else {
        setBoxes([]);
      }
    } catch (e) {
      toast.error("Erro ao carregar caixas");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newBoxName.trim() || !user) return;
    try {
      const { error } = await supabase.from("boxes").insert({
        name: newBoxName.trim(),
        user_id: user.id,
      });
      if (error) throw error;
      toast.success("Caixa criada!");
      setCreateOpen(false);
      setNewBoxName("");
      loadBoxes();
    } catch (e) {
      toast.error("Erro ao criar caixa");
    }
  };

  const handleCloseBox = async (box: Box) => {
    try {
      const { error } = await supabase
        .from("boxes")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("id", box.id);
      if (error) throw error;
      toast.success(`Caixa "${box.name}" fechada`);
      loadBoxes();
      if (selectedBox?.id === box.id) setSelectedBox(null);
    } catch (e) {
      toast.error("Erro ao fechar caixa");
    }
  };

  const handleCancelBox = async (box: Box) => {
    try {
      const { error } = await supabase
        .from("boxes")
        .update({ status: "cancelled" })
        .eq("id", box.id);
      if (error) throw error;
      toast.success(`Caixa "${box.name}" cancelada`);
      loadBoxes();
      if (selectedBox?.id === box.id) setSelectedBox(null);
    } catch (e) {
      toast.error("Erro ao cancelar caixa");
    }
  };

  const loadBoxItems = async (box: Box) => {
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
    } catch (e) {
      toast.error("Erro ao carregar itens");
    } finally {
      setLoadingItems(false);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    try {
      const { error } = await supabase
        .from("box_items")
        .delete()
        .eq("id", itemId);
      if (error) throw error;
      setBoxItems((prev) => prev.filter((i) => i.id !== itemId));
      toast.success("Item removido");
      loadBoxes();
    } catch (e) {
      toast.error("Erro ao remover item");
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
        <div>
          <p className="text-muted-foreground text-sm">
            Gerencie as caixas de separação e expedição
          </p>
        </div>
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
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setCreateOpen(true)}
            >
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
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-foreground">{box.name}</h3>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(box.created_at)}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={statusConfig[box.status].color}
                  >
                    {statusConfig[box.status].label}
                  </Badge>
                </div>
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
                  <Badge
                    variant="outline"
                    className={statusConfig[box.status].color}
                  >
                    {statusConfig[box.status].label}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Box Items Dialog */}
      <Dialog open={!!selectedBox} onOpenChange={() => setSelectedBox(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {selectedBox?.name}
            </DialogTitle>
          </DialogHeader>
          {loadingItems ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : boxItems.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2" />
              <p className="text-sm">Nenhum item nesta caixa</p>
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
              {boxItems.map((item) => (
                <div key={item.id} className="flex items-center gap-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {item.nome_produto}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ID: {item.produto_id} · Qtd: {item.quantidade}
                    </p>
                  </div>
                  {selectedBox?.status === "active" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleRemoveItem(item.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

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
