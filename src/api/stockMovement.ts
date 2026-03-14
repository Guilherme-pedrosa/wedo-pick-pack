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
  items: StockMovementItem[];
  justificativa: string;
  toolboxName: string;
  technicianName: string;
  technicianGcId?: string;
}): Promise<StockSaidaResponse> {
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
    throw new Error(error.message || "Erro ao criar venda de empréstimo");
  }

  return data as StockSaidaResponse;
}

export async function executeStockEntrada(params: {
  vendaGcId: string;
  toolboxName: string;
  technicianName: string;
}): Promise<StockEntradaResponse> {
  const { data, error } = await supabase.functions.invoke("toolbox-stock-movement", {
    body: {
      tipo: "entrada",
      venda_gc_id: params.vendaGcId,
      toolbox_name: params.toolboxName,
      technician_name: params.technicianName,
    },
  });

  if (error) {
    throw new Error(error.message || "Erro ao devolver venda");
  }

  return data as StockEntradaResponse;
}
