import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, ClipboardList, ArrowLeft, LogOut, LogIn,
  RefreshCw, PackagePlus, PackageMinus, FileText, UserX,
  UserCheck, Briefcase, Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

interface MovementLog {
  id: string;
  action: string;
  toolbox_name: string;
  produto_id: string | null;
  produto_nome: string | null;
  quantidade: number | null;
  preco_unitario: number | null;
  ref_tipo: string | null;
  ref_numero: string | null;
  technician_name: string | null;
  technician_gc_id: string | null;
  operator_name: string;
  details: string | null;
  created_at: string;
}

const ACTION_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  saida_estoque: { label: "Baixa Estoque", icon: LogOut, color: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800" },
  estorno_estoque: { label: "Estorno Estoque", icon: LogIn, color: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800" },
  vinculacao: { label: "Vinculação", icon: UserCheck, color: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800" },
  desvinculacao: { label: "Desvinculação", icon: UserX, color: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400 dark:border-gray-800" },
  adicao: { label: "Adição", icon: PackagePlus, color: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800" },
  remocao: { label: "Remoção", icon: PackageMinus, color: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800" },
  conferencia: { label: "Conferência", icon: FileText, color: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800" },
};

type FilterType = "all" | "saida_estoque" | "estorno_estoque" | "vinculacao" | "desvinculacao" | "adicao" | "remocao" | "conferencia";

export default function ToolboxLogsPage() {
  const [logs, setLogs] = useState<MovementLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const navigate = useNavigate();

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("toolbox_movement_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (!error && data) {
      setLogs(data as MovementLog[]);
    }
    setLoading(false);
  };

  const formatDate = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const filtered = filter === "all" ? logs : logs.filter((l) => l.action === filter);

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: "Todas" },
    { key: "vinculacao", label: "Vinculações" },
    { key: "desvinculacao", label: "Desvinculações" },
    { key: "saida_estoque", label: "Baixas Estoque" },
    { key: "estorno_estoque", label: "Estornos" },
    { key: "adicao", label: "Adições" },
    { key: "remocao", label: "Remoções" },
    { key: "conferencia", label: "Conferências" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/controle/maletas")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Briefcase className="h-6 w-6 text-primary" />
              Movimentações — Maletas
            </h1>
            <p className="text-sm text-muted-foreground">
              Histórico completo de todas as ações nas maletas
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={loadLogs} title="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Badge variant="secondary" className="text-xs">
            {filtered.length} registro{filtered.length !== 1 ? "s" : ""}
          </Badge>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {filters.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          Nenhuma movimentação registrada ainda.
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Data/Hora</TableHead>
                <TableHead>Maleta</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="text-center">Qtd</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead>Operador</TableHead>
                <TableHead>Detalhes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((log) => {
                const config = ACTION_CONFIG[log.action] || { label: log.action, icon: FileText, color: "bg-muted text-muted-foreground" };
                const Icon = config.icon;
                return (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Badge variant="outline" className={`gap-1 text-xs whitespace-nowrap ${config.color}`}>
                        <Icon className="h-3 w-3" />
                        {config.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">{log.toolbox_name}</TableCell>
                    <TableCell>
                      {log.produto_nome ? (
                        <div>
                          <p className="text-sm truncate max-w-[200px]">{log.produto_nome}</p>
                          {log.produto_id && (
                            <p className="text-[10px] text-muted-foreground font-mono">{log.produto_id}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {log.quantidade ?? "—"}
                    </TableCell>
                    <TableCell>
                      {log.technician_name ? (
                        <div>
                          <p className="text-sm">{log.technician_name}</p>
                          {log.technician_gc_id && (
                            <p className="text-[10px] text-muted-foreground font-mono">{log.technician_gc_id}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {log.operator_name}
                    </TableCell>
                    <TableCell>
                      {log.details ? (
                        <p className="text-xs text-muted-foreground max-w-[250px] truncate" title={log.details}>
                          {log.details}
                        </p>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
