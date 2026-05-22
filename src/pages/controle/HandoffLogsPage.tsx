import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, ClipboardList, ArrowLeft, LogOut, LogIn,
  RefreshCw, PackagePlus, PackageMinus, FileText, UserX, Search, Package,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";

interface SnapshotItem {
  produto_id: string;
  nome_produto: string;
  codigo_interno?: string;
  quantidade: number;
  preco_unitario?: number;
}

interface MovementLog {
  id: string;
  box_id: string;
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
  items_snapshot: SnapshotItem[] | null;
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
  const [detailLog, setDetailLog] = useState<MovementLog | null>(null);
  const [detailItems, setDetailItems] = useState<SnapshotItem[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const navigate = useNavigate();

  const openDetails = async (log: MovementLog) => {
    setDetailLog(log);
    if (log.items_snapshot && Array.isArray(log.items_snapshot) && log.items_snapshot.length > 0) {
      setDetailItems(log.items_snapshot);
      return;
    }
    // Fallback for legacy "entrada" logs: look up the closest check-in record
    if (log.action === "entrada") {
      setDetailLoading(true);
      try {
        const logTime = new Date(log.created_at).getTime();
        const { data: recs } = await supabase
          .from("box_checkin_records")
          .select("id, completed_at, created_at")
          .eq("box_id", log.box_id)
          .order("created_at", { ascending: false })
          .limit(20);
        const match = (recs || []).find((r) => {
          const t = new Date(r.completed_at || r.created_at).getTime();
          return Math.abs(t - logTime) < 1000 * 60 * 60; // within 1h
        });
        if (match) {
          const { data: items } = await supabase
            .from("box_checkin_items")
            .select("produto_id, nome_produto, quantidade_devolvida")
            .eq("checkin_id", match.id);
          setDetailItems(
            (items || []).map((i) => ({
              produto_id: i.produto_id,
              nome_produto: i.nome_produto,
              quantidade: i.quantidade_devolvida,
            }))
          );
        } else {
          setDetailItems([]);
        }
      } finally {
        setDetailLoading(false);
      }
      return;
    }
    setDetailItems([]);
  };

  const closeDetails = () => {
    setDetailLog(null);
    setDetailItems(null);
  };

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
      setLogs(data as unknown as MovementLog[]);
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
      const snapshotMatch = Array.isArray(l.items_snapshot)
        ? l.items_snapshot.some(
            (it) =>
              it?.nome_produto?.toLowerCase().includes(q) ||
              it?.codigo_interno?.toLowerCase().includes(q) ||
              it?.produto_id?.toLowerCase().includes(q)
          )
        : false;
      return (
        l.box_name?.toLowerCase().includes(q) ||
        l.produto_nome?.toLowerCase().includes(q) ||
        l.technician_name?.toLowerCase().includes(q) ||
        l.operator_name?.toLowerCase().includes(q) ||
        l.details?.toLowerCase().includes(q) ||
        l.ref_numero?.toLowerCase().includes(q) ||
        snapshotMatch
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
                <TableHead className="text-right">Peças</TableHead>
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
                    <TableCell className="text-right">
                      {(log.action === "saida" || log.action === "entrada") ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openDetails(log)}
                          className="gap-1"
                        >
                          <Package className="h-3 w-3" />
                          Ver peças
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!detailLog} onOpenChange={(o) => !o && closeDetails()}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Peças da caixa — {detailLog?.box_name}
            </DialogTitle>
            <DialogDescription>
              {detailLog && (
                <>
                  {ACTION_CONFIG[detailLog.action]?.label || detailLog.action} em {formatDate(detailLog.created_at)}
                  {detailLog.technician_name ? ` · Técnico: ${detailLog.technician_name}` : ""}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !detailItems || detailItems.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Snapshot de peças não disponível para este registro.
              {detailLog?.action === "saida" && (
                <p className="mt-2 text-xs">
                  Registros antigos (anteriores a esta atualização) não contêm a lista detalhada. Novas saídas e entradas serão registradas com a relação completa de peças.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead className="text-center">Qtd</TableHead>
                    <TableHead className="text-right">Preço Unit.</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailItems.map((it, idx) => (
                    <TableRow key={`${it.produto_id}-${idx}`}>
                      <TableCell className="font-medium">
                        {it.codigo_interno ? `[${it.codigo_interno}] ` : ""}
                        {it.nome_produto}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {it.produto_id}
                      </TableCell>
                      <TableCell className="text-center">{it.quantidade}</TableCell>
                      <TableCell className="text-right text-sm">
                        {it.preco_unitario != null ? formatCurrency(Number(it.preco_unitario)) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {it.preco_unitario != null
                          ? formatCurrency(it.quantidade * Number(it.preco_unitario))
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="bg-muted/50 px-4 py-2 text-sm flex justify-between font-medium">
                <span>{detailItems.reduce((s, i) => s + i.quantidade, 0)} itens</span>
                <span>
                  {formatCurrency(
                    detailItems.reduce(
                      (s, i) => s + i.quantidade * (Number(i.preco_unitario) || 0),
                      0
                    )
                  )}
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
