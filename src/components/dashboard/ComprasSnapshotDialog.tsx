import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShoppingCart, Package, Clock, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase
      .from("compras_snapshots")
      .select("created_at, total_produtos_sem_estoque, total_produtos_ok, total_itens_cobertos_pedido, total_orcamentos, estimativa_total, itens_list, duration_ms")
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setSnapshot(data as any);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // Group items by grupo
  const grouped = snapshot?.itens_list?.reduce((acc, item) => {
    const g = item.grupo || "Sem grupo";
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {} as Record<string, ComprasItem[]>) ?? {};

  const sortedGroups = Object.keys(grouped).sort();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-warning" />
            Relatório de Compras
          </DialogTitle>
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
            <div className="px-4 pb-2">
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

            {/* Items list */}
            <ScrollArea className="flex-1 px-4 pb-4">
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
                          className="flex items-center gap-3 p-2.5 rounded-lg bg-card border border-border text-sm">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground truncate">{item.nome_produto}</p>
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
                            {item.orcamentos.length > 0 && (
                              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                                Orç: {item.orcamentos.map(o => `#${o.codigo} (${o.qtd})`).join(", ")}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-bold text-destructive">{item.qtd_efetiva_a_comprar} {item.sigla_unidade}</p>
                            <p className="text-[10px] text-muted-foreground">{formatCurrency(item.estimativa)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
