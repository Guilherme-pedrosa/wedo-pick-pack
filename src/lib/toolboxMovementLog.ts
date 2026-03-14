import { supabase } from "@/integrations/supabase/client";

interface LogParams {
  toolboxId: string;
  toolboxName: string;
  action: string;
  produtoId?: string;
  produtoNome?: string;
  quantidade?: number;
  precoUnitario?: number;
  refTipo?: string;
  refNumero?: string;
  details?: string;
  technicianName?: string;
  technicianGcId?: string;
}

export async function logToolboxMovement(params: LogParams) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();

  await (supabase.from("toolbox_movement_logs") as any).insert({
    toolbox_id: params.toolboxId,
    toolbox_name: params.toolboxName,
    action: params.action,
    produto_id: params.produtoId || null,
    produto_nome: params.produtoNome || null,
    quantidade: params.quantidade || null,
    preco_unitario: params.precoUnitario || null,
    ref_tipo: params.refTipo || null,
    ref_numero: params.refNumero || null,
    details: params.details || null,
    operator_id: user.id,
    operator_name: profile?.name || user.email || "",
    technician_name: params.technicianName || null,
    technician_gc_id: params.technicianGcId || null,
  });
}
