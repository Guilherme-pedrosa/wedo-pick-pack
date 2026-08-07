CREATE OR REPLACE FUNCTION public.partial_writeoff_delete_operation(p_operation_id uuid, p_actor_id uuid DEFAULT NULL::uuid, p_actor_name text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_withdrawn numeric;
BEGIN
  SELECT status INTO v_status FROM public.partial_writeoff_operations WHERE id = p_operation_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'OPERATION_NOT_FOUND';
  END IF;
  IF v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'OPERATION_NOT_DELETABLE';
  END IF;

  SELECT COALESCE(SUM(withdrawn_quantity), 0) INTO v_withdrawn
  FROM public.partial_writeoff_items WHERE operation_id = p_operation_id;
  IF v_withdrawn > 0 THEN
    RAISE EXCEPTION 'OPERATION_HAS_WITHDRAWALS';
  END IF;

  DELETE FROM public.partial_writeoff_batch_items bi
  USING public.partial_writeoff_batches b
  WHERE bi.batch_id = b.id AND b.operation_id = p_operation_id;

  DELETE FROM public.partial_writeoff_events WHERE operation_id = p_operation_id;
  DELETE FROM public.partial_writeoff_batches WHERE operation_id = p_operation_id;
  DELETE FROM public.partial_writeoff_items WHERE operation_id = p_operation_id;
  DELETE FROM public.partial_writeoff_operations WHERE id = p_operation_id;
END;
$function$;