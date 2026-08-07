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
      AND (auxiliary_document_id IS NOT NULL OR status NOT IN ('failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'OPERATION_HAS_GC_DOCUMENTS';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.partial_writeoff_items
    WHERE operation_id = p_operation_id
      AND (withdrawn_quantity > 0 OR reserved_quantity > 0)
  ) THEN
    RAISE EXCEPTION 'OPERATION_HAS_MOVEMENTS';
  END IF;

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