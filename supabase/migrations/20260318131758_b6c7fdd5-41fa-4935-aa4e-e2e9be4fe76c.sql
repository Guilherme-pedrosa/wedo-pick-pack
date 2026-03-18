
-- Table 1: inventory_policy_config
CREATE TABLE public.inventory_policy_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  lookback_days integer NOT NULL DEFAULT 180,
  abc_thresholds jsonb NOT NULL DEFAULT '{"A":0.80,"B":0.95}'::jsonb,
  vendas_stockout_situacao_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  os_stockout_situacao_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  purchase_lt_start_situacao_id text NOT NULL DEFAULT '1675083',
  purchase_arrived_situacao_ids jsonb NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE public.inventory_policy_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read inventory_policy_config"
  ON public.inventory_policy_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert inventory_policy_config"
  ON public.inventory_policy_config FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update inventory_policy_config"
  ON public.inventory_policy_config FOR UPDATE TO authenticated USING (true);

-- Insert default row
INSERT INTO public.inventory_policy_config (vendas_stockout_situacao_ids)
  VALUES ('["7063585"]'::jsonb);

-- Table 2: doc_stock_effect
CREATE TABLE public.doc_stock_effect (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type text NOT NULL CHECK (doc_type IN ('venda','os')),
  doc_id text NOT NULL,
  debited boolean NOT NULL DEFAULT false,
  debited_at timestamptz NULL,
  debit_situacao_id text NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  payload_hash text NULL,
  UNIQUE (doc_type, doc_id)
);

ALTER TABLE public.doc_stock_effect ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read doc_stock_effect"
  ON public.doc_stock_effect FOR SELECT TO authenticated USING (true);

-- Table 3: inventory_consumption_events
CREATE TABLE public.inventory_consumption_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('venda','os')),
  source_id text NOT NULL,
  situacao_id text NOT NULL,
  produto_id text NOT NULL,
  variacao_id text NULL,
  qty numeric NOT NULL,
  valor_custo numeric NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.inventory_consumption_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read inventory_consumption_events"
  ON public.inventory_consumption_events FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_consumption_occurred_at ON public.inventory_consumption_events (occurred_at);
CREATE INDEX idx_consumption_produto ON public.inventory_consumption_events (produto_id, variacao_id);
