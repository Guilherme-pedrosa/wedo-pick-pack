CREATE OR REPLACE FUNCTION public.partial_writeoff_force_cancel_operation(
  p_operation_id uuid,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_actor_name text DEFAULT NULL::text,
  p_reason text DEFAULT NULL::text
)
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

  IF v_status IS NULL THEN RAISE EXCEPTION 'OPERATION_NOT_FOUND'; END IF;
  IF v_status = 'cancelled' THEN RETURN 'cancelled'; END IF;
  IF v_status = 'completed' THEN RAISE EXCEPTION 'OPERATION_ALREADY_COMPLETED'; END IF;

  UPDATE public.partial_writeoff_batches
  SET status = 'cancelled',
      error_message = left(coalesce(p_reason, 'Cancelamento forçado da baixa parcial'), 500),
      updated_at = now()
  WHERE operation_id = p_operation_id
    AND status NOT IN ('cancelled', 'failed');

  UPDATE public.partial_writeoff_items
  SET reserved_quantity = 0,
      updated_at = now()
  WHERE operation_id = p_operation_id
    AND reserved_quantity > 0;

  UPDATE public.partial_writeoff_operations
  SET status = 'cancelled',
      reconciliation_reason = NULL,
      completed_at = now(),
      version = version + 1
  WHERE id = p_operation_id;

  INSERT INTO public.partial_writeoff_events (operation_id, event_type, payload, actor_id, actor_name)
  VALUES (
    p_operation_id,
    'operation_force_cancelled',
    jsonb_build_object('reason', left(coalesce(p_reason, ''), 500), 'previous_status', v_status),
    p_actor_id,
    p_actor_name
  );

  RETURN 'cancelled';
END;
$function$;

CREATE OR REPLACE FUNCTION public.partial_writeoff_force_delete_operation(
  p_operation_id uuid,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_actor_name text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.partial_writeoff_operations WHERE id = p_operation_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'OPERATION_NOT_FOUND'; END IF;
  IF v_status = 'completed' THEN RAISE EXCEPTION 'OPERATION_ALREADY_COMPLETED'; END IF;

  DELETE FROM public.inventory_consumption_events e
  USING public.partial_writeoff_batches b
  WHERE b.operation_id = p_operation_id
    AND b.auxiliary_document_id IS NOT NULL
    AND e.source_type = b.auxiliary_document_type
    AND e.source_id = b.auxiliary_document_id;

  DELETE FROM public.doc_stock_effect d
  USING public.partial_writeoff_batches b
  WHERE b.operation_id = p_operation_id
    AND b.auxiliary_document_id IS NOT NULL
    AND d.doc_type = b.auxiliary_document_type
    AND d.doc_id = b.auxiliary_document_id;

  DELETE FROM public.partial_writeoff_batch_items bi
  USING public.partial_writeoff_batches b
  WHERE bi.batch_id = b.id AND b.operation_id = p_operation_id;

  DELETE FROM public.partial_writeoff_events WHERE operation_id = p_operation_id;
  DELETE FROM public.partial_writeoff_batches WHERE operation_id = p_operation_id;
  DELETE FROM public.partial_writeoff_items WHERE operation_id = p_operation_id;
  DELETE FROM public.partial_writeoff_operations WHERE id = p_operation_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.partial_writeoff_force_cancel_operation(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_force_cancel_operation(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_force_delete_operation(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_force_delete_operation(uuid, uuid, text) TO service_role;