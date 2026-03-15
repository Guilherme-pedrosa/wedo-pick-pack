import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package,
  ShoppingCart,
  FileText,
  PackageCheck,
  ArrowRight,
  RefreshCw,
  Clock,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useComprasStore } from "@/store/comprasStore";
import { useCheckoutStore } from "@/store/checkoutStore";

interface KpiData {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  href: string;
}

interface RecentSeparation {
  id: string;
  order_code: string;
  client_name: string;
  items_total: number;
  items_confirmed: number;
  concluded_at: string;
  operator_name: string;
  order_type: string;
}

const DashboardPage = () => {
  const navigate = useNavigate();
  const [recentSeparations, setRecentSeparations] = useState<RecentSeparation[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<{ status: string; finished_at: string | null } | null>(null);
  const [totalSeparations, setTotalSeparations] = useState(0);
  const comprasResult = useComprasStore((s) => s.result);
  const checkoutSession = useCheckoutStore((s) => s.session);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Fetch recent separations
      const { data: seps } = await supabase
        .from("separations")
        .select("id, order_code, client_name, items_total, items_confirmed, concluded_at, operator_name, order_type")
        .eq("invalidated", false)
        .order("concluded_at", { ascending: false })
        .limit(5);

      if (seps) setRecentSeparations(seps);

      // Count total separations (not invalidated)
      const { count } = await supabase
        .from("separations")
        .select("id", { count: "exact", head: true })
        .eq("invalidated", false);

      setTotalSeparations(count ?? 0);

      // Fetch last sync run
      const { data: lastSync } = await supabase
        .from("sync_runs")
        .select("status, finished_at")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastSync) setSyncStatus(lastSync);
    } catch (e) {
      console.error("Dashboard load error:", e);
    } finally {
      setLoading(false);
    }
  };

  const pendingSessionLabel = checkoutSession
    ? `Em andamento: #${checkoutSession.codigo}`
    : "Nenhum pedido em separação";

  const comprasItens = comprasResult?.totalProdutosSemEstoque ?? 0;
  const comprasSubtitle = comprasResult
    ? `Última varredura: ${new Date(comprasResult.scannedAt).toLocaleString("pt-BR")}`
    : "Nenhuma varredura realizada";

  const todayCount = recentSeparations.filter(
    (s) => new Date(s.concluded_at).toDateString() === new Date().toDateString()
  ).length;

  const kpis: KpiData[] = [
    {
      title: "Separações",
      value: totalSeparations,
      subtitle: pendingSessionLabel,
      icon: Package,
      color: "text-primary",
      href: "/checkout",
    },
    {
      title: "Itens para Comprar",
      value: comprasItens,
      subtitle: comprasSubtitle,
      icon: ShoppingCart,
      color: "text-warning",
      href: "/compras",
    },
    {
      title: "Separações Hoje",
      value: todayCount,
      subtitle: "Concluídas hoje",
      icon: PackageCheck,
      color: "text-success",
      href: "/separations",
    },
    {
      title: "Índice de Produtos",
      value: syncStatus ? (syncStatus.status === "success" ? "✓ Sincronizado" : syncStatus.status) : "—",
      subtitle: syncStatus?.finished_at
        ? `Último sync: ${new Date(syncStatus.finished_at).toLocaleString("pt-BR")}`
        : "Nenhum sync executado",
      icon: RefreshCw,
      color: "text-muted-foreground",
      href: "/config",
    },
  ];

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}min atrás`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h atrás`;
    return d.toLocaleDateString("pt-BR");
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Visão geral do WeDo Pick & Pack</p>
        </div>
        <Button variant="outline" onClick={loadData} disabled={loading} className="bg-card">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, i) => (
          <div
            key={i}
            className="kpi-card"
            onClick={() => navigate(kpi.href)}
          >
            <div className="kpi-card-title">
              <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
              <span>{kpi.title}</span>
            </div>
            <div className="kpi-card-value text-2xl">{kpi.value}</div>
            {kpi.subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{kpi.subtitle}</p>
            )}
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 sm:grid-cols-3">
        <button
          onClick={() => navigate("/checkout")}
          className="flex items-center gap-4 p-4 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Package className="h-8 w-8" />
          <div className="text-left flex-1">
            <p className="font-semibold">Iniciar Separação</p>
            <p className="text-sm opacity-80">Conferir pedidos</p>
          </div>
          <ArrowRight className="h-5 w-5" />
        </button>

        <button
          onClick={() => navigate("/compras")}
          className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border hover:border-primary/20 hover:shadow-md transition-all"
        >
          <ShoppingCart className="h-8 w-8 text-warning" />
          <div className="text-left flex-1">
            <p className="font-semibold text-foreground">Gerar Lista de Compras</p>
            <p className="text-sm text-muted-foreground">Consolidar necessidades</p>
          </div>
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
        </button>

        <button
          onClick={() => navigate("/rastreador")}
          className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border hover:border-primary/20 hover:shadow-md transition-all"
        >
          <FileText className="h-8 w-8 text-muted-foreground" />
          <div className="text-left flex-1">
            <p className="font-semibold text-foreground">Rastrear Pedidos</p>
            <p className="text-sm text-muted-foreground">Buscar OS e vendas</p>
          </div>
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
        </button>
      </div>

      {/* Recent Separations */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Últimas Separações</h2>
          <Button variant="ghost" size="sm" onClick={() => navigate("/separations")}>
            Ver todas
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-muted rounded animate-pulse" />
            ))}
          </div>
        ) : recentSeparations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <PackageCheck className="h-10 w-10 mb-2" />
            <p className="text-sm">Nenhuma separação concluída ainda</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recentSeparations.map((sep) => (
              <div key={sep.id} className="flex items-center gap-4 py-3">
                <div className={`flex items-center justify-center h-8 w-8 rounded-full ${
                  sep.items_confirmed === sep.items_total
                    ? "bg-success/10 text-success"
                    : "bg-warning/10 text-warning"
                }`}>
                  {sep.items_confirmed === sep.items_total ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertTriangle className="h-4 w-4" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground">
                      #{sep.order_code}
                    </span>
                    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                      sep.order_type === "os"
                        ? "bg-primary/10 text-primary"
                        : "bg-purple-100 text-purple-700"
                    }`}>
                      {sep.order_type === "os" ? "OS" : "Venda"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{sep.client_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">
                    {sep.items_confirmed}/{sep.items_total}
                  </p>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatTime(sep.concluded_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardPage;
