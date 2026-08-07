ALTER TABLE public.partial_writeoff_batches
  ADD COLUMN IF NOT EXISTS auvo_task_id text,
  ADD COLUMN IF NOT EXISTS auvo_task_error text;

ALTER TABLE public.os_generation_logs
  ADD COLUMN IF NOT EXISTS partial_auxiliaries jsonb;