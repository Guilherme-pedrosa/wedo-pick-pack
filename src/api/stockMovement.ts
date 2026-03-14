import { supabase } from "@/integrations/supabase/client";

export interface StockMovementItem {
  produto_id: string;
  nome_produto: string;
  quantidade: number;
}

export interface StockMovementResult {
  produto_id: string;
  nome_produto: string;
  success: boolean;
  estoque_anterior?: number;
  estoque_novo?: number;
  error?: string;
}

export interface StockMovementResponse {
  success: boolean;
  summary: string;
  results: StockMovementResult[];
}

export async function executeStockMovement(params: {
  items: StockMovementItem[];
  justificativa: string;
  toolboxName: string;
  technicianName: string;
  tipo: "saida" | "entrada";
}): Promise<StockMovementResponse> {
  const { data, error } = await supabase.functions.invoke("toolbox-stock-movement", {
    body: {
      items: params.items,
      justificativa: params.justificativa,
      toolbox_name: params.toolboxName,
      technician_name: params.technicianName,
      tipo: params.tipo,
    },
  });

  if (error) {
    throw new Error(error.message || "Erro ao movimentar estoque");
  }

  return data as StockMovementResponse;
}
