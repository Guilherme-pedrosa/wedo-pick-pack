import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ClipboardList, ArrowLeft } from "lucide-react";
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

interface HandoffLog {
  id: string;
  box_name: string;
  technician_name: string;
  technician_gc_id: string;
  operator_name: string;
  items_count: number;
  total_value: number;
  handed_at: string;
}

export default function HandoffLogsPage() {
  const [logs, setLogs] = useState<HandoffLog[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("box_handoff_logs")
      .select("*")
      .order("handed_at", { ascending: false })
      .limit(200);

    if (!error && data) {
      setLogs(data as HandoffLog[]);
    }
    setLoading(false);
  };

  const formatDate = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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
              Log de Saídas
            </h1>
            <p className="text-sm text-muted-foreground">
              Histórico completo de entregas de caixas a técnicos
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="text-xs">
          {logs.length} registro{logs.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          Nenhuma saída registrada ainda.
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data/Hora</TableHead>
                <TableHead>Caixa</TableHead>
                <TableHead>Técnico (Recebeu)</TableHead>
                <TableHead>ID Func.</TableHead>
                <TableHead>Entregue por</TableHead>
                <TableHead className="text-center">Itens</TableHead>
                <TableHead className="text-right">Valor Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {formatDate(log.handed_at)}
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
