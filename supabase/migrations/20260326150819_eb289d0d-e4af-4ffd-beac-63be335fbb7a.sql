CREATE TABLE public.compras_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  total_produtos_sem_estoque integer NOT NULL DEFAULT 0,
  total_produtos_ok integer NOT NULL DEFAULT 0,
  total_itens_cobertos_pedido integer NOT NULL DEFAULT 0,
  total_orcamentos integer NOT NULL DEFAULT 0,
  estimativa_total numeric NOT NULL DEFAULT 0,
  orcamentos_convertidos_count integer NOT NULL DEFAULT 0,
  itens_list jsonb NOT NULL DEFAULT '[]'::jsonb,
  config_used jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'success',
  error_message text,
  duration_ms integer
);

ALTER TABLE public.compras_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read compras_snapshots"
  ON public.compras_snapshots FOR SELECT TO authenticated
  USING (true);