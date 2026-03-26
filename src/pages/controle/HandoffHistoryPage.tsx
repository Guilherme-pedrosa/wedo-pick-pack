import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, LogOut, ArrowLeft, RefreshCw, Search,
  Download, FileText, Calendar, Clock, User, Eye, Printer, Filter,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useNavigate } from "react-router-dom";
import BoxHandoffReceipt from "@/components/controle/BoxHandoffReceipt";

interface HandoffRecord {
  id: string;
  box_id: string;
  box_name: string;
  technician_name: string;
  technician_gc_id: string;
  operator_name: string;
  items_count: number;
  total_value: number;
  handed_at: string;
}

interface BoxItem {
  produto_id: string;
  nome_produto: string;
  quantidade: number;
  preco_unitario: number | null;
}

export default function HandoffHistoryPage() {
  const [records, setRecords] = useState<HandoffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<HandoffRecord | null>(null);
  const [selectedItems, setSelectedItems] = useState<BoxItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [receiptRecord, setReceiptRecord] = useState<HandoffRecord | null>(null);
  const [receiptItems, setReceiptItems] = useState<BoxItem[]>([]);
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("box_handoff_logs")
      .select("*")
      .order("handed_at", { ascending: false })
      .limit(500);

    if (fromDate) query = query.gte("handed_at", new Date(fromDate).toISOString());
    if (toDate) {
      const next = new Date(toDate);
      next.setDate(next.getDate() + 1);
      query = query.lt("handed_at", next.toISOString());
    }

    const { data } = await query;
    setRecords((data as HandoffRecord[]) || []);
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (!search.trim()) return records;
    const s = search.toLowerCase();
    return records.filter((r) =>
      r.box_name.toLowerCase().includes(s) ||
      r.technician_name.toLowerCase().includes(s) ||
      r.operator_name.toLowerCase().includes(s)
    );
  }, [records, search]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const loadItemsForHandoff = async (record: HandoffRecord) => {
    setLoadingItems(true);
    // Fetch current box_items for this box
    const { data } = await supabase
      .from("box_items")
      .select("produto_id, nome_produto, quantidade, preco_unitario")
      .eq("box_id", record.box_id)
      .order("nome_produto");
    setSelectedItems((data as BoxItem[]) || []);
    setLoadingItems(false);
  };

  const handleViewItems = async (record: HandoffRecord) => {
    setSelectedRecord(record);
    await loadItemsForHandoff(record);
  };

  const handleReprint = async (record: HandoffRecord) => {
    setReceiptRecord(record);
    // Load items for the receipt
    const { data } = await supabase
      .from("box_items")
      .select("produto_id, nome_produto, quantidade, preco_unitario")
      .eq("box_id", record.box_id)
      .order("nome_produto");
    setReceiptItems((data as BoxItem[]) || []);
  };

  const exportCSV = () => {
    const header = ["Data/Hora", "Caixa", "Técnico", "ID Técnico", "Itens", "Valor Total", "Operador"];
    const rows = filtered.map((r) => [
      fmt(r.handed_at),
      r.box_name,
      r.technician_name,
      r.technician_gc_id,
      r.items_count.toString(),
      r.total_value.toFixed(2),
      r.operator_name,
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vinculacoes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    const rows = filtered.map((r, idx) => `
      <tr style="background:${idx % 2 === 0 ? 'white' : '#fafafa'}">
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${fmt(r.handed_at)}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;font-weight:600;">${r.box_name}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${r.technician_name}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;text-align:center;">${r.items_count}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;text-align:right;">${formatCurrency(r.total_value)}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${r.operator_name}</td>
      </tr>
    `).join("");

    const totalVal = filtered.reduce((s, r) => s + r.total_value, 0);

    win.document.write(`
      <html><head><title>Vinculações</title><style>
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
        <h1>Histórico de Vinculações / Saídas</h1>
        <p>Gerado em ${new Date().toLocaleString("pt-BR")} — ${filtered.length} registro(s)</p>
        <table>
          <thead><tr>
            <th>Data/Hora</th><th>Caixa</th><th>Técnico</th><th>Itens</th><th>Valor</th><th>Operador</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="totals">Valor total: ${formatCurrency(totalVal)}</div>
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
              <LogOut className="h-5 w-5" />
              Histórico de Vinculações
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
              placeholder="Buscar caixa, técnico, operador..."
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
          <div className="text-center py-12 text-muted-foreground">Nenhuma vinculação encontrada</div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((record) => (
              <Card key={record.id} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center shrink-0 text-xs text-muted-foreground w-[70px]">
                    <Clock className="h-3.5 w-3.5 mb-0.5" />
                    <span>{new Date(record.handed_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                    <span>{new Date(record.handed_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] font-semibold">
                        {record.box_name}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {record.items_count} itens
                      </Badge>
                      {record.total_value > 0 && (
                        <span className="text-[10px] font-medium text-muted-foreground">{formatCurrency(record.total_value)}</span>
                      )}
                    </div>
                    <div className="text-xs">
                      Técnico: <span className="font-medium text-foreground">{record.technician_name}</span>
                      <span className="text-muted-foreground ml-1 font-mono text-[10px]">({record.technician_gc_id})</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <User className="h-3 w-3" />
                        <span>{record.operator_name}</span>
                      </div>
                      <div className="flex gap-1 ml-auto">
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => handleViewItems(record)}>
                          <Eye className="h-3 w-3 mr-1" /> Ver itens
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => handleReprint(record)}>
                          <Printer className="h-3 w-3 mr-1" /> Reimprimir
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Items Detail Dialog */}
      <Dialog open={!!selectedRecord} onOpenChange={() => setSelectedRecord(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="h-5 w-5" />
              Saída: {selectedRecord?.box_name}
              <span className="text-sm font-normal text-muted-foreground ml-2">
                {selectedRecord && fmt(selectedRecord.handed_at)}
              </span>
            </DialogTitle>
          </DialogHeader>

          {selectedRecord && (
            <>
              <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                <div><span className="text-muted-foreground">Técnico:</span> {selectedRecord.technician_name}</div>
                <div><span className="text-muted-foreground">Operador:</span> {selectedRecord.operator_name}</div>
              </div>

              {loadingItems ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ScrollArea className="flex-1 min-h-0">
                  <div className="rounded-lg border bg-card overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Produto</TableHead>
                          <TableHead className="text-center w-[60px]">Qtd</TableHead>
                          <TableHead className="text-right w-[90px]">Unit.</TableHead>
                          <TableHead className="text-right w-[90px]">Subtotal</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedItems.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell>
                              <p className="text-sm truncate max-w-[250px]">{item.nome_produto}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{item.produto_id}</p>
                            </TableCell>
                            <TableCell className="text-center">{item.quantidade}</TableCell>
                            <TableCell className="text-right text-xs">
                              {item.preco_unitario ? formatCurrency(item.preco_unitario) : "—"}
                            </TableCell>
                            <TableCell className="text-right text-xs">
                              {item.preco_unitario ? formatCurrency(item.quantidade * item.preco_unitario) : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex justify-end gap-4 mt-2 text-sm font-semibold">
                    <span>Total itens: {selectedItems.reduce((s, i) => s + i.quantidade, 0)}</span>
                    <span>{formatCurrency(selectedItems.reduce((s, i) => s + i.quantidade * (i.preco_unitario || 0), 0))}</span>
                  </div>
                </ScrollArea>
              )}
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedRecord(null)}>Fechar</Button>
            <Button onClick={() => selectedRecord && handleReprint(selectedRecord)}>
              <Printer className="h-4 w-4 mr-2" /> Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reprint Receipt */}
      {receiptRecord && (
        <BoxHandoffReceipt
          open={!!receiptRecord}
          onClose={() => { setReceiptRecord(null); setReceiptItems([]); }}
          boxName={receiptRecord.box_name}
          technicianName={receiptRecord.technician_name}
          technicianGcId={receiptRecord.technician_gc_id}
          items={receiptItems}
          date={receiptRecord.handed_at}
        />
      )}
    </div>
  );
}
