import { supabase } from "@/integrations/supabase/client";

export interface StockMovementItem {
  produto_id: string;
  nome_produto: string;
  quantidade: number;
  preco_unitario?: number;
}

export interface StockSaidaResponse {
  success: boolean;
  venda_gc_id?: string;
  venda_codigo?: string;
  summary?: string;
  error?: string;
}

export interface StockEntradaResponse {
  success: boolean;
  summary?: string;
  error?: string;
}

export async function executeStockSaida(params: {
  toolboxId: string;
  items: StockMovementItem[];
  justificativa: string;
  toolboxName: string;
  technicianName: string;
  technicianGcId?: string;
}): Promise<StockSaidaResponse> {
  if (!params.toolboxId || !params.technicianGcId || !params.items.length || params.items.some(item => !item.produto_id || !Number.isFinite(item.quantidade) || item.quantidade <= 0)) throw new Error('Confira a maleta, o técnico e as quantidades antes de iniciar a saída.');
  const claim = await (supabase as any).rpc('toolbox_stock_issue_claim', { p_toolbox_id: params.toolboxId, p_technician_gc_id: params.technicianGcId, p_technician_name: params.technicianName, p_items: params.items });
  if (claim.error || !claim.data) throw new Error(claim.error?.message || 'Saída não autorizada pelo controle da maleta.');
  const { data, error } = await supabase.functions.invoke("toolbox-stock-movement", {
    body: {
      tipo: "saida",
      items: params.items,
      justificativa: params.justificativa,
      toolbox_name: params.toolboxName,
      technician_name: params.technicianName,
      technician_gc_id: params.technicianGcId ?? null,
    },
  });

  if (error) {
    throw new Error(error.message || "Erro ao aplicar ajuste de estoque de saída");
  }
  if (data?.success !== true || !data?.venda_gc_id) throw new Error(data?.error || 'A saída de estoque não foi confirmada.');
  const finish = await (supabase as any).rpc('toolbox_stock_issue_finish', { p_id: claim.data, p_result: data });
  if (finish.error) throw new Error(`Saída ${data.venda_gc_id} confirmada no GC, mas o vínculo local está pendente. Não repita o ajuste de estoque; confira esta referência.`);

  return data as StockSaidaResponse;
}

export async function executeStockEntrada(params: {
  vendaGcId: string;
  toolboxName: string;
  technicianName: string;
}): Promise<StockEntradaResponse> {
  if (!params.vendaGcId) throw new Error('Referência da saída de estoque não informada.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(params.vendaGcId));
  const requestKey = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  const claim = await (supabase as any).rpc('toolbox_stock_return_claim', { p_key: requestKey, p_reference: params.vendaGcId });
  if (claim.error) throw new Error(claim.error.message);
  if (!claim.data?.claimed) {
    if (claim.data?.result?.success === true) return claim.data.result;
    throw new Error('Estorno ainda não confirmado. O vínculo foi preservado.');
  }
  const { data, error } = await supabase.functions.invoke("toolbox-stock-movement", {
    body: {
      tipo: "entrada",
      venda_gc_id: params.vendaGcId,
      toolbox_name: params.toolboxName,
      technician_name: params.technicianName,
    },
  });

  if (error) {
    throw new Error(error.message || "Erro ao estornar ajuste de estoque");
  }

  if (data?.success !== true) throw new Error(data?.error || 'O estorno de estoque não foi confirmado.');
  const finished = await (supabase as any).rpc('toolbox_stock_return_finish', { p_key: requestKey, p_result: data });
  if (finished.error) throw new Error('O GC respondeu ao estorno, mas houve falha ao registrar a confirmação. O vínculo foi preservado para conferência; não repita o ajuste no ERP.');

  return data as StockEntradaResponse;
}
