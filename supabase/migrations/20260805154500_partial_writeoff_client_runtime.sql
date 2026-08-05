-- Permite que o fluxo de baixa parcial seja orquestrado pelo cliente autenticado
-- usando somente Edge Functions que já existem no Lovable Cloud. As regras de
-- concorrência, idempotência e consistência continuam centralizadas nas RPCs.

GRANT EXECUTE ON FUNCTION public.partial_writeoff_open_operation(jsonb, text, jsonb, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_reserve_batch(uuid, text, jsonb, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_release_batch(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_attach_auxiliary(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_claim_confirmation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_finish_confirmation(uuid, boolean, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_claim_consolidation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_finish_consolidation(uuid, boolean, text, text, text, text, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.partial_writeoff_mark_batch_reconciliation(
  p_batch_id uuid,
  p_error_message text,
  p_document jsonb DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL,
  p_actor_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operation_id uuid;
  v_document_id text;
  v_document_code text;
BEGIN
  SELECT operation_id INTO v_operation_id
  FROM public.partial_writeoff_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF v_operation_id IS NULL THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND';
  END IF;

  v_document_id := NULLIF(coalesce(p_document ->> 'id', ''), '');
  v_document_code := NULLIF(coalesce(p_document ->> 'codigo', ''), '');

  UPDATE public.partial_writeoff_batches
  SET status = 'reconciliation_required',
      error_message = left(p_error_message, 1000),
      auxiliary_document_id = coalesce(v_document_id, auxiliary_document_id),
      auxiliary_document_code = coalesce(v_document_code, auxiliary_document_code),
      gc_create_response = coalesce(p_document, gc_create_response)
  WHERE id = p_batch_id;

  UPDATE public.partial_writeoff_operations
  SET status = 'reconciliation_required',
      reconciliation_reason = left(p_error_message, 1000),
      version = version + 1
  WHERE id = v_operation_id;

  INSERT INTO public.partial_writeoff_events (
    operation_id, batch_id, event_type, payload, actor_id, actor_name
  ) VALUES (
    v_operation_id,
    p_batch_id,
    'batch_reconciliation_required',
    jsonb_build_object(
      'error', p_error_message,
      'document_id', v_document_id,
      'document_code', v_document_code
    ),
    p_actor_id,
    p_actor_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.partial_writeoff_reset_consolidation(
  p_operation_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_actor_name text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM public.partial_writeoff_operations
  WHERE id = p_operation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'OPERATION_NOT_FOUND';
  END IF;
  IF v_status = 'ready_to_consolidate' THEN
    RETURN v_status;
  END IF;
  IF v_status <> 'consolidating' THEN
    RAISE EXCEPTION 'OPERATION_NOT_CONSOLIDATING:%', v_status;
  END IF;

  UPDATE public.partial_writeoff_operations
  SET status = 'ready_to_consolidate',
      reconciliation_reason = NULL,
      version = version + 1
  WHERE id = p_operation_id;

  INSERT INTO public.partial_writeoff_events (
    operation_id, event_type, actor_id, actor_name
  ) VALUES (
    p_operation_id, 'consolidation_compensated', p_actor_id, p_actor_name
  );
  RETURN 'ready_to_consolidate';
END;
$$;

REVOKE ALL ON FUNCTION public.partial_writeoff_mark_batch_reconciliation(uuid, text, jsonb, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partial_writeoff_reset_consolidation(uuid, uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.partial_writeoff_mark_batch_reconciliation(uuid, text, jsonb, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_reset_consolidation(uuid, uuid, text) TO authenticated, service_role;
