import { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Package, Clock, AlertTriangle, FileDown, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

interface ComprasItem {
  produto_id: string;
  variacao_id: string;
  nome_produto: string;
  codigo_produto: string;
  sigla_unidade: string;
  grupo?: string;
  estoque_atual: number;
  estoque_reservado_os: number;
  estoque_disponivel: number;
  qtd_necessaria: number;
  qtd_a_comprar: number;
  qtd_ja_em_compra: number;
  qtd_efetiva_a_comprar: number;
  ultimo_preco: number;
  estimativa: number;
  orcamentos: Array<{ codigo: string; qtd: number; nome_cliente: string }>;
}

interface SnapshotData {
  created_at: string;
  total_produtos_sem_estoque: number;
  total_produtos_ok: number;
  total_itens_cobertos_pedido: number;
  total_orcamentos: number;
  estimativa_total: number;
  itens_list: ComprasItem[];
  duration_ms: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ComprasSnapshotDialog({ open, onOpenChange }: Props) {
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const fetchSnapshot = async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from("compras_snapshots")
          .select("created_at, total_produtos_sem_estoque, total_produtos_ok, total_itens_cobertos_pedido, total_orcamentos, estimativa_total, itens_list, duration_ms")
          .eq("status", "success")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) setSnapshot(data as any);
      } finally {
        setLoading(false);
      }
    };
    fetchSnapshot();
  }, [open]);

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const grouped = snapshot?.itens_list?.reduce((acc, item) => {
    const g = item.grupo || "Sem grupo";
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {} as Record<string, ComprasItem[]>) ?? {};

  const sortedGroups = Object.keys(grouped).sort();

  const exportCSV = () => {
    if (!snapshot) return;
    const header = "Grupo,Produto,Código,Estoque Atual,Reserv. OS,Disponível,Em PC,Qtd a Comprar,Unidade,Preço Unit.,Estimativa,Orçamentos";
    const rows = snapshot.itens_list.map(item => {
      const orcs = item.orcamentos.map(o => `#${o.codigo}(${o.qtd}x ${o.nome_cliente})`).join(" | ");
      return [
        `"${item.grupo || ""}"`,
        `"${item.nome_produto}"`,
        `"${item.codigo_produto}"`,
        item.estoque_atual,
        item.estoque_reservado_os,
        item.estoque_disponivel,
        item.qtd_ja_em_compra,
        item.qtd_efetiva_a_comprar,
        item.sigla_unidade,
        item.ultimo_preco.toFixed(2).replace(".", ","),
        item.estimativa.toFixed(2).replace(".", ","),
        `"${orcs}"`,
      ].join(";");
    });
    const csv = "\uFEFF" + [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compras_${new Date(snapshot.created_at).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPrintPDF = () => {
    if (!snapshot) return;
    const dateStr = new Date(snapshot.created_at).toLocaleString("pt-BR");
    let html = `<html><head><meta charset="utf-8"><title>Relatório de Compras</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:11px;margin:20px;color:#222}
      h1{font-size:16px;margin-bottom:4px}
      .meta{color:#666;font-size:10px;margin-bottom:12px}
      .summary{display:flex;gap:12px;margin-bottom:16px}
      .summary-card{border:1px solid #ddd;border-radius:6px;padding:8px 14px;text-align:center;flex:1}
      .summary-card .val{font-size:18px;font-weight:700}
      .summary-card .label{font-size:9px;color:#888}
      .group-title{font-size:12px;font-weight:700;color:#555;text-transform:uppercase;margin:14px 0 6px;border-bottom:1px solid #eee;padding-bottom:3px}
      table{width:100%;border-collapse:collapse;margin-bottom:8px}
      th,td{border:1px solid #ddd;padding:4px 6px;text-align:left;font-size:10px}
      th{background:#f5f5f5;font-weight:600}
      .right{text-align:right}
      .warn{color:#d97706}
      .danger{color:#dc2626}
      .info{color:#2563eb}
      .orc-detail{font-size:9px;color:#666;margin-top:2px}
      @media print{body{margin:10px}@page{size:landscape;margin:10mm}}
    </style></head><body>
    <h1>🛒 Relatório de Compras</h1>
    <div class="meta">${dateStr} · ${snapshot.total_orcamentos} orçamentos analisados</div>
    <div class="summary">
      <div class="summary-card"><div class="val" style="color:#dc2626">${snapshot.total_produtos_sem_estoque}</div><div class="label">Itens p/ comprar</div></div>
      <div class="summary-card"><div class="val" style="color:#d97706">${snapshot.total_itens_cobertos_pedido}</div><div class="label">Cobertos por PC</div></div>
      <div class="summary-card"><div class="val" style="color:#16a34a">${snapshot.total_produtos_ok}</div><div class="label">Com estoque</div></div>
      <div class="summary-card"><div class="val" style="color:#2563eb">${formatCurrency(snapshot.estimativa_total)}</div><div class="label">Estimativa total</div></div>
    </div>`;

    for (const group of sortedGroups) {
      const items = grouped[group];
      html += `<div class="group-title">${group} (${items.length})</div>`;
      html += `<table><thead><tr>
        <th>Produto</th><th>Código</th><th class="right">Estoque</th><th class="right">Reserv. OS</th>
        <th class="right">Em PC</th><th class="right">A Comprar</th><th class="right">Preço Unit.</th>
        <th class="right">Estimativa</th><th>Orçamentos</th>
      </tr></thead><tbody>`;
      for (const item of items) {
        const orcs = item.orcamentos.map(o =>
          `Orç #${o.codigo} — ${o.qtd}× — ${o.nome_cliente}`
        ).join("<br>");
        html += `<tr>
          <td>${item.nome_produto}</td>
          <td>${item.codigo_produto}</td>
          <td class="right">${item.estoque_atual}</td>
          <td class="right ${item.estoque_reservado_os > 0 ? 'warn' : ''}">${item.estoque_reservado_os}</td>
          <td class="right ${item.qtd_ja_em_compra > 0 ? 'info' : ''}">${item.qtd_ja_em_compra}</td>
          <td class="right danger" style="font-weight:700">${item.qtd_efetiva_a_comprar} ${item.sigla_unidade}</td>
          <td class="right">${formatCurrency(item.ultimo_preco)}</td>
          <td class="right">${formatCurrency(item.estimativa)}</td>
          <td>${orcs || "—"}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }

    html += `</body></html>`;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 400);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="shrink-0 p-4 pb-2">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-warning" />
              Relatório de Compras
            </DialogTitle>
            {snapshot && (
              <div className="flex items-center gap-1.5 mr-6">
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={exportCSV}>
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Excel
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={exportPrintPDF}>
                  <FileDown className="h-3.5 w-3.5" />
                  PDF
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            Carregando…
          </div>
        ) : !snapshot ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <AlertTriangle className="h-8 w-8 mb-2" />
            <p className="text-sm">Nenhum relatório disponível ainda</p>
          </div>
        ) : (
          <>
            {/* Summary bar */}
            <div className="shrink-0 px-4 pb-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
                <Clock className="h-3 w-3" />
                {new Date(snapshot.created_at).toLocaleString("pt-BR")}
                <span className="mx-1">·</span>
                {snapshot.total_orcamentos} orçamentos analisados
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-destructive/10 rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-destructive">{snapshot.total_produtos_sem_estoque}</p>
                  <p className="text-[10px] text-muted-foreground">Itens p/ comprar</p>
                </div>
                <div className="bg-warning/10 rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-warning">{snapshot.total_itens_cobertos_pedido}</p>
                  <p className="text-[10px] text-muted-foreground">Cobertos por PC</p>
                </div>
                <div className="bg-success/10 rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-success">{snapshot.total_produtos_ok}</p>
                  <p className="text-[10px] text-muted-foreground">Com estoque</p>
                </div>
                <div className="bg-primary/10 rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-primary">{formatCurrency(snapshot.estimativa_total)}</p>
                  <p className="text-[10px] text-muted-foreground">Estimativa total</p>
                </div>
              </div>
            </div>

            {/* Items list - native scroll */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
              <div className="space-y-4">
                {sortedGroups.map(group => (
                  <div key={group}>
                    <div className="flex items-center gap-2 mb-2 sticky top-0 bg-background py-1 z-10">
                      <Package className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {grouped[group].length}
                      </Badge>
                    </div>
                    <div className="space-y-1.5">
                      {grouped[group].map((item, idx) => (
                        <div key={`${item.produto_id}-${item.variacao_id}-${idx}`}
                          className="p-2.5 rounded-lg bg-card border border-border text-sm">
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-foreground">{item.nome_produto}</p>
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                                <span>Cód: {item.codigo_produto}</span>
                                <span>Est: {item.estoque_atual}</span>
                                {item.estoque_reservado_os > 0 && (
                                  <span className="text-warning">Reserv. OS: {item.estoque_reservado_os}</span>
                                )}
                                {item.qtd_ja_em_compra > 0 && (
                                  <span className="text-primary">Em PC: {item.qtd_ja_em_compra}</span>
                                )}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-bold text-destructive">{item.qtd_efetiva_a_comprar} {item.sigla_unidade}</p>
                              <p className="text-[10px] text-muted-foreground">{formatCurrency(item.estimativa)}</p>
                            </div>
                          </div>
                          {/* Detailed orcamento references */}
                          {item.orcamentos.length > 0 && (
                            <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-0.5">
                              {item.orcamentos.map((o, oi) => (
                                <div key={oi} className="flex items-center gap-2 text-[10px]">
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 font-mono">
                                    Orç #{o.codigo}
                                  </Badge>
                                  <span className="text-muted-foreground">{o.qtd}×</span>
                                  <span className="text-muted-foreground truncate">{o.nome_cliente}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
