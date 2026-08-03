CREATE TABLE IF NOT EXISTS public.orcamento_analysis_config (
  id text PRIMARY KEY DEFAULT 'global',
  imposto_pct numeric NOT NULL DEFAULT 14,
  custo_fixo_pct numeric NOT NULL DEFAULT 0,
  garantia_pct numeric NOT NULL DEFAULT 0,
  margem_minima numeric NOT NULL DEFAULT 19,
  margem_meta numeric NOT NULL DEFAULT 30,
  custo_por_km numeric NOT NULL DEFAULT 1.05,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE ON public.orcamento_analysis_config TO authenticated;
GRANT ALL ON public.orcamento_analysis_config TO service_role;

ALTER TABLE public.orcamento_analysis_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read analysis config"
ON public.orcamento_analysis_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert analysis config"
ON public.orcamento_analysis_config FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update analysis config"
ON public.orcamento_analysis_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.orcamento_analysis_config (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;