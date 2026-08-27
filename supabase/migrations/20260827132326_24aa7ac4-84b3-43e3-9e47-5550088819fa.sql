CREATE OR REPLACE FUNCTION public.partial_writeoff_finish_consolidation(p_operation_id uuid, p_success boolean, p_document_id text DEFAULT NULL::text, p_document_code text DEFAULT NULL::text, p_auvo_task_id text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid, p_actor_name text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM public.partial_writeoff_operations
  WHERE id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPERATION_NOT_FOUND'; END IF;
  IF v_status = 'completed' THEN RETURN 'completed'; END IF;
  IF v_status <> 'consolidating' THEN RAISE EXCEPTION 'OPERATION_NOT_CONSOLIDATING:%', v_status; END IF;

  IF p_success THEN
    UPDATE public.partial_writeoff_operations
    SET status = 'completed',
        definitive_document_id = p_document_id,
        definitive_document_code = p_document_code,
        definitive_auvo_task_id = p_auvo_task_id,
        reconciliation_reason = NULL,
        completed_at = now(),
        version = version + 1
    WHERE id = p_operation_id;
    UPDATE public.partial_writeoff_batches
    SET status = 'consolidated'
    WHERE operation_id = p_operation_id AND status IN ('confirmed', 'cancelled');
    INSERT INTO public.partial_writeoff_events (
      operation_id, event_type, payload, actor_id, actor_name
    ) VALUES (
      p_operation_id, 'consolidation_completed', jsonb_build_object(
        'document_id', p_document_id,
        'document_code', p_document_code,
        'auvo_task_id', p_auvo_task_id
      ), p_actor_id, p_actor_name
    );
    RETURN 'completed';
  END IF;

  UPDATE public.partial_writeoff_operations
  SET status = 'reconciliation_required',
      reconciliation_reason = left(p_error_message, 1000),
      definitive_document_id = coalesce(p_document_id, definitive_document_id),
      definitive_document_code = coalesce(p_document_code, definitive_document_code),
      definitive_auvo_task_id = coalesce(p_auvo_task_id, definitive_auvo_task_id),
      version = version + 1
  WHERE id = p_operation_id;
  INSERT INTO public.partial_writeoff_events (
    operation_id, event_type, payload, actor_id, actor_name
  ) VALUES (
    p_operation_id, 'consolidation_reconciliation_required',
    jsonb_build_object(
      'error', p_error_message,
      'document_id', p_document_id,
      'document_code', p_document_code,
      'auvo_task_id', p_auvo_task_id
    ), p_actor_id, p_actor_name
  );
  RETURN 'reconciliation_required';
END;
$function$;

CREATE OR REPLACE FUNCTION public.partial_writeoff_unlock_reconciliation(p_operation_id uuid, p_actor_id uuid DEFAULT NULL::uuid, p_actor_name text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_new_status text;
  v_all_withdrawn boolean;
  v_any_withdrawn boolean;
BEGIN
  SELECT status INTO v_status
  FROM public.partial_writeoff_operations
  WHERE id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPERATION_NOT_FOUND'; END IF;
  IF v_status <> 'reconciliation_required' THEN
    RAISE EXCEPTION 'OPERATION_NOT_IN_RECONCILIATION:%', v_status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.partial_writeoff_batches
    WHERE operation_id = p_operation_id AND status IN ('creating', 'confirming')
  ) THEN
    RAISE EXCEPTION 'BATCH_IN_PROGRESS';
  END IF;

  SELECT
    coalesce(bool_and(withdrawn_quantity >= original_quantity AND reserved_quantity = 0), false),
    coalesce(bool_or(withdrawn_quantity > 0), false)
  INTO v_all_withdrawn, v_any_withdrawn
  FROM public.partial_writeoff_items
  WHERE operation_id = p_operation_id;

  IF v_all_withdrawn THEN
    v_new_status := 'ready_to_consolidate';
  ELSIF v_any_withdrawn THEN
    v_new_status := 'awaiting_balance';
  ELSE
    v_new_status := 'awaiting_separation';
  END IF;

  UPDATE public.partial_writeoff_operations
  SET status = v_new_status,
      reconciliation_reason = NULL,
      version = version + 1
  WHERE id = p_operation_id;

  INSERT INTO public.partial_writeoff_events (
    operation_id, event_type, payload, actor_id, actor_name
  ) VALUES (
    p_operation_id, 'reconciliation_unlocked',
    jsonb_build_object('previous_status', v_status, 'new_status', v_new_status),
    p_actor_id, p_actor_name
  );

  RETURN v_new_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.partial_writeoff_unlock_reconciliation(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partial_writeoff_unlock_reconciliation(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_unlock_reconciliation(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_unlock_reconciliation(uuid, uuid, text) TO service_role;