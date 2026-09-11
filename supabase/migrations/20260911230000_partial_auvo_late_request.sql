BEGIN;

-- New openings request an Auvo task unless the operator explicitly opts out.
-- Existing batches keep the choice recorded when they were opened.
CREATE OR REPLACE FUNCTION public.partial_writeoff_reserve_batch_with_options(
  p_operation_id uuid, p_idempotency_key text, p_items jsonb,
  p_create_auvo_task boolean DEFAULT true, p_actor_id uuid DEFAULT NULL, p_actor_name text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result jsonb; v_batch public.partial_writeoff_batches; v_type text; v_choice boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 98721));
  SELECT document_type INTO v_type FROM public.partial_writeoff_operations WHERE id=p_operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPERATION_NOT_FOUND'; END IF;
  v_choice := CASE WHEN v_type='os' THEN coalesce(p_create_auvo_task,true) ELSE NULL END;
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

-- A separate, authenticated action records a later request without rewriting
-- the opening event, reserving stock again or touching any GC document.
CREATE OR REPLACE FUNCTION public.partial_writeoff_request_auvo_task(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid(); v_actor_name text; v_operation_id uuid;
  v_operation public.partial_writeoff_operations; v_batch public.partial_writeoff_batches;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT operation_id INTO v_operation_id FROM public.partial_writeoff_batches WHERE id=p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  -- Match the operation -> batch lock order used by stock/consolidation RPCs.
  SELECT * INTO v_operation FROM public.partial_writeoff_operations WHERE id=v_operation_id FOR UPDATE;
  SELECT * INTO v_batch FROM public.partial_writeoff_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  IF nullif(v_batch.auvo_task_id,'') IS NOT NULL THEN
    RETURN jsonb_build_object('batch_id',v_batch.id,'auvo_task_id',v_batch.auvo_task_id,'requested',v_batch.auvo_task_requested);
  END IF;
  IF v_operation.status IN ('completed','cancelled','consolidating') OR v_operation.definitive_document_id IS NOT NULL
     OR v_batch.status NOT IN ('awaiting_checkout','confirmed') OR nullif(v_batch.auxiliary_document_id,'') IS NULL THEN
    RAISE EXCEPTION 'O lote não está disponível para criar tarefa Auvo.';
  END IF;
  SELECT name INTO v_actor_name FROM public.profiles
    WHERE id=v_actor AND coalesce(auvo_user_id::text,'') NOT IN ('','0');
  IF NOT FOUND THEN RAISE EXCEPTION 'Configure o usuário Auvo no seu perfil antes de solicitar a tarefa.'; END IF;
  IF v_batch.auvo_task_requested IS DISTINCT FROM true THEN
    UPDATE public.partial_writeoff_batches SET auvo_task_requested=true WHERE id=v_batch.id;
    INSERT INTO public.partial_writeoff_events(operation_id,batch_id,event_type,payload,actor_id,actor_name)
      VALUES(v_operation.id,v_batch.id,'auvo_task_requested_later',
        jsonb_build_object('requested',true,'previous_requested',v_batch.auvo_task_requested,
          'source','batch_history','document_code',v_batch.auxiliary_document_code),v_actor,v_actor_name);
  END IF;
  RETURN jsonb_build_object('batch_id',v_batch.id,'auvo_task_id',NULL,'requested',true);
END $$;
REVOKE ALL ON FUNCTION public.partial_writeoff_reserve_batch_with_options(uuid,text,jsonb,boolean,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_reserve_batch_with_options(uuid,text,jsonb,boolean,uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.partial_writeoff_request_auvo_task(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_request_auvo_task(uuid) TO authenticated,service_role;
COMMIT;
