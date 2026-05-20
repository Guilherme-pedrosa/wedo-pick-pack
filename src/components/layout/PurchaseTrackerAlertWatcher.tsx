import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Flame } from "lucide-react";

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
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let stop = false;
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
        if (lastSeen !== s.id && hasAlert) {
          setSnap(s);
          setOpen(true);
        }
      } catch (e) {
        console.warn("PurchaseTrackerAlertWatcher poll error", e);
      }
    };
    tick();
    const it = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(it); };
  }, []);

  const dismiss = () => {
    if (snap) localStorage.setItem(LS_KEY, snap.id);
    setOpen(false);
  };

  const goToTracker = () => {
    if (snap) localStorage.setItem(LS_KEY, snap.id);
    setOpen(false);
    navigate("/purchase-tracker");
  };

  if (!snap) return null;

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && dismiss()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Alerta de Pedidos de Compra
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                {snap.crit_count > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500 text-white px-2.5 py-1 text-xs font-semibold">
                    <Flame className="h-3 w-3" /> {snap.crit_count} parados +30 dias
                  </span>
                )}
                {snap.arrival_overdue_count > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 text-white px-2.5 py-1 text-xs font-semibold">
                    <AlertTriangle className="h-3 w-3" /> {snap.arrival_overdue_count} com chegada atrasada
                  </span>
                )}
              </div>

              {snap.crit_rows?.length > 0 && (
                <div>
                  <p className="font-medium text-foreground mb-1">Parados há mais de 30 dias:</p>
                  <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
                    {snap.crit_rows.slice(0, 5).map((r: any, i: number) => (
                      <li key={i} className="text-xs">
                        <span className="font-mono">#{r.codigo}</span> · {r.fornecedor} — <span className="text-red-600 font-semibold">{r.dias} dias</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {snap.arrival_rows?.length > 0 && (
                <div>
                  <p className="font-medium text-foreground mb-1">Chegada atrasada:</p>
                  <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
                    {snap.arrival_rows.slice(0, 5).map((r: any, i: number) => (
                      <li key={i} className="text-xs">
                        <span className="font-mono">#{r.codigo}</span> · {r.fornecedor} — previsto {r.previsao}, <span className="text-amber-600 font-semibold">+{r.atraso} dias</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-xs text-muted-foreground pt-1">
                Snapshot de {new Date(snap.created_at).toLocaleString("pt-BR")}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={dismiss}>Dispensar</AlertDialogCancel>
          <AlertDialogAction onClick={goToTracker}>Abrir acompanhamento</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
