import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ClipboardList, ArrowLeft, LogOut, LogIn, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

interface MovementLog {
  id: string;
  type: "saida" | "entrada";
  box_name: string;
  technician_name: string;
  technician_gc_id: string;
  operator_name: string;
  items_count: number;
  total_value: number;
  status?: string;
  occurred_at: string;
}

export default function HandoffLogsPage() {
  const [logs, setLogs] = useState<MovementLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "saida" | "entrada">("all");
  const navigate = useNavigate();

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);

    // Fetch exits (handoff logs)
    const handoffPromise = supabase
      .from("box_handoff_logs")
      .select("*")
      .order("handed_at", { ascending: false })
      .limit(500);

    // Fetch entries (check-in records with box info)
    const checkinPromise = supabase
      .from("box_checkin_records")
      .select("id, box_id, operator_name, status, created_at, completed_at, notes")
      .order("created_at", { ascending: false })
      .limit(500);

    const [handoffRes, checkinRes] = await Promise.all([handoffPromise, checkinPromise]);

    const movements: MovementLog[] = [];

    // Map handoffs → saida
    if (handoffRes.data) {
      for (const h of handoffRes.data) {
        movements.push({
          id: h.id,
          type: "saida",
          box_name: h.box_name,
          technician_name: h.technician_name,
          technician_gc_id: h.technician_gc_id,
          operator_name: h.operator_name,
          items_count: h.items_count,
          total_value: Number(h.total_value) || 0,
          occurred_at: h.handed_at,
        });
      }
    }

    // Map check-ins → entrada — need to get box info
    if (checkinRes.data && checkinRes.data.length > 0) {
      const boxIds = [...new Set(checkinRes.data.map((c) => c.box_id))];
      const { data: boxes } = await supabase
        .from("boxes")
        .select("id, name, technician_name, technician_gc_id")
        .in("id", boxIds);

      const boxMap = new Map(boxes?.map((b) => [b.id, b]) || []);

      // Get item counts per checkin
      const checkinIds = checkinRes.data.map((c) => c.id);
      const { data: checkinItems } = await supabase
        .from("box_checkin_items")
        .select("checkin_id, quantidade_esperada")
        .in("checkin_id", checkinIds);

      const itemCountMap = new Map<string, number>();
      checkinItems?.forEach((ci) => {
        itemCountMap.set(ci.checkin_id, (itemCountMap.get(ci.checkin_id) || 0) + ci.quantidade_esperada);
      });

      for (const c of checkinRes.data) {
        const box = boxMap.get(c.box_id);
        movements.push({
          id: c.id,
          type: "entrada",
          box_name: box?.name || "—",
          technician_name: box?.technician_name || "—",
          technician_gc_id: box?.technician_gc_id || "—",
          operator_name: c.operator_name || "—",
          items_count: itemCountMap.get(c.id) || 0,
          total_value: 0,
          status: c.status,
          occurred_at: c.completed_at || c.created_at,
        });
      }
    }

    // Sort by date desc
    movements.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());

    setLogs(movements);
    setLoading(false);
  };

  const formatDate = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const filtered = filter === "all" ? logs : logs.filter((l) => l.type === filter);

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
              Histórico completo de entradas e saídas de caixas
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
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={filter === "all" ? "default" : "outline"}
          onClick={() => setFilter("all")}
        >
          Todas
        </Button>
        <Button
          size="sm"
          variant={filter === "saida" ? "default" : "outline"}
          onClick={() => setFilter("saida")}
          className="gap-1.5"
        >
          <LogOut className="h-3.5 w-3.5" />
          Saídas
        </Button>
        <Button
          size="sm"
          variant={filter === "entrada" ? "default" : "outline"}
          onClick={() => setFilter("entrada")}
          className="gap-1.5"
        >
          <LogIn className="h-3.5 w-3.5" />
          Entradas
        </Button>
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
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Data/Hora</TableHead>
                <TableHead>Caixa</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead>ID Func.</TableHead>
                <TableHead>Operador</TableHead>
                <TableHead className="text-center">Itens</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((log) => (
                <TableRow key={`${log.type}-${log.id}`}>
                  <TableCell>
                    {log.type === "saida" ? (
                      <Badge variant="destructive" className="gap-1 text-xs whitespace-nowrap">
                        <LogOut className="h-3 w-3" />
                        Saída
                      </Badge>
                    ) : (
                      <Badge className="gap-1 text-xs whitespace-nowrap bg-emerald-600 hover:bg-emerald-700">
                        <LogIn className="h-3 w-3" />
                        Entrada
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {formatDate(log.occurred_at)}
                  </TableCell>
                  <TableCell className="font-medium">{log.box_name}</TableCell>
                  <TableCell>{log.technician_name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs font-mono">
                      {log.technician_gc_id}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{log.operator_name}</TableCell>
                  <TableCell className="text-center">{log.items_count}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {log.total_value > 0 ? formatCurrency(log.total_value) : "—"}
                  </TableCell>
                  <TableCell>
                    {log.type === "saida" ? (
                      <Badge variant="outline" className="text-xs">Entregue</Badge>
                    ) : log.status === "completed" ? (
                      <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">Concluído</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Em andamento</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
