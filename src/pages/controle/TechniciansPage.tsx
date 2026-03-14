import { useState, useEffect } from "react";
import { UserPlus, Search, Trash2, Users, Loader2, Package, ChevronDown, ChevronRight, Wrench, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface GCEmployee {
  id: string;
  nome: string;
}

interface Technician {
  id: string;
  gc_id: string;
  name: string;
  active: boolean;
  created_at: string;
}

interface BoxWithItems {
  id: string;
  name: string;
  status: string;
  created_at: string;
  items: { id: string; nome_produto: string; quantidade: number; preco_unitario: number | null }[];
}

interface ToolboxWithItems {
  id: string;
  name: string;
  status: string;
  created_at: string;
  items: { id: string; nome_produto: string; quantidade: number; preco_unitario: number | null }[];
}

interface TechnicianWithBoxes extends Technician {
  boxes: BoxWithItems[];
  toolboxes: ToolboxWithItems[];
  totalItems: number;
  totalValue: number;
  toolboxTotalItems: number;
  toolboxTotalValue: number;
}

const TechniciansPage = () => {
  const [technicians, setTechnicians] = useState<TechnicianWithBoxes[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTech, setExpandedTech] = useState<Set<string>>(new Set());

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [gcEmployees, setGcEmployees] = useState<GCEmployee[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    loadTechnicians();
  }, []);

  const loadTechnicians = async () => {
    setLoading(true);
    try {
      const { data: techs, error } = await supabase
        .from("technicians")
        .select("*")
        .order("name");
      if (error) throw error;

      // Load active boxes with items for each technician
      const gcIds = (techs || []).map((t) => t.gc_id);
      const { data: boxes } = await supabase
        .from("boxes")
        .select("id, name, status, created_at, technician_gc_id")
        .in("technician_gc_id", gcIds)
        .eq("status", "active");

      const boxIds = (boxes || []).map((b) => b.id);
      const { data: items } = boxIds.length > 0
        ? await supabase
            .from("box_items")
            .select("id, box_id, nome_produto, quantidade, preco_unitario")
            .in("box_id", boxIds)
        : { data: [] };

      // Group items by box
      const itemsByBox = new Map<string, typeof items>();
      for (const item of items || []) {
        if (!itemsByBox.has(item.box_id)) itemsByBox.set(item.box_id, []);
        itemsByBox.get(item.box_id)!.push(item);
      }

      // Group boxes by technician gc_id
      const boxesByTech = new Map<string, BoxWithItems[]>();
      for (const box of boxes || []) {
        const gcId = box.technician_gc_id!;
        if (!boxesByTech.has(gcId)) boxesByTech.set(gcId, []);
        const boxItems = itemsByBox.get(box.id) || [];
        boxesByTech.get(gcId)!.push({
          ...box,
          items: boxItems.map((i) => ({
            id: i.id,
            nome_produto: i.nome_produto,
            quantidade: i.quantidade,
            preco_unitario: i.preco_unitario,
          })),
        });
      }

      const result: TechnicianWithBoxes[] = (techs || []).map((t) => {
        const techBoxes = boxesByTech.get(t.gc_id) || [];
        const totalItems = techBoxes.reduce((sum, b) => sum + b.items.reduce((s, i) => s + i.quantidade, 0), 0);
        const totalValue = techBoxes.reduce(
          (sum, b) => sum + b.items.reduce((s, i) => s + i.quantidade * (i.preco_unitario || 0), 0),
          0
        );
        return { ...t, boxes: techBoxes, totalItems, totalValue };
      });

      setTechnicians(result);
    } catch {
      toast.error("Erro ao carregar técnicos");
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedTech((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const searchGCEmployees = async () => {
    setSearching(true);
    try {
      const body: Record<string, unknown> = {
        path: "/api/funcionarios",
        method: "GET",
      };
      if (searchTerm.trim()) {
        body.path = `/api/funcionarios?nome=${encodeURIComponent(searchTerm.trim())}`;
      }
      const { data, error } = await supabase.functions.invoke("gc-proxy", {
        body,
      });
      if (error) throw error;
      const employees: GCEmployee[] = data?.data || [];
      setGcEmployees(employees);
    } catch (e) {
      console.error(e);
      toast.error("Erro ao buscar funcionários");
    } finally {
      setSearching(false);
    }
  };

  const handleOpenAdd = () => {
    setAddOpen(true);
    setSearchTerm("");
    setGcEmployees([]);
    setTimeout(() => searchGCEmployees(), 100);
  };

  const handleAdd = async (emp: GCEmployee) => {
    if (technicians.some((t) => t.gc_id === emp.id)) {
      toast.info(`"${emp.nome}" já está cadastrado`);
      return;
    }
    setAdding(emp.id);
    try {
      const { error } = await supabase
        .from("technicians")
        .insert({ gc_id: emp.id, name: emp.nome });
      if (error) throw error;
      toast.success(`"${emp.nome}" cadastrado como técnico`);
      loadTechnicians();
    } catch {
      toast.error("Erro ao cadastrar técnico");
    } finally {
      setAdding(null);
    }
  };

  const handleRemove = async (tech: Technician) => {
    try {
      const { error } = await supabase
        .from("technicians")
        .delete()
        .eq("id", tech.id);
      if (error) throw error;
      toast.success(`"${tech.name}" removido`);
      loadTechnicians();
    } catch {
      toast.error("Erro ao remover técnico");
    }
  };

  const registeredIds = new Set(technicians.map((t) => t.gc_id));

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          Cadastre os técnicos que utilizam as caixas de ferramentas
        </p>
        <Button onClick={handleOpenAdd}>
          <UserPlus className="h-4 w-4 mr-2" />
          Cadastrar Técnico
        </Button>
      </div>

      {/* Technicians list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : technicians.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 bg-card rounded-xl border border-border">
          <Users className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum técnico cadastrado</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={handleOpenAdd}>
            <UserPlus className="h-4 w-4 mr-1" />
            Cadastrar primeiro técnico
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {technicians.map((tech) => {
            const isExpanded = expandedTech.has(tech.id);
            const hasBoxes = tech.boxes.length > 0;

            return (
              <div
                key={tech.id}
                className="bg-card rounded-xl border border-border overflow-hidden"
              >
                <div
                  className={`flex items-center gap-3 p-4 ${hasBoxes ? "cursor-pointer hover:bg-accent/30 transition-colors" : ""}`}
                  onClick={() => hasBoxes && toggleExpand(tech.id)}
                >
                  {hasBoxes ? (
                    isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    )
                  ) : (
                    <div className="w-4" />
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{tech.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      GC: {tech.gc_id}
                    </p>
                  </div>

                  {hasBoxes ? (
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">
                          {tech.boxes.length} caixa{tech.boxes.length > 1 ? "s" : ""} · {tech.totalItems} ite{tech.totalItems === 1 ? "m" : "ns"}
                        </p>
                        {tech.totalValue > 0 && (
                          <p className="text-xs font-medium text-foreground">
                            {formatCurrency(tech.totalValue)}
                          </p>
                        )}
                      </div>
                      <Badge variant="default" className="text-xs">
                        <Package className="h-3 w-3 mr-1" />
                        Em operação
                      </Badge>
                    </div>
                  ) : (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      Sem caixas
                    </Badge>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(tech);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {hasBoxes && isExpanded && (
                  <div className="border-t border-border bg-muted/30 px-4 pb-4 pt-2 space-y-3">
                    {tech.boxes.map((box) => {
                      const boxTotal = box.items.reduce(
                        (s, i) => s + i.quantidade * (i.preco_unitario || 0),
                        0
                      );
                      return (
                        <div key={box.id} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-foreground">
                              📦 {box.name}
                            </p>
                            {boxTotal > 0 && (
                              <span className="text-xs text-muted-foreground">
                                Total: {formatCurrency(boxTotal)}
                              </span>
                            )}
                          </div>
                          <div className="rounded-lg border border-border overflow-hidden">
                            <Table>
                              <TableHeader>
                                <TableRow className="text-xs">
                                  <TableHead className="py-1.5 text-xs">Produto</TableHead>
                                  <TableHead className="py-1.5 text-xs text-center w-16">Qtd</TableHead>
                                  <TableHead className="py-1.5 text-xs text-right w-24">Valor</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {box.items.map((item) => (
                                  <TableRow key={item.id} className="text-xs">
                                    <TableCell className="py-1.5 text-xs">
                                      {item.nome_produto}
                                    </TableCell>
                                    <TableCell className="py-1.5 text-xs text-center">
                                      {item.quantidade}
                                    </TableCell>
                                    <TableCell className="py-1.5 text-xs text-right">
                                      {item.preco_unitario
                                        ? formatCurrency(item.quantidade * item.preco_unitario)
                                        : "—"}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Cadastrar Técnico
            </DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              placeholder="Buscar funcionário no GestãoClick..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchGCEmployees()}
              autoFocus
            />
            <Button
              variant="outline"
              size="icon"
              onClick={searchGCEmployees}
              disabled={searching}
            >
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
            {gcEmployees.length === 0 && !searching && (
              <p className="text-sm text-muted-foreground text-center py-6">
                Pesquise para encontrar funcionários
              </p>
            )}
            {searching && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {gcEmployees.map((emp) => {
              const alreadyRegistered = registeredIds.has(emp.id);
              return (
                <div
                  key={emp.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium">{emp.nome}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      ID: {emp.id}
                    </p>
                  </div>
                  {alreadyRegistered ? (
                    <Badge variant="secondary" className="text-xs">
                      Cadastrado
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAdd(emp)}
                      disabled={adding === emp.id}
                    >
                      {adding === emp.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <UserPlus className="h-3.5 w-3.5 mr-1" />
                          Cadastrar
                        </>
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TechniciansPage;
