import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, ClipboardCheck, ArrowLeft, RefreshCw, Search,
  Download, FileText, Calendar, Clock, User, Eye, Printer, Filter,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useNavigate } from "react-router-dom";

interface CheckinRecord {
  id: string;
  box_id: string;
  box_name: string;
  operator_name: string;
  completed_at: string;
  notes: string | null;
  technician_name: string | null;
  technician_gc_id: string | null;
  items: CheckinItem[];
}

interface CheckinItem {
  id: string;
  produto_id: string;
  nome_produto: string;
  quantidade_esperada: number;
  quantidade_devolvida: number;
  divergencia: number;
  justificativa_tipo: string | null;
  justificativa_ref: string | null;
  justificativa_validada: boolean;
  reposto: boolean;
}

export default function CheckinLogsPage() {
  const [records, setRecords] = useState<CheckinRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<CheckinRecord | null>(null);
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("box_checkin_records")
      .select("*")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(500);

    if (fromDate) query = query.gte("completed_at", new Date(fromDate).toISOString());
    if (toDate) {
      const next = new Date(toDate);
      next.setDate(next.getDate() + 1);
      query = query.lt("completed_at", next.toISOString());
    }

    const { data: checkins } = await query;
    if (!checkins || checkins.length === 0) {
      setRecords([]);
      setLoading(false);
      return;
    }

    // Fetch all items for these checkins
    const checkinIds = checkins.map((c) => c.id);
    const { data: allItems } = await supabase
      .from("box_checkin_items")
      .select("*")
      .in("checkin_id", checkinIds);

    // Fetch box names and technician info from the movement logs (entrada action)
    const boxIds = [...new Set(checkins.map((c) => c.box_id))];
    const { data: boxes } = await supabase
      .from("boxes")
      .select("id, name, technician_name, technician_gc_id")
      .in("id", boxIds);

    // Also look at movement logs for the technician at check-in time
    const { data: entradaLogs } = await supabase
      .from("box_movement_logs")
      .select("box_id, technician_name, technician_gc_id, created_at")
      .eq("action", "entrada")
      .in("box_id", boxIds)
      .order("created_at", { ascending: false });

    const boxMap = new Map(boxes?.map((b) => [b.id, b]) || []);
    const itemsByCheckin = new Map<string, CheckinItem[]>();
    for (const item of allItems || []) {
      const list = itemsByCheckin.get(item.checkin_id) || [];
      list.push(item as CheckinItem);
      itemsByCheckin.set(item.checkin_id, list);
    }

    // Build technician map from entrada logs (most recent per box)
    const techByBox = new Map<string, { name: string | null; gcId: string | null }>();
    for (const log of entradaLogs || []) {
      if (!techByBox.has(log.box_id)) {
        techByBox.set(log.box_id, { name: log.technician_name, gcId: log.technician_gc_id });
      }
    }

    const results: CheckinRecord[] = checkins.map((c) => {
      const box = boxMap.get(c.box_id);
      // Try to find technician from entrada logs close to this checkin's time
      const tech = techByBox.get(c.box_id);
      return {
        id: c.id,
        box_id: c.box_id,
        box_name: box?.name || "—",
        operator_name: c.operator_name,
        completed_at: c.completed_at || c.created_at,
        notes: c.notes,
        technician_name: tech?.name || box?.technician_name || null,
        technician_gc_id: tech?.gcId || box?.technician_gc_id || null,
        items: itemsByCheckin.get(c.id) || [],
      };
    });

    setRecords(results);
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (!search.trim()) return records;
    const s = search.toLowerCase();
    return records.filter((r) =>
      r.box_name.toLowerCase().includes(s) ||
      r.operator_name.toLowerCase().includes(s) ||
      r.technician_name?.toLowerCase().includes(s) ||
      r.items.some((i) => i.nome_produto.toLowerCase().includes(s))
    );
  }, [records, search]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const exportCSV = () => {
    const header = ["Data/Hora", "Caixa", "Técnico", "Operador", "Itens", "Divergências", "Observações"];
    const rows = filtered.map((r) => [
      fmt(r.completed_at),
      r.box_name,
      r.technician_name || "",
      r.operator_name,
      r.items.length.toString(),
      r.items.filter((i) => i.divergencia > 0).length.toString(),
      r.notes || "",
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `checkins_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printReceipt = (record: CheckinRecord) => {
    const win = window.open("", "_blank");
    if (!win) return;

    const itemRows = record.items.map((item, idx) => `
      <tr style="background:${idx % 2 === 0 ? 'white' : '#fafafa'}">
        <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;font-size:10px;font-family:monospace;color:#555;">${item.produto_id}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;font-size:11px;">${item.nome_produto}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;font-size:11px;text-align:center;">${item.quantidade_esperada}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;font-size:11px;text-align:center;">${item.quantidade_devolvida}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;font-size:11px;text-align:center;">
          ${item.divergencia > 0 ? `<span style="color:#dc2626;font-weight:600;">-${item.divergencia}</span>` : '✓'}
        </td>
        <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;font-size:10px;">
          ${item.divergencia > 0 ? `${(item.justificativa_tipo || '').toUpperCase()} #${item.justificativa_ref || '—'}${item.justificativa_validada ? ' ✓' : ''}` : '—'}
        </td>
        <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;font-size:10px;text-align:center;">
          ${item.reposto ? '✓ Sim' : '—'}
        </td>
      </tr>
    `).join("");

    const totalEsperado = record.items.reduce((s, i) => s + i.quantidade_esperada, 0);
    const totalDevolvido = record.items.reduce((s, i) => s + i.quantidade_devolvida, 0);
    const totalDiv = record.items.filter((i) => i.divergencia > 0).length;

    win.document.write(`
      <html><head><title>Check-in - ${record.box_name}</title><style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:Arial,Helvetica,sans-serif; padding:24px; color:#1a1a1a; font-size:12px; }
        .header { text-align:center; margin-bottom:20px; border-bottom:2px solid #333; padding-bottom:12px; }
        .header h1 { font-size:16px; font-weight:700; margin-bottom:4px; text-transform:uppercase; letter-spacing:1px; }
        .header p { font-size:11px; color:#666; }
        .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:16px; padding:10px; background:#f5f5f5; border-radius:4px; }
        .info-item label { font-size:10px; color:#888; text-transform:uppercase; letter-spacing:0.5px; display:block; }
        .info-item span { font-size:12px; font-weight:600; }
        table { width:100%; border-collapse:collapse; margin-bottom:16px; }
        th { background:#333; color:white; padding:6px 8px; text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; }
        th:nth-child(3), th:nth-child(4), th:nth-child(5), th:nth-child(7) { text-align:center; }
        .totals { display:flex; justify-content:flex-end; gap:24px; padding:8px 0; border-top:2px solid #333; margin-bottom:20px; font-size:12px; font-weight:700; }
        .footer { text-align:center; font-size:9px; color:#999; margin-top:20px; padding-top:10px; border-top:1px solid #ddd; }
        @media print { body { padding:12px; } }
      </style></head><body>
        <div class="header">
          <h1>Relatório de Check-in</h1>
          <p>Documento gerado pelo sistema WeDo</p>
        </div>
        <div class="info-grid">
          <div class="info-item"><label>Caixa</label><span>${record.box_name}</span></div>
          <div class="info-item"><label>Data do Check-in</label><span>${fmt(record.completed_at)}</span></div>
          <div class="info-item"><label>Técnico</label><span>${record.technician_name || '—'}</span></div>
          <div class="info-item"><label>Operador</label><span>${record.operator_name}</span></div>
          ${record.notes ? `<div class="info-item" style="grid-column:1/3"><label>Observações</label><span>${record.notes}</span></div>` : ''}
        </div>
        <table>
          <thead><tr>
            <th>Código</th><th>Produto</th><th>Esperado</th><th>Devolvido</th><th>Diverg.</th><th>Justificativa</th><th>Reposto</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div class="totals">
          <span>Esperado: ${totalEsperado}</span>
          <span>Devolvido: ${totalDevolvido}</span>
          ${totalDiv > 0 ? `<span style="color:#dc2626;">Divergências: ${totalDiv}</span>` : ''}
        </div>
        <div class="footer">Documento gerado em ${fmt(new Date().toISOString())} · Sistema WeDo</div>
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
              <ClipboardCheck className="h-5 w-5" />
              Log de Check-ins
            </h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchData}>
              <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              if (filtered.length > 0) printReceipt(filtered[0]);
            }} disabled={filtered.length === 0}>
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
              placeholder="Buscar caixa, técnico, operador, produto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <div className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 w-[130px]" />
            <span className="text-xs text-muted-foreground">a</span>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 w-[130px]" />
          </div>
        </div>

        <div className="text-xs text-muted-foreground">{filtered.length} registro(s)</div>
      </div>

      <ScrollArea className="flex-1 px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">Nenhum check-in encontrado</div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((record) => {
              const divCount = record.items.filter((i) => i.divergencia > 0).length;
              const totalEsp = record.items.reduce((s, i) => s + i.quantidade_esperada, 0);
              const totalDev = record.items.reduce((s, i) => s + i.quantidade_devolvida, 0);
              return (
                <Card key={record.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center shrink-0 text-xs text-muted-foreground w-[70px]">
                      <Clock className="h-3.5 w-3.5 mb-0.5" />
                      <span>{new Date(record.completed_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                      <span>{new Date(record.completed_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px] font-semibold">
                          {record.box_name}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {record.items.length} itens
                        </Badge>
                        {divCount > 0 && (
                          <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                            {divCount} divergência(s)
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {record.technician_name && (
                          <span>Técnico: <span className="font-medium text-foreground">{record.technician_name}</span></span>
                        )}
                        <span>Esperado: {totalEsp} · Devolvido: {totalDev}</span>
                      </div>
                      {record.notes && (
                        <div className="text-[11px] text-muted-foreground bg-muted/50 rounded px-2 py-1">{record.notes}</div>
                      )}
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <User className="h-3 w-3" />
                          <span>{record.operator_name}</span>
                        </div>
                        <div className="flex gap-1 ml-auto">
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setSelectedRecord(record)}>
                            <Eye className="h-3 w-3 mr-1" /> Ver itens
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => printReceipt(record)}>
                            <Printer className="h-3 w-3 mr-1" /> Reimprimir
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Detail Dialog */}
      <Dialog open={!!selectedRecord} onOpenChange={() => setSelectedRecord(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Check-in: {selectedRecord?.box_name}
              <span className="text-sm font-normal text-muted-foreground ml-2">
                {selectedRecord && fmt(selectedRecord.completed_at)}
              </span>
            </DialogTitle>
          </DialogHeader>

          {selectedRecord && (
            <>
              <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                <div><span className="text-muted-foreground">Técnico:</span> {selectedRecord.technician_name || "—"}</div>
                <div><span className="text-muted-foreground">Operador:</span> {selectedRecord.operator_name}</div>
                {selectedRecord.notes && (
                  <div className="col-span-2"><span className="text-muted-foreground">Obs:</span> {selectedRecord.notes}</div>
                )}
              </div>

              <ScrollArea className="flex-1 min-h-0">
                <div className="rounded-lg border bg-card overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead className="text-center w-[70px]">Esperado</TableHead>
                        <TableHead className="text-center w-[70px]">Devolvido</TableHead>
                        <TableHead className="text-center w-[70px]">Diverg.</TableHead>
                        <TableHead>Justificativa</TableHead>
                        <TableHead className="text-center w-[60px]">Reposto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedRecord.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <p className="text-sm truncate max-w-[200px]">{item.nome_produto}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{item.produto_id}</p>
                          </TableCell>
                          <TableCell className="text-center">{item.quantidade_esperada}</TableCell>
                          <TableCell className="text-center">{item.quantidade_devolvida}</TableCell>
                          <TableCell className="text-center">
                            {item.divergencia > 0 ? (
                              <Badge variant="outline" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-[10px]">
                                -{item.divergencia}
                              </Badge>
                            ) : (
                              <span className="text-emerald-600">✓</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {item.divergencia > 0 ? (
                              <div className="text-xs">
                                <span className="font-mono">{(item.justificativa_tipo || "").toUpperCase()} #{item.justificativa_ref || "—"}</span>
                                {item.justificativa_validada && (
                                  <Badge variant="outline" className="ml-1 text-[9px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                                    validado
                                  </Badge>
                                )}
                              </div>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            {item.reposto ? (
                              <Badge variant="outline" className="text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">Sim</Badge>
                            ) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </ScrollArea>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedRecord(null)}>Fechar</Button>
            <Button onClick={() => selectedRecord && printReceipt(selectedRecord)}>
              <Printer className="h-4 w-4 mr-2" /> Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
