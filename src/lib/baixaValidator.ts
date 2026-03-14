import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface BaixaAlert {
  logId: string;
  boxId: string;
  boxName: string;
  produtoId: string;
  produtoNome: string;
  quantidade: number;
  refTipo: string;
  refNumero: string;
  reason: string;
}

/**
 * Checks all active baixas (write-offs) against GestãoClick to detect
 * cancelled or modified orders. Returns alerts for any issues found.
 */
export async function validateActiveBaixas(): Promise<BaixaAlert[]> {
  const alerts: BaixaAlert[] = [];

  try {
    // Fetch all baixa logs that haven't been reverted yet
    const { data: baixaLogs, error } = await supabase
      .from("box_movement_logs")
      .select("*")
      .eq("action", "baixa")
      .order("created_at", { ascending: false });

    if (error || !baixaLogs?.length) return alerts;

    // Group by unique ref_tipo + ref_numero to avoid duplicate API calls
    const refGroups = new Map<string, typeof baixaLogs>();
    for (const log of baixaLogs) {
      if (!log.ref_tipo || !log.ref_numero) continue;
      // Skip already-reverted ones
      const key = `${log.ref_tipo}:${log.ref_numero}`;
      if (!refGroups.has(key)) refGroups.set(key, []);
      refGroups.get(key)!.push(log);
    }

    // Check if any of these have already been flagged (avoid re-alerting)
    const { data: existingReverts } = await supabase
      .from("box_movement_logs")
      .select("details")
      .eq("action", "estorno_automatico");

    const revertedRefs = new Set(
      (existingReverts || [])
        .map((r) => r.details?.match(/ref:(\S+)/)?.[1])
        .filter(Boolean)
    );

    // Check each unique reference against GestãoClick
    for (const [key, logs] of refGroups) {
      if (revertedRefs.has(key)) continue;

      const [tipo, numero] = key.split(":");
      const endpoint = tipo === "os" ? "ordens_servicos" : "vendas";

      try {
        // Try to find the order
        let orderData: any = null;

        // Strategy 1: search by codigo
        const { data: searchData } = await supabase.functions.invoke("gc-proxy", {
          body: { path: `/api/${endpoint}?codigo=${encodeURIComponent(numero)}`, method: "GET" },
        });

        if (searchData?._proxy?.ok && searchData?.data?.length) {
          const match = searchData.data.find(
            (r: any) =>
              String(r.codigo).trim() === numero ||
              String(r.numero).trim() === numero ||
              String(r.id).trim() === numero
          );
          if (match) {
            // Fetch detail
            const detailId = match.id || match.ordem_servico_id || match.venda_id;
            const { data: detailData } = await supabase.functions.invoke("gc-proxy", {
              body: { path: `/api/${endpoint}/${detailId}`, method: "GET" },
            });
            if (detailData?._proxy?.ok) orderData = detailData.data;
          }
        }

        // Strategy 2: direct by ID if numeric
        if (!orderData && /^\d+$/.test(numero)) {
          const { data: directData } = await supabase.functions.invoke("gc-proxy", {
            body: { path: `/api/${endpoint}/${numero}`, method: "GET" },
          });
          if (directData?._proxy?.ok && directData?.data) {
            orderData = directData.data;
          }
        }

        if (!orderData) {
          // Order not found at all - might have been deleted
          for (const log of logs) {
            alerts.push({
              logId: log.id,
              boxId: log.box_id,
              boxName: log.box_name,
              produtoId: log.produto_id || "",
              produtoNome: log.produto_nome || "",
              quantidade: log.quantidade || 0,
              refTipo: tipo,
              refNumero: numero,
              reason: `${tipo === "os" ? "OS" : "Venda"} #${numero} não encontrada no GestãoClick (pode ter sido excluída)`,
            });
          }
          continue;
        }

        // Check if order is cancelled
        const situacao = (orderData.situacao || orderData.status || "").toLowerCase();
        const isCancelled =
          situacao.includes("cancelad") ||
          situacao.includes("cancel") ||
          situacao.includes("exclu");

        if (isCancelled) {
          for (const log of logs) {
            alerts.push({
              logId: log.id,
              boxId: log.box_id,
              boxName: log.box_name,
              produtoId: log.produto_id || "",
              produtoNome: log.produto_nome || "",
              quantidade: log.quantidade || 0,
              refTipo: tipo,
              refNumero: numero,
              reason: `${tipo === "os" ? "OS" : "Venda"} #${numero} foi CANCELADA no GestãoClick`,
            });
          }
          continue;
        }

        // Check if the product was removed from the order
        const produtos = orderData.produtos || [];
        for (const log of logs) {
          if (!log.produto_id) continue;
          const productInOrder = produtos.find(
            (p: any) =>
              p?.produto?.produto_id === log.produto_id ||
              String(p?.produto?.produto_id) === log.produto_id
          );
          if (!productInOrder) {
            alerts.push({
              logId: log.id,
              boxId: log.box_id,
              boxName: log.box_name,
              produtoId: log.produto_id,
              produtoNome: log.produto_nome || "",
              quantidade: log.quantidade || 0,
              refTipo: tipo,
              refNumero: numero,
              reason: `Produto "${log.produto_nome}" foi removido da ${tipo === "os" ? "OS" : "Venda"} #${numero}`,
            });
          }
        }
      } catch (e) {
        console.error(`Error validating ref ${key}:`, e);
      }
    }
  } catch (e) {
    console.error("Error in validateActiveBaixas:", e);
  }

  return alerts;
}

/**
 * Run validation and show toast alerts for any issues found.
 */
export async function runBaixaValidationWithAlerts(): Promise<BaixaAlert[]> {
  const alerts = await validateActiveBaixas();

  if (alerts.length > 0) {
    for (const alert of alerts) {
      toast.error(alert.reason, {
        description: `Caixa: ${alert.boxName} · ${alert.produtoNome} (${alert.quantidade}x)`,
        duration: 15000,
      });
    }
  }

  return alerts;
}
