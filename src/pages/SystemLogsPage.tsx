import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, RefreshCw, Download, User, Clock, Filter } from "lucide-react";

interface LogEntry {
  id: string;
  created_at: string;
  user_id: string;
  user_name: string;
  module: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  details: Record<string, unknown> | null;
}

const MODULE_LABELS: Record<string, string> = {
  auth: "Autenticação",
  checkout: "Checkout",
  separations: "Separações",
  compras: "Compras",
  rastreador: "Rastreador",
  controle_caixas: "Caixas",
  controle_maletas: "Maletas",
  controle_tecnicos: "Técnicos",
  config: "Configurações",
  admin: "Admin",
};

const MODULE_COLORS: Record<string, string> = {
  auth: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  checkout: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  separations: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  compras: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  rastreador: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  controle_caixas: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  controle_maletas: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  controle_tecnicos: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  config: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  admin: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function SystemLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 100;

  const fetchLogs = useCallback(async (reset = false) => {
    setLoading(true);
    const currentPage = reset ? 0 : page;
    if (reset) setPage(0);

    let query = (supabase.from("system_logs" as any) as any)
      .select("*")
      .order("created_at", { ascending: false })
      .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

    if (moduleFilter !== "all") {
      query = query.eq("module", moduleFilter);
    }
    if (userFilter !== "all") {
      query = query.eq("user_id", userFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Error fetching logs:", error);
      setLoading(false);
      return;
    }

    const entries = (data || []) as LogEntry[];
    setHasMore(entries.length === PAGE_SIZE);

    if (reset || currentPage === 0) {
      setLogs(entries);
    } else {
      setLogs(prev => [...prev, ...entries]);
    }
    setLoading(false);
  }, [page, moduleFilter, userFilter]);

  const fetchUsers = async () => {
    const { data } = await (supabase.from("system_logs" as any) as any)
      .select("user_id, user_name")
      .order("user_name");
    if (data) {
      const unique = new Map<string, string>();
      for (const d of data as any[]) {
        if (!unique.has(d.user_id)) unique.set(d.user_id, d.user_name);
      }
      setUsers(Array.from(unique.entries()).map(([id, name]) => ({ id, name })));
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchLogs(true);
  }, [moduleFilter, userFilter]);

  const filteredLogs = search.trim()
    ? logs.filter(l => {
        const s = search.toLowerCase();
        return (
          l.user_name.toLowerCase().includes(s) ||
          l.action.toLowerCase().includes(s) ||
          l.module.toLowerCase().includes(s) ||
          (l.entity_name || "").toLowerCase().includes(s) ||
          (l.entity_id || "").toLowerCase().includes(s)
        );
      })
    : logs;

  const exportCSV = () => {
    const header = ["Data/Hora", "Usuário", "Módulo", "Ação", "Tipo Entidade", "Entidade", "ID Entidade", "Detalhes"];
    const rows = filteredLogs.map(l => [
      new Date(l.created_at).toLocaleString("pt-BR"),
      l.user_name,
      MODULE_LABELS[l.module] || l.module,
      l.action,
      l.entity_type || "",
      l.entity_name || "",
      l.entity_id || "",
      l.details ? JSON.stringify(l.details) : "",
    ]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs_sistema_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Header */}
      <div className="shrink-0 p-4 pb-2 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">Logs do Sistema</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fetchLogs(true)}>
              <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por usuário, ação, entidade..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-[160px] h-9">
              <Filter className="h-3.5 w-3.5 mr-1" />
              <SelectValue placeholder="Módulo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos módulos</SelectItem>
              {Object.entries(MODULE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={userFilter} onValueChange={setUserFilter}>
            <SelectTrigger className="w-[180px] h-9">
              <User className="h-3.5 w-3.5 mr-1" />
              <SelectValue placeholder="Usuário" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos usuários</SelectItem>
              {users.map(u => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="text-xs text-muted-foreground">
          {filteredLogs.length} registro(s)
        </div>
      </div>

      {/* Logs list */}
      <ScrollArea className="flex-1 px-4 pb-4">
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            Nenhum log encontrado
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredLogs.map(log => (
              <Card key={log.id} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center shrink-0 text-xs text-muted-foreground w-[70px]">
                    <Clock className="h-3.5 w-3.5 mb-0.5" />
                    <span>{new Date(log.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                    <span>{new Date(log.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className={`text-[10px] ${MODULE_COLORS[log.module] || ""}`}>
                        {MODULE_LABELS[log.module] || log.module}
                      </Badge>
                      <span className="text-sm font-medium text-foreground">{log.action}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <User className="h-3 w-3" />
                      <span>{log.user_name}</span>
                      {log.entity_name && (
                        <>
                          <span>•</span>
                          <span className="truncate">{log.entity_type}: <strong>{log.entity_name}</strong></span>
                        </>
                      )}
                      {log.entity_id && !log.entity_name && (
                        <>
                          <span>•</span>
                          <span className="truncate font-mono text-[10px]">{log.entity_id}</span>
                        </>
                      )}
                    </div>
                    {log.details && Object.keys(log.details).length > 0 && (
                      <div className="text-[11px] text-muted-foreground bg-muted/50 rounded px-2 py-1 font-mono break-all">
                        {Object.entries(log.details).map(([k, v]) => (
                          <span key={k} className="mr-3">{k}: {String(v)}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}

            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() => {
                    setPage(p => p + 1);
                    fetchLogs(false);
                  }}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Carregar mais
                </Button>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
