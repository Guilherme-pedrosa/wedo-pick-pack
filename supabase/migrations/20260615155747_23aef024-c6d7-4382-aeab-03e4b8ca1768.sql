
CREATE TABLE public.inventory_planning_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  lookback_days integer NOT NULL DEFAULT 365,
  products_analyzed integer NOT NULL DEFAULT 0,
  suggestions_count integer NOT NULL DEFAULT 0,
  total_estimated_value numeric NOT NULL DEFAULT 0,
  errors_count integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_planning_runs TO authenticated;
GRANT ALL ON public.inventory_planning_runs TO service_role;
ALTER TABLE public.inventory_planning_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view planning runs" ON public.inventory_planning_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage planning runs" ON public.inventory_planning_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.inventory_purchase_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.inventory_planning_runs(id) ON DELETE CASCADE,
  produto_id text NOT NULL,
  nome text,
  codigo_interno text,
  grupo text,
  fornecedor_id text,
  fornecedor_nome text,
  valor_custo numeric,
  estoque_atual numeric,
  stock_known boolean NOT NULL DEFAULT false,
  consumo_12m numeric NOT NULL DEFAULT 0,
  consumo_3m numeric NOT NULL DEFAULT 0,
  event_count integer NOT NULL DEFAULT 0,
  source_count integer NOT NULL DEFAULT 0,
  client_count integer NOT NULL DEFAULT 0,
  media_historica_mensal numeric NOT NULL DEFAULT 0,
  media_recente_mensal numeric NOT NULL DEFAULT 0,
  demanda_prevista_mensal numeric NOT NULL DEFAULT 0,
  monthly_std_dev numeric NOT NULL DEFAULT 0,
  cv numeric NOT NULL DEFAULT 0,
  adi numeric NOT NULL DEFAULT 0,
  abc_class text,
  xyz_class text,
  demand_pattern text,
  is_critical boolean NOT NULL DEFAULT false,
  lead_time_days numeric NOT NULL DEFAULT 21,
  safety_stock numeric NOT NULL DEFAULT 0,
  operational_minimum numeric NOT NULL DEFAULT 0,
  reorder_point numeric NOT NULL DEFAULT 0,
  max_stock numeric NOT NULL DEFAULT 0,
  orcamento_qty numeric NOT NULL DEFAULT 0,
  orcamento_ponderado_qty numeric NOT NULL DEFAULT 0,
  pc_aberta_qty numeric NOT NULL DEFAULT 0,
  saldo_projetado numeric,
  qty_sugerida numeric NOT NULL DEFAULT 0,
  risk_score numeric NOT NULL DEFAULT 0,
  motivos jsonb NOT NULL DEFAULT '[]'::jsonb,
  alertas jsonb NOT NULL DEFAULT '[]'::jsonb,
  aprovado boolean NOT NULL DEFAULT false,
  gc_compra_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_purchase_suggestions_run ON public.inventory_purchase_suggestions(run_id);
CREATE INDEX idx_purchase_suggestions_produto ON public.inventory_purchase_suggestions(produto_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_purchase_suggestions TO authenticated;
GRANT ALL ON public.inventory_purchase_suggestions TO service_role;
ALTER TABLE public.inventory_purchase_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view suggestions" ON public.inventory_purchase_suggestions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage suggestions" ON public.inventory_purchase_suggestions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.inventory_policy_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id text NOT NULL UNIQUE,
  criticality text,
  min_qty_override numeric,
  max_qty_override numeric,
  do_not_stock boolean NOT NULL DEFAULT false,
  preferred_supplier_id text,
  lead_time_override_days numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_policy_overrides TO authenticated;
GRANT ALL ON public.inventory_policy_overrides TO service_role;
ALTER TABLE public.inventory_policy_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view overrides" ON public.inventory_policy_overrides FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage overrides" ON public.inventory_policy_overrides FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_inventory_policy_overrides_updated_at
  BEFORE UPDATE ON public.inventory_policy_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
