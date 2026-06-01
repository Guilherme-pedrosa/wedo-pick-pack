CREATE TABLE public.pedidos_compra (
  gc_id text PRIMARY KEY,
  codigo text NOT NULL DEFAULT '',
  fornecedor_id text NOT NULL DEFAULT '',
  nome_fornecedor text NOT NULL DEFAULT '',
  data_emissao text NOT NULL DEFAULT '',
  situacao_id text NOT NULL DEFAULT '',
  nome_situacao text NOT NULL DEFAULT '',
  numero_nfe text NOT NULL DEFAULT '',
  valor_total numeric NOT NULL DEFAULT 0,
  icms numeric NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedidos_compra TO authenticated;
GRANT ALL ON public.pedidos_compra TO service_role;

ALTER TABLE public.pedidos_compra ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read pedidos_compra"
ON public.pedidos_compra FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated insert pedidos_compra"
ON public.pedidos_compra FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated update pedidos_compra"
ON public.pedidos_compra FOR UPDATE TO authenticated USING (true);

CREATE INDEX idx_pedidos_compra_fornecedor ON public.pedidos_compra (fornecedor_id);
CREATE INDEX idx_pedidos_compra_data ON public.pedidos_compra (data_emissao);