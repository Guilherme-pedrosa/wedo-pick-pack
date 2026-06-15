-- Histórico de compras por produto x fornecedor
CREATE TABLE public.product_supplier_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  produto_id TEXT NOT NULL,
  fornecedor_id TEXT,
  fornecedor_nome TEXT,
  compra_id TEXT,
  compra_codigo TEXT,
  data_emissao DATE,
  arrival_date DATE,
  lead_time_days INTEGER,
  quantidade NUMERIC,
  valor_custo NUMERIC,
  situacao_final TEXT,
  raw JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_psh_produto ON public.product_supplier_history (produto_id);
CREATE INDEX idx_psh_fornecedor ON public.product_supplier_history (fornecedor_id);
CREATE UNIQUE INDEX idx_psh_unique ON public.product_supplier_history (produto_id, COALESCE(compra_id, ''), COALESCE(fornecedor_id, ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_supplier_history TO authenticated;
GRANT ALL ON public.product_supplier_history TO service_role;

ALTER TABLE public.product_supplier_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read supplier history"
  ON public.product_supplier_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can write supplier history"
  ON public.product_supplier_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Estatísticas agregadas por produto x fornecedor
CREATE TABLE public.product_supplier_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  produto_id TEXT NOT NULL,
  fornecedor_id TEXT,
  fornecedor_nome TEXT,
  purchase_count INTEGER NOT NULL DEFAULT 0,
  last_purchase_at DATE,
  total_qty_purchased NUMERIC,
  avg_lead_time_days NUMERIC,
  median_lead_time_days NUMERIC,
  min_lead_time_days INTEGER,
  max_lead_time_days INTEGER,
  last_unit_cost NUMERIC,
  confidence_level TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_pss_produto ON public.product_supplier_stats (produto_id);
CREATE UNIQUE INDEX idx_pss_unique ON public.product_supplier_stats (produto_id, COALESCE(fornecedor_id, ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_supplier_stats TO authenticated;
GRANT ALL ON public.product_supplier_stats TO service_role;

ALTER TABLE public.product_supplier_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read supplier stats"
  ON public.product_supplier_stats FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can write supplier stats"
  ON public.product_supplier_stats FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_pss_updated_at
  BEFORE UPDATE ON public.product_supplier_stats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();