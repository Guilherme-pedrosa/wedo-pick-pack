import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, ClipboardList, ArrowLeft, LogOut, LogIn,
  RefreshCw, PackagePlus, PackageMinus, FileText, UserX, Search,
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
  box_name: string;
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
  saida: { label: "Saída", icon: LogOut, color: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800" },
  entrada: { label: "Entrada", icon: LogIn, color: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800" },
  baixa: { label: "Baixa", icon: FileText, color: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800" },
  adicao: { label: "Adição", icon: PackagePlus, color: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800" },
  remocao: { label: "Remoção", icon: PackageMinus, color: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800" },
  desvincular: { label: "Desvincular", icon: UserX, color: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400 dark:border-gray-800" },
};

type FilterType = "all" | "saida" | "entrada" | "baixa" | "adicao" | "remocao";

export default function HandoffLogsPage() {
  const [logs, setLogs] = useState<MovementLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchText, setSearchText] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("box_movement_logs")
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

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const filtered = logs.filter((l) => {
    if (filter !== "all" && l.action !== filter) return false;
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      return (
        l.box_name?.toLowerCase().includes(q) ||
        l.produto_nome?.toLowerCase().includes(q) ||
        l.technician_name?.toLowerCase().includes(q) ||
        l.operator_name?.toLowerCase().includes(q) ||
        l.details?.toLowerCase().includes(q) ||
        l.ref_numero?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: "Todas" },
    { key: "saida", label: "Saídas" },
    { key: "entrada", label: "Entradas" },
    { key: "baixa", label: "Baixas" },
    { key: "adicao", label: "Adições" },
    { key: "remocao", label: "Remoções" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/controle/caixas")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-primary" />
              Movimentações
            </h1>
            <p className="text-sm text-muted-foreground">
              Histórico completo de todas as ações nas caixas
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

      {/* Search + Filters */}
      <div className="space-y-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar caixa, produto, técnico, operador..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9"
          />
        </div>
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
                <TableHead>Caixa</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="text-center">Qtd</TableHead>
                <TableHead>Ref.</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead>Operador</TableHead>
                <TableHead>Detalhes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((log) => {
                const config = ACTION_CONFIG[log.action] || ACTION_CONFIG.saida;
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
                    <TableCell className="font-medium whitespace-nowrap">{log.box_name}</TableCell>
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
                      {log.ref_numero ? (
                        <Badge variant="outline" className="text-xs font-mono">
                          {log.ref_tipo?.toUpperCase()} #{log.ref_numero}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
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
