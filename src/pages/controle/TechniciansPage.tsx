import { useState, useEffect } from "react";
import { UserPlus, Search, Trash2, Users, Loader2 } from "lucide-react";
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

const TechniciansPage = () => {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);

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
      const { data, error } = await supabase
        .from("technicians")
        .select("*")
        .order("name");
      if (error) throw error;
      setTechnicians(data || []);
    } catch {
      toast.error("Erro ao carregar técnicos");
    } finally {
      setLoading(false);
    }
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
    // Auto-load all employees on open
    setTimeout(() => searchGCEmployees(), 100);
  };

  const handleAdd = async (emp: GCEmployee) => {
    // Check if already registered
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
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>ID GestãoClick</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {technicians.map((tech) => (
                <TableRow key={tech.id}>
                  <TableCell className="font-medium">{tech.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {tech.gc_id}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleRemove(tech)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Dialog - Search GC Employees */}
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
