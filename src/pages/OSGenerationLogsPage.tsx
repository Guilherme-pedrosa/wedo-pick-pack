import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FileText,
  RefreshCw,
} from "lucide-react";

interface OSLog {
  id: string;
  created_at: string;
  orcamento_codigo: string;
  orcamento_id: string;
  nome_cliente: string;
  os_id: string | null;
  os_codigo: string | null;
  auvo_task_id: string | null;
  operator_name: string;
  valor_total: number | null;
  equipamento: string | null;
  warnings: string[] | null;
  error_message: string | null;
  success: boolean;
}

export default function OSGenerationLogsPage() {
  const [search, setSearch] = useState("");

  const { data: logs, isLoading, refetch } = useQuery({
    queryKey: ["os-generation-logs"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("os_generation_logs") as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as OSLog[];
    },
  });

  const filtered = (logs || []).filter((l) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      l.orcamento_codigo.toLowerCase().includes(term) ||
      l.nome_cliente.toLowerCase().includes(term) ||
      (l.os_codigo || "").toLowerCase().includes(term) ||
      (l.auvo_task_id || "").toLowerCase().includes(term) ||
      l.operator_name.toLowerCase().includes(term)
    );
  });

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return d;
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] bg-background">
      <div className="bg-card border-b border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">Log de OS Geradas</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Histórico de OS e tarefas Auvo geradas pelo Rastreador.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por código, cliente, operador..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm pl-8"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <FileText className="h-10 w-10 opacity-30" />
            <p className="text-sm">Nenhum registro encontrado</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-3xl mx-auto">
            {filtered.map((log) => (
              <Card
                key={log.id}
                className={`p-3 border-l-4 ${
                  log.success ? "border-l-green-500" : "border-l-destructive"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    {log.success ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">
                          ORC #{log.orcamento_codigo}
                        </span>
                        {log.os_codigo && (
                          <Badge variant="default" className="text-[10px] px-1.5 bg-green-600">
                            OS #{log.os_codigo}
                          </Badge>
                        )}
                        {log.auvo_task_id && (
                          <Badge variant="secondary" className="text-[10px] px-1.5">
                            Auvo #{log.auvo_task_id}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {log.nome_cliente}
                      </p>
                      {log.equipamento && (
                        <p className="text-xs text-muted-foreground truncate">
                          🔧 {log.equipamento}
                        </p>
                      )}
                      {log.error_message && (
                        <p className="text-xs text-destructive mt-1">
                          ❌ {log.error_message}
                        </p>
                      )}
                      {log.warnings && log.warnings.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {log.warnings.map((w, i) => (
                            <p key={i} className="text-[10px] text-amber-600">
                              ⚠️ {w}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">{formatDate(log.created_at)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{log.operator_name}</p>
                    {log.valor_total != null && Number(log.valor_total) > 0 && (
                      <p className="text-xs font-medium text-foreground mt-0.5">
                        {Number(log.valor_total).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
