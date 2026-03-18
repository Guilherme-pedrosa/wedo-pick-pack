import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logBoxMovement } from "./boxMovementLog";

export interface BaixaAlert {
  logId: string;
  boxId: string;
  boxName: string;
  produtoId: string;
  produtoNome: string;
  quantidade: number;
  precoUnitario: number;
  refTipo: string;
  refNumero: string;
  reason: string;
  reverted: boolean;
  revertedTo: string;
  operatorName: string;
  createdAt: string;
  /** GC audit info (when available) */
  gcSituacao?: string;
  gcModificadoEm?: string;
  gcUsuarioNome?: string;
  gcObsInterna?: string;
}

/**
 * Get or create the system "Pendências" box for orphan reversals.
 */
async function getOrCreatePendenciasBox(userId: string): Promise<{ id: string; name: string } | null> {
  const PENDENCIAS_NAME = "⚠️ Pendências (Estornos)";

  const { data: existing } = await supabase
    .from("boxes")
    .select("id, name")
    .eq("name", PENDENCIAS_NAME)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("boxes")
    .insert({ name: PENDENCIAS_NAME, user_id: userId })
    .select("id, name")
    .single();

  if (error) {
    console.error("Failed to create Pendências box:", error);
    return null;
  }
  return created;
}

/**
 * Reverse a single baixa: restore item to target box and log it.
 */
async function reverseItem(
  alert: BaixaAlert,
  targetBoxId: string,
  targetBoxName: string,
  relinkTechnician?: { gc_id: string; name: string },
) {
  // Check if item already exists in target box
  const { data: existingItem } = await supabase
    .from("box_items")
    .select("id, quantidade")
    .eq("box_id", targetBoxId)
    .eq("produto_id", alert.produtoId)
    .maybeSingle();

  if (existingItem) {
    await supabase
      .from("box_items")
      .update({ quantidade: existingItem.quantidade + alert.quantidade })
      .eq("id", existingItem.id);
  } else {
    await supabase.from("box_items").insert({
      box_id: targetBoxId,
      produto_id: alert.produtoId,
      nome_produto: alert.produtoNome,
      quantidade: alert.quantidade,
      preco_unitario: alert.precoUnitario || 0,
    });
  }

  // Log the automatic reversal with ref key for dedup
  await logBoxMovement({
    boxId: targetBoxId,
    boxName: targetBoxName,
    action: "adicao",
    produtoId: alert.produtoId,
    produtoNome: alert.produtoNome,
    quantidade: alert.quantidade,
    precoUnitario: alert.precoUnitario,
    refTipo: alert.refTipo,
    refNumero: alert.refNumero,
    details: `Estorno automático: ${alert.reason} | ref:${alert.refTipo}:${alert.refNumero}:${alert.logId}`,
  });

  // Re-link technician to the box if needed (forces check-in before release)
  if (relinkTechnician) {
    const { data: currentBox } = await supabase
      .from("boxes")
      .select("status, technician_gc_id")
      .eq("id", targetBoxId)
      .maybeSingle();

    // Only re-link if box is in Stand By (no technician currently linked)
    if (currentBox && currentBox.status === "active" && !currentBox.technician_gc_id) {
      await supabase
        .from("boxes")
        .update({
          technician_gc_id: relinkTechnician.gc_id,
          technician_name: relinkTechnician.name,
          status: "em_operacao",
        })
        .eq("id", targetBoxId);

      await logBoxMovement({
        boxId: targetBoxId,
        boxName: targetBoxName,
        action: "vinculacao",
        details: `Revinculação automática: técnico ${relinkTechnician.name} revinculado por estorno de item removido da OS`,
        technicianGcId: relinkTechnician.gc_id,
        technicianName: relinkTechnician.name,
      });
    }
  }
}

/**
 * Checks all active baixas against GestãoClick to detect
 * cancelled or modified orders, then auto-reverses them.
 */
export async function validateActiveBaixas(): Promise<BaixaAlert[]> {
  const alerts: BaixaAlert[] = [];

  try {
    const { data: baixaLogs, error } = await supabase
      .from("box_movement_logs")
      .select("*")
      .eq("action", "baixa")
      .order("created_at", { ascending: false });

    if (error || !baixaLogs?.length) return alerts;

    // Check which ones were already auto-reverted (by logId in details)
    const { data: existingReverts } = await supabase
      .from("box_movement_logs")
      .select("details")
      .like("details", "Estorno automático:%");

    const revertedLogIds = new Set<string>();
    for (const r of existingReverts || []) {
      // Extract logId from details pattern: "...ref:tipo:numero:logId"
      const match = r.details?.match(/ref:\w+:\w+:([a-f0-9-]+)/);
      if (match) revertedLogIds.add(match[1]);
    }

    // Filter out already-reverted logs
    const pendingLogs = baixaLogs.filter((l) => !revertedLogIds.has(l.id));
    if (!pendingLogs.length) return alerts;

    // Group by unique ref_tipo + ref_numero
    const refGroups = new Map<string, typeof pendingLogs>();
    for (const log of pendingLogs) {
      if (!log.ref_tipo || !log.ref_numero) continue;
      const key = `${log.ref_tipo}:${log.ref_numero}`;
      if (!refGroups.has(key)) refGroups.set(key, []);
      refGroups.get(key)!.push(log);
    }

    // Check each unique reference against GestãoClick
    for (const [key, logs] of refGroups) {
      const [tipo, numero] = key.split(":");
      const endpoint = tipo === "os" ? "ordens_servicos" : "vendas";
      const label = tipo === "os" ? "OS" : "Venda";

      try {
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

        let reason = "";
        let shouldRevert = false;
        let gcAudit: { situacao?: string; modificadoEm?: string; usuarioNome?: string; obsInterna?: string } = {};

        if (!orderData) {
          reason = `${label} #${numero} não encontrada no GestãoClick (excluída)`;
          shouldRevert = true;
        } else {
          // Extract audit info from the order
          gcAudit = {
            situacao: orderData.nome_situacao || orderData.situacao || "",
            modificadoEm: orderData.modificado_em || orderData.atualizado_em || "",
            usuarioNome: orderData.nome_vendedor || orderData.nome_usuario || orderData.nome_tecnico || "",
            obsInterna: orderData.observacoes_interna || "",
          };

          const situacao = (gcAudit.situacao || "").toLowerCase();
          const isCancelled =
            situacao.includes("cancelad") ||
            situacao.includes("cancel") ||
            situacao.includes("exclu");

          if (isCancelled) {
            const modInfo = gcAudit.modificadoEm ? ` em ${gcAudit.modificadoEm}` : "";
            const userInfo = gcAudit.usuarioNome ? ` por ${gcAudit.usuarioNome}` : "";
            reason = `${label} #${numero} CANCELADA${userInfo}${modInfo}`;
            shouldRevert = true;
          }
        }

        // Check product removal (only if order exists and isn't cancelled)
        if (orderData && !shouldRevert) {
          const produtos = orderData.produtos || [];
          for (const log of logs) {
            if (!log.produto_id) continue;
            const productInOrder = produtos.find(
              (p: any) =>
                p?.produto?.produto_id === log.produto_id ||
                String(p?.produto?.produto_id) === log.produto_id
            );
            if (!productInOrder) {
              // Item was removed from the OS/Venda → auto-reverse it back to the ORIGINAL box
              const { data: box } = await supabase
                .from("boxes")
                .select("id, name, technician_name, technician_gc_id, status, user_id")
                .eq("id", log.box_id)
                .maybeSingle();

              // Always return to the original box (even if Stand By)
              let targetBoxId: string;
              let targetBoxName: string;
              let relinkTechnician: { gc_id: string; name: string } | undefined;

              if (box) {
                targetBoxId = box.id;
                targetBoxName = box.name;

                // If box is in Stand By and the log has technician info, re-link the technician
                if (box.status === "active" && !box.technician_gc_id && log.technician_gc_id && log.technician_name) {
                  relinkTechnician = { gc_id: log.technician_gc_id, name: log.technician_name };
                }
              } else {
                const userId = log.operator_id;
                const pendencias = await getOrCreatePendenciasBox(userId);
                if (!pendencias) {
                  console.error("Could not create Pendências box for item reversal");
                  continue;
                }
                targetBoxId = pendencias.id;
                targetBoxName = pendencias.name;
              }

              const itemAlert: BaixaAlert = {
                logId: log.id,
                boxId: log.box_id,
                boxName: log.box_name,
                produtoId: log.produto_id,
                produtoNome: log.produto_nome || "",
                quantidade: log.quantidade || 0,
                precoUnitario: log.preco_unitario || 0,
                refTipo: tipo,
                refNumero: numero,
                reason: `Produto "${log.produto_nome}" foi removido da ${label} #${numero}`,
                reverted: true,
                revertedTo: targetBoxName,
                operatorName: log.operator_name || "",
                createdAt: log.created_at,
                gcSituacao: gcAudit.situacao,
                gcModificadoEm: gcAudit.modificadoEm,
                gcUsuarioNome: gcAudit.usuarioNome,
                gcObsInterna: gcAudit.obsInterna,
              };

              await reverseItem(itemAlert, targetBoxId, targetBoxName, relinkTechnician);
              alerts.push(itemAlert);
            }
          }
        }

        // Auto-revert all logs for this cancelled/deleted ref
        if (shouldRevert) {
          for (const log of logs) {
            if (!log.produto_id) continue;

            // Check if the original box has a technician
            const { data: box } = await supabase
              .from("boxes")
              .select("id, name, technician_name, status, user_id")
              .eq("id", log.box_id)
              .maybeSingle();

            let targetBoxId: string;
            let targetBoxName: string;

            if (box && box.status === "active" && box.technician_name) {
              // Box is in operation → return to same box
              targetBoxId = box.id;
              targetBoxName = box.name;
            } else {
              // Box has no technician or is closed → move to Pendências
              const userId = box?.user_id || log.operator_id;
              const pendencias = await getOrCreatePendenciasBox(userId);
              if (!pendencias) {
                console.error("Could not create Pendências box");
                continue;
              }
              targetBoxId = pendencias.id;
              targetBoxName = pendencias.name;
            }

            const alert: BaixaAlert = {
              logId: log.id,
              boxId: log.box_id,
              boxName: log.box_name,
              produtoId: log.produto_id,
              produtoNome: log.produto_nome || "",
              quantidade: log.quantidade || 0,
              precoUnitario: log.preco_unitario || 0,
              refTipo: tipo,
              refNumero: numero,
              reason,
              reverted: true,
              revertedTo: targetBoxName,
              operatorName: log.operator_name || "",
              createdAt: log.created_at,
              gcSituacao: gcAudit.situacao,
              gcModificadoEm: gcAudit.modificadoEm,
              gcUsuarioNome: gcAudit.usuarioNome,
              gcObsInterna: gcAudit.obsInterna,
            };

            await reverseItem(alert, targetBoxId, targetBoxName);
            alerts.push(alert);
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
 * Run validation, auto-reverse, and show toast alerts.
 */
export async function runBaixaValidationWithAlerts(): Promise<BaixaAlert[]> {
  const alerts = await validateActiveBaixas();

  if (alerts.length > 0) {
    for (const alert of alerts) {
      if (alert.reverted) {
        toast.warning(`${alert.reason}`, {
          description: `✅ Estornado: ${alert.quantidade}x "${alert.produtoNome}" devolvido para "${alert.revertedTo}"`,
          duration: 20000,
        });
      } else {
        toast.error(alert.reason, {
          description: `Caixa: ${alert.boxName} · ${alert.produtoNome} (${alert.quantidade}x)`,
          duration: 15000,
        });
      }
    }
  }

  return alerts;
}
