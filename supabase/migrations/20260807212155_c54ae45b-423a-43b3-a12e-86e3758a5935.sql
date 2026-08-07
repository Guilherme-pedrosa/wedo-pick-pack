CREATE OR REPLACE FUNCTION public.partial_writeoff_cancel_batch(
  p_batch_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_actor_name text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_operation_id uuid;
  v_status text;
  v_op_status text;
  v_has_withdrawn boolean;
BEGIN
  SELECT operation_id, status INTO v_operation_id, v_status
  FROM public.partial_writeoff_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF v_operation_id IS NULL THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  IF v_status = 'cancelled' THEN RETURN 'cancelled'; END IF;
  IF v_status = 'confirmed' THEN RAISE EXCEPTION 'BATCH_ALREADY_CONFIRMED'; END IF;

  UPDATE public.partial_writeoff_items i
  SET reserved_quantity = GREATEST(0, i.reserved_quantity - bi.quantity),
      updated_at = now()
  FROM public.partial_writeoff_batch_items bi
  WHERE bi.batch_id = p_batch_id
    AND bi.item_id = i.id;

  UPDATE public.partial_writeoff_batches
  SET status = 'cancelled',
      error_message = left(coalesce(p_reason, 'Documento auxiliar cancelado no GestaoClick'), 500),
      updated_at = now()
  WHERE id = p_batch_id;

  SELECT status INTO v_op_status
  FROM public.partial_writeoff_operations
  WHERE id = v_operation_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.partial_writeoff_items
    WHERE operation_id = v_operation_id AND withdrawn_quantity > 0
  ) INTO v_has_withdrawn;

  IF v_op_status NOT IN ('completed', 'cancelled', 'consolidating') THEN
    UPDATE public.partial_writeoff_operations
    SET status = CASE WHEN v_has_withdrawn THEN 'partial_separation' ELSE 'awaiting_separation' END,
        version = version + 1,
        updated_at = now()
    WHERE id = v_operation_id;
  END IF;

  INSERT INTO public.partial_writeoff_events (operation_id, event_type, payload, actor_id, actor_name)
  VALUES (
    v_operation_id,
    'batch_cancelled',
    jsonb_build_object('batch_id', p_batch_id, 'reason', left(coalesce(p_reason, ''), 500)),
    p_actor_id,
    p_actor_name
  );

  RETURN 'cancelled';
END;
$$;

GRANT EXECUTE ON FUNCTION public.partial_writeoff_cancel_batch(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_cancel_batch(uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.partial_writeoff_cancel_operation(
  p_operation_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_actor_name text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM public.partial_writeoff_operations
  WHERE id = p_operation_id
  FOR UPDATE;

  IF v_status IS NULL THEN RAISE EXCEPTION 'OPERATION_NOT_FOUND'; END IF;
  IF v_status = 'cancelled' THEN RETURN 'cancelled'; END IF;
  IF v_status IN ('completed', 'consolidating') THEN
    RAISE EXCEPTION 'OPERATION_NOT_CANCELLABLE:%', v_status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.partial_writeoff_batches
    WHERE operation_id = p_operation_id
      AND status NOT IN ('failed', 'cancelled')
      AND (auxiliary_document_id IS NOT NULL OR status = 'confirmed')
  ) THEN
    RAISE EXCEPTION 'OPERATION_HAS_GC_DOCUMENTS';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.partial_writeoff_items
    WHERE operation_id = p_operation_id
      AND withdrawn_quantity > 0
  ) THEN
    RAISE EXCEPTION 'OPERATION_HAS_MOVEMENTS';
  END IF;

  UPDATE public.partial_writeoff_batches
  SET status = 'cancelled',
      updated_at = now()
  WHERE operation_id = p_operation_id
    AND status NOT IN ('failed', 'cancelled', 'confirmed');

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
  VALUES (p_operation_id, 'operation_cancelled', jsonb_build_object('reason', left(coalesce(p_reason, ''), 500)), p_actor_id, p_actor_name);

  RETURN 'cancelled';
END;
$$;

GRANT EXECUTE ON FUNCTION public.partial_writeoff_cancel_operation(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_cancel_operation(uuid, uuid, text, text) TO service_role;