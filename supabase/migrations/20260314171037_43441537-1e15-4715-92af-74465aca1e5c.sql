
-- Enable pg_trgm for trigram text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Products index table
CREATE TABLE public.products_index (
  produto_id text PRIMARY KEY,
  nome text NOT NULL,
  codigo_interno text,
  codigo_barra text,
  possui_variacao boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  fingerprint text NOT NULL,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  payload_min_json jsonb
);

-- Unique partial indexes for non-null codes
CREATE UNIQUE INDEX idx_products_index_codigo_interno ON public.products_index (codigo_interno) WHERE codigo_interno IS NOT NULL AND codigo_interno <> '';
CREATE UNIQUE INDEX idx_products_index_codigo_barra ON public.products_index (codigo_barra) WHERE codigo_barra IS NOT NULL AND codigo_barra <> '';

-- Trigram index for name search
CREATE INDEX idx_products_index_nome_trgm ON public.products_index USING gin (nome gin_trgm_ops);

-- Enable RLS (public read for authenticated, write via service role in edge functions)
ALTER TABLE public.products_index ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read products_index" ON public.products_index FOR SELECT TO authenticated USING (true);

-- Sync runs audit table
CREATE TABLE public.sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL CHECK (run_type IN ('incremental', 'full')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  fetched_count int NOT NULL DEFAULT 0,
  upsert_count int NOT NULL DEFAULT 0,
  errors_count int NOT NULL DEFAULT 0,
  notes text,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'failed'))
);

ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read sync_runs" ON public.sync_runs FOR SELECT TO authenticated USING (true);

-- Product queries for hot set tracking
CREATE TABLE public.product_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'ui_search',
  resolved_produto_id text
);

ALTER TABLE public.product_queries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read product_queries" ON public.product_queries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert product_queries" ON public.product_queries FOR INSERT TO authenticated WITH CHECK (true);

-- Boxes (minimal structure for hot set)
CREATE TABLE public.boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  user_id uuid NOT NULL
);

ALTER TABLE public.boxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read boxes" ON public.boxes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert own boxes" ON public.boxes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own boxes" ON public.boxes FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Box items
CREATE TABLE public.box_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id uuid NOT NULL REFERENCES public.boxes(id) ON DELETE CASCADE,
  produto_id text NOT NULL,
  nome_produto text NOT NULL,
  quantidade int NOT NULL DEFAULT 1,
  added_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.box_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read box_items" ON public.box_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert box_items" ON public.box_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update box_items" ON public.box_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete box_items" ON public.box_items FOR DELETE TO authenticated USING (true);

-- Index for box_items by produto_id for hot set queries
CREATE INDEX idx_box_items_produto_id ON public.box_items (produto_id);
CREATE INDEX idx_product_queries_created_at ON public.product_queries (created_at);
