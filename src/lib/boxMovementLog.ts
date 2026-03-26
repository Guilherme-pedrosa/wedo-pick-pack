import { supabase } from "@/integrations/supabase/client";

export type MovementAction =
  | "saida"          // box handed to technician
  | "entrada"        // check-in completed
  | "baixa"          // item write-off via OS/Venda
  | "adicao"         // item added to box
  | "remocao"        // item removed from box
  | "desvincular"    // technician unlinked
  | "vinculacao";    // technician linked/re-linked

interface LogMovementParams {
  boxId: string;
  boxName: string;
  action: MovementAction;
  produtoId?: string;
  produtoNome?: string;
  quantidade?: number;
  precoUnitario?: number;
  refTipo?: string;
  refNumero?: string;
  technicianName?: string;
  technicianGcId?: string;
  details?: string;
  saldoAntes?: number;
  saldoDepois?: number;
}

export async function logBoxMovement(params: LogMovementParams) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let operatorName = user.email || "";
    const { data: prof } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .single();
    if (prof) operatorName = prof.name;

    await supabase.from("box_movement_logs").insert({
      box_id: params.boxId,
      box_name: params.boxName,
      action: params.action,
      produto_id: params.produtoId || null,
      produto_nome: params.produtoNome || null,
      quantidade: params.quantidade || null,
      preco_unitario: params.precoUnitario || null,
      ref_tipo: params.refTipo || null,
      ref_numero: params.refNumero || null,
      technician_name: params.technicianName || null,
      technician_gc_id: params.technicianGcId || null,
      operator_id: user.id,
      operator_name: operatorName,
      details: params.details || null,
      saldo_antes: params.saldoAntes ?? null,
      saldo_depois: params.saldoDepois ?? null,
    });
  } catch (e) {
    console.error("Failed to log box movement:", e);
  }
}
