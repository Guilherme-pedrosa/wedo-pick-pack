import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const LS_KEY = "wedo-last-seen-purchase-snapshot";
const POLL_MS = 60_000;

interface Snapshot {
  id: string;
  created_at: string;
  crit_count: number;
  arrival_overdue_count: number;
  warn_count: number;
  total: number;
  crit_rows: any[];
  arrival_rows: any[];
}

export function PurchaseTrackerAlertWatcher() {
  const navigate = useNavigate();
  const shownRef = useRef<string | null>(null);

  useEffect(() => {
    let stop = false;

    const show = (s: Snapshot) => {
      const parts: string[] = [];
      if (s.crit_count > 0) parts.push(`${s.crit_count} parados +30 dias`);
      if (s.arrival_overdue_count > 0) parts.push(`${s.arrival_overdue_count} com chegada atrasada`);

      const crit = (s.crit_rows || []).slice(0, 3).map((r: any) => `#${r.codigo} · ${r.fornecedor} — ${r.dias} dias`);
      const late = (s.arrival_rows || []).slice(0, 3).map((r: any) => `#${r.codigo} · ${r.fornecedor} — previsto ${r.previsao}, +${r.atraso} dias`);

      toast.warning("Alerta de Pedidos de Compra", {
        id: `purchase-alert-${s.id}`,
        duration: 15000,
        description: [parts.join(" · "), ...crit, ...late].filter(Boolean).join("\n"),
        className: "whitespace-pre-line",
        action: {
          label: "Abrir",
          onClick: () => {
            localStorage.setItem(LS_KEY, s.id);
            navigate("/compras/acompanhamento");
          },
        },
        onDismiss: () => localStorage.setItem(LS_KEY, s.id),
        onAutoClose: () => localStorage.setItem(LS_KEY, s.id),
      });
    };

    const tick = async () => {
      try {
        const { data } = await supabase
          .from("purchase_tracker_snapshots")
          .select("id, created_at, crit_count, arrival_overdue_count, warn_count, total, crit_rows, arrival_rows")
          .eq("status", "success")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (stop || !data) return;
        const s = data as Snapshot;
        const lastSeen = localStorage.getItem(LS_KEY);
        const hasAlert = (s.crit_count ?? 0) > 0 || (s.arrival_overdue_count ?? 0) > 0;
        if (lastSeen !== s.id && shownRef.current !== s.id && hasAlert) {
          shownRef.current = s.id;
          show(s);
        }
      } catch (e) {
        console.warn("PurchaseTrackerAlertWatcher poll error", e);
      }
    };

    tick();
    const it = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(it); };
  }, [navigate]);

  return null;
}
