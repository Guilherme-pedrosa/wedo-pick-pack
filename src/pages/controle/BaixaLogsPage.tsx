import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, FileText, ArrowLeft, RefreshCw, Search,
  Download, Calendar, Clock, User, Filter,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate } from "react-router-dom";

interface BaixaLog {
  id: string;
  box_name: string;
  produto_id: string | null;
  produto_nome: string | null;
  quantidade: number | null;
  preco_unitario: number | null;
  ref_tipo: string | null;
  ref_numero: string | null;
  technician_name: string | null;
  operator_name: string;
  details: string | null;
  created_at: string;
}

export default function BaixaLogsPage() {
  const [logs, setLogs] = useState<BaixaLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [refFilter, setRefFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("box_movement_logs")
      .select("*")
      .eq("action", "baixa")
      .order("created_at", { ascending: false })
      .limit(500);

    if (fromDate) query = query.gte("created_at", new Date(fromDate).toISOString());
    if (toDate) {
      const next = new Date(toDate);
      next.setDate(next.getDate() + 1);
      query = query.lt("created_at", next.toISOString());
    }

    const { data } = await query;
    setLogs((data as BaixaLog[]) || []);
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let list = logs;
    if (refFilter !== "all") list = list.filter((l) => l.ref_tipo === refFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((l) =>
        l.box_name?.toLowerCase().includes(s) ||
        l.produto_nome?.toLowerCase().includes(s) ||
        l.technician_name?.toLowerCase().includes(s) ||
        l.operator_name?.toLowerCase().includes(s) ||
        l.ref_numero?.toLowerCase().includes(s) ||
        l.details?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [logs, refFilter, search]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const totalValue = useMemo(() =>
    filtered.reduce((s, l) => s + (l.quantidade || 0) * (l.preco_unitario || 0), 0),
    [filtered]
  );

  const exportCSV = () => {
    const header = ["Data/Hora", "Caixa", "Produto", "Cod. Produto", "Qtd", "Valor Unit.", "Subtotal", "Tipo", "Ref.", "Técnico", "Operador", "Detalhes"];
    const rows = filtered.map((l) => [
      fmt(l.created_at),
      l.box_name,
      l.produto_nome || "",
      l.produto_id || "",
      l.quantidade?.toString() || "",
      l.preco_unitario?.toString() || "",
      ((l.quantidade || 0) * (l.preco_unitario || 0)).toFixed(2),
      (l.ref_tipo || "").toUpperCase(),
      l.ref_numero || "",
      l.technician_name || "",
      l.operator_name,
      l.details || "",
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `baixas_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    const rows = filtered.map((l, idx) => `
      <tr style="background:${idx % 2 === 0 ? 'white' : '#fafafa'}">
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${fmt(l.created_at)}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${l.box_name}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${l.produto_nome || "—"}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;text-align:center;">${l.quantidade || "—"}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;text-align:right;">${l.preco_unitario ? formatCurrency(l.preco_unitario) : "—"}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">
          <span style="background:${l.ref_tipo === 'os' ? '#dbeafe' : '#fef3c7'};padding:2px 6px;border-radius:4px;font-size:10px;">
            ${(l.ref_tipo || "").toUpperCase()} #${l.ref_numero || "—"}
          </span>
        </td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${l.technician_name || "—"}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${l.operator_name}</td>
      </tr>
    `).join("");

    win.document.write(`
      <html><head><title>Baixas</title><style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        p { font-size: 12px; color: #666; margin-bottom: 16px; }
        table { border-collapse: collapse; width: 100%; }
        th { background: #f3f4f6; padding: 6px 8px; border: 1px solid #ddd; font-size: 11px; text-align: left; }
        th:nth-child(4) { text-align: center; }
        th:nth-child(5) { text-align: right; }
        .totals { margin-top: 12px; text-align: right; font-size: 13px; font-weight: 700; }
        @media print { body { padding: 0; } }
      </style></head><body>
        <h1>Relatório de Baixas</h1>
        <p>Gerado em ${new Date().toLocaleString("pt-BR")} — ${filtered.length} registro(s)</p>
        <table>
          <thead><tr>
            <th>Data/Hora</th><th>Caixa</th><th>Produto</th><th>Qtd</th><th>Valor</th><th>Documento</th><th>Técnico</th><th>Operador</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="totals">Valor total: ${formatCurrency(totalValue)}</div>
      </body></html>
    `);
    win.document.close();
    setTimeout(() => win.print(), 300);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
      <div className="shrink-0 p-4 pb-2 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/controle/caixas")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Log de Baixas
            </h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchData}>
              <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
            </Button>
            <Button variant="outline" size="sm" onClick={exportPDF}>
              <FileText className="h-4 w-4 mr-1" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4 mr-1" /> Excel
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar caixa, produto, técnico, operador, ref..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Select value={refFilter} onValueChange={setRefFilter}>
            <SelectTrigger className="w-[130px] h-9">
              <Filter className="h-3.5 w-3.5 mr-1" />
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="os">OS</SelectItem>
              <SelectItem value="venda">Venda</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 w-[130px]" />
            <span className="text-xs text-muted-foreground">a</span>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 w-[130px]" />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{filtered.length} registro(s)</span>
          {totalValue > 0 && <span className="font-semibold text-foreground">Total: {formatCurrency(totalValue)}</span>}
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">Nenhuma baixa encontrada</div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((log) => {
              const subtotal = (log.quantidade || 0) * (log.preco_unitario || 0);
              return (
                <Card key={log.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center shrink-0 text-xs text-muted-foreground w-[70px]">
                      <Clock className="h-3.5 w-3.5 mb-0.5" />
                      <span>{new Date(log.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                      <span>{new Date(log.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px] font-semibold">
                          {log.box_name}
                        </Badge>
                        {log.ref_numero && (
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${
                              log.ref_tipo === "os"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                            }`}
                          >
                            {(log.ref_tipo || "").toUpperCase()} #{log.ref_numero}
                          </Badge>
                        )}
                        {log.quantidade && (
                          <Badge variant="secondary" className="text-[10px]">
                            {log.quantidade}x
                          </Badge>
                        )}
                        {subtotal > 0 && (
                          <span className="text-[10px] font-medium text-muted-foreground">{formatCurrency(subtotal)}</span>
                        )}
                      </div>
                      {log.produto_nome && (
                        <div className="text-sm">
                          <span className="font-medium">{log.produto_nome}</span>
                          {log.produto_id && (
                            <span className="text-[10px] text-muted-foreground font-mono ml-2">{log.produto_id}</span>
                          )}
                        </div>
                      )}
                      {log.details && (
                        <div className="text-[11px] text-muted-foreground bg-muted/50 rounded px-2 py-1">{log.details}</div>
                      )}
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        {log.technician_name && <span>Técnico: {log.technician_name}</span>}
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" /> {log.operator_name}
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
