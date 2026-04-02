ALTER TABLE public.inventory_policy_config
ADD COLUMN budget_crossref_situacao_ids jsonb NOT NULL DEFAULT '[]'::jsonb;