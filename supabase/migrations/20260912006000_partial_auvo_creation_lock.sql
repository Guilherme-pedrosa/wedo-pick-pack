BEGIN;
ALTER TABLE public.partial_writeoff_batches ADD COLUMN IF NOT EXISTS auvo_creation_started_at timestamptz;
CREATE OR REPLACE FUNCTION public.partial_writeoff_claim_auvo_creation(p_batch_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b partial_writeoff_batches;
BEGIN
 SELECT * INTO b FROM partial_writeoff_batches WHERE id=p_batch_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
 IF b.auvo_task_id IS NOT NULL THEN RETURN b.auvo_task_id; END IF;
 IF b.status NOT IN ('awaiting_checkout','confirmed') OR b.auvo_task_requested IS FALSE THEN RAISE EXCEPTION 'BATCH_TASK_NOT_ALLOWED'; END IF;
 IF b.auvo_creation_started_at IS NOT NULL THEN RAISE EXCEPTION 'Criação Auvo já iniciada. Confira a tarefa antes de repetir para evitar duplicidade.'; END IF;
 UPDATE partial_writeoff_batches SET auvo_creation_started_at=now() WHERE id=p_batch_id;
 RETURN 'claimed';
END $$;
REVOKE ALL ON FUNCTION public.partial_writeoff_claim_auvo_creation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_claim_auvo_creation(uuid) TO service_role;
COMMIT;
