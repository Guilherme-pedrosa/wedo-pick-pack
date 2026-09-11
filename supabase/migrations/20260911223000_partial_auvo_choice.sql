BEGIN;

-- Existing task choices/history are unknown: never rewrite them as opt-outs.
ALTER TABLE public.partial_writeoff_batches ADD COLUMN IF NOT EXISTS auvo_task_requested boolean;
COMMENT ON COLUMN public.partial_writeoff_batches.auvo_task_requested IS 'Choice for this OS: true=requested, false=opted out, NULL=legacy lot';

CREATE OR REPLACE FUNCTION public.partial_writeoff_reserve_batch_with_options(
  p_operation_id uuid, p_idempotency_key text, p_items jsonb,
  p_create_auvo_task boolean DEFAULT false, p_actor_id uuid DEFAULT NULL, p_actor_name text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result jsonb; v_batch public.partial_writeoff_batches; v_type text; v_choice boolean;
BEGIN
  -- Serialize retries before delegating to the existing global stock guard.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 98721));
  SELECT document_type INTO v_type FROM public.partial_writeoff_operations WHERE id=p_operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPERATION_NOT_FOUND'; END IF;
  v_choice := CASE WHEN v_type='os' THEN coalesce(p_create_auvo_task,false) ELSE NULL END;
  IF v_choice AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=coalesce(auth.uid(),p_actor_id) AND coalesce(auvo_user_id::text,'') NOT IN ('','0')) THEN
    RAISE EXCEPTION 'Configure o usuário Auvo no seu perfil antes de solicitar a tarefa.';
  END IF;
  v_result := public.partial_writeoff_reserve_batch(p_operation_id,p_idempotency_key,p_items,p_actor_id,p_actor_name);
  SELECT * INTO v_batch FROM public.partial_writeoff_batches WHERE id=(v_result->>'batch_id')::uuid FOR UPDATE;
  IF v_batch.operation_id<>p_operation_id THEN RAISE EXCEPTION 'BATCH_OPERATION_MISMATCH'; END IF;
  IF (v_result->>'existing')::boolean THEN
    IF v_batch.auvo_task_requested IS DISTINCT FROM v_choice THEN
      RAISE EXCEPTION 'A escolha Auvo deste lote já foi registrada. Não altere a opção ao repetir a mesma abertura.';
    END IF;
  ELSE
    UPDATE public.partial_writeoff_batches SET auvo_task_requested=v_choice WHERE id=v_batch.id;
    INSERT INTO public.partial_writeoff_events(operation_id,batch_id,event_type,payload,actor_id,actor_name)
      VALUES(p_operation_id,v_batch.id,'auvo_task_choice',jsonb_build_object('requested',v_choice),p_actor_id,p_actor_name);
  END IF;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.partial_writeoff_reserve_batch_with_options(uuid,text,jsonb,boolean,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_reserve_batch_with_options(uuid,text,jsonb,boolean,uuid,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.partial_writeoff_guard_requested_auvo() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.status IN ('consolidating','completed') AND EXISTS (
    SELECT 1 FROM public.partial_writeoff_batches WHERE operation_id=NEW.id AND confirmed_at IS NOT NULL
      AND status NOT IN ('cancelled','failed') AND auvo_task_requested IS TRUE AND nullif(auvo_task_id,'') IS NULL
  ) THEN RAISE EXCEPTION 'A tarefa Auvo solicitada para uma OS parcial ainda está pendente. Gere a tarefa no histórico antes de consolidar.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS partial_writeoff_requested_auvo_guard ON public.partial_writeoff_operations;
CREATE TRIGGER partial_writeoff_requested_auvo_guard BEFORE UPDATE OF status ON public.partial_writeoff_operations
FOR EACH ROW EXECUTE FUNCTION public.partial_writeoff_guard_requested_auvo();
COMMIT;
