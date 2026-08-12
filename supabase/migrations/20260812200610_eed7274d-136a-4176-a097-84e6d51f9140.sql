ALTER TABLE public.auvo_customer_links
  ADD COLUMN IF NOT EXISTS orcamento_id text,
  ADD COLUMN IF NOT EXISTS orcamento_codigo text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_by_name text,
  ADD COLUMN IF NOT EXISTS last_orcamento_id text,
  ADD COLUMN IF NOT EXISTS last_orcamento_codigo text,
  ADD COLUMN IF NOT EXISTS last_used_by uuid,
  ADD COLUMN IF NOT EXISTS last_used_by_name text;