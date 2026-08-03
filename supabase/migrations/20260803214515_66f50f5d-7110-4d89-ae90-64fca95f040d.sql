ALTER TABLE public.orcamento_analysis_config
  ADD COLUMN IF NOT EXISTS alimentacao_dia numeric NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS mo_admin_hora numeric NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS mo_admin_horas_padrao numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS premiacao_peca_pct numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS premiacao_servico_pct numeric NOT NULL DEFAULT 15;