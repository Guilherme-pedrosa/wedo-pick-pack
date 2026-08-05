ALTER TABLE public.separations
ADD COLUMN IF NOT EXISTS items jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.separations
ADD COLUMN IF NOT EXISTS client_id text;

COMMENT ON COLUMN public.separations.items IS
  'Snapshot das peças conferidas. O técnico vinculado à separação assume estas peças, sem depender de uma leitura futura da OS no GC.';

CREATE INDEX IF NOT EXISTS idx_separations_client_id
ON public.separations (client_id)
WHERE client_id IS NOT NULL;
