-- Allow duplicated internal/barcode codes coming from ERP and keep search performance with non-unique indexes
DROP INDEX IF EXISTS public.idx_products_index_codigo_barra;
DROP INDEX IF EXISTS public.idx_products_index_codigo_interno;

CREATE INDEX IF NOT EXISTS idx_products_index_codigo_barra
ON public.products_index (codigo_barra)
WHERE codigo_barra IS NOT NULL AND codigo_barra <> '';

CREATE INDEX IF NOT EXISTS idx_products_index_codigo_interno
ON public.products_index (codigo_interno)
WHERE codigo_interno IS NOT NULL AND codigo_interno <> '';

-- Mark orphan running syncs as failed to avoid stale progress rows
UPDATE public.sync_runs
SET status = 'failed',
    finished_at = COALESCE(finished_at, now()),
    notes = COALESCE(notes || E'\n', '') || 'Interrupted before index fix'
WHERE status = 'running' AND finished_at IS NULL;