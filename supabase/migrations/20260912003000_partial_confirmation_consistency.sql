BEGIN;
-- Confirmação idempotente: não mascarar falta de reserva com greatest(0,...).
CREATE OR REPLACE FUNCTION public.partial_writeoff_finish_confirmation(
  p_batch_id uuid, p_success boolean, p_error_message text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL, p_actor_name text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_operation_id uuid; v_status text; v_previous_error text; v_other_error text;
  v_operation_status text;
BEGIN
  SELECT operation_id INTO v_operation_id FROM partial_writeoff_batches WHERE id=p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  PERFORM 1 FROM partial_writeoff_operations WHERE id=v_operation_id FOR UPDATE;
  SELECT status,error_message INTO v_status,v_previous_error FROM partial_writeoff_batches WHERE id=p_batch_id FOR UPDATE;
  IF v_status='confirmed' THEN
    RETURN (SELECT status FROM partial_writeoff_operations WHERE id=v_operation_id);
  END IF;
  IF v_status<>'confirming' THEN RAISE EXCEPTION 'BATCH_NOT_CONFIRMING'; END IF;
  IF p_success IS DISTINCT FROM true THEN
    UPDATE partial_writeoff_batches SET status='reconciliation_required',error_message=left(p_error_message,1000) WHERE id=p_batch_id;
    UPDATE partial_writeoff_operations SET status='reconciliation_required',reconciliation_reason=left(p_error_message,1000),version=version+1 WHERE id=v_operation_id;
    INSERT INTO partial_writeoff_events(operation_id,batch_id,event_type,payload,actor_id,actor_name)
    VALUES(v_operation_id,p_batch_id,'confirmation_reconciliation_required',jsonb_build_object('error',p_error_message),p_actor_id,p_actor_name);
    RETURN 'reconciliation_required';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM partial_writeoff_batch_items WHERE batch_id=p_batch_id)
    OR EXISTS(SELECT 1 FROM partial_writeoff_batch_items bi JOIN partial_writeoff_items i ON i.id=bi.item_id
      WHERE bi.batch_id=p_batch_id AND (i.operation_id<>v_operation_id OR bi.quantity<=0
        OR bi.quantity>i.reserved_quantity OR i.withdrawn_quantity+bi.quantity>i.original_quantity)) THEN
    RAISE EXCEPTION 'BATCH_BALANCE_MISMATCH';
  END IF;
  UPDATE partial_writeoff_items i SET reserved_quantity=i.reserved_quantity-bi.quantity,withdrawn_quantity=i.withdrawn_quantity+bi.quantity
  FROM partial_writeoff_batch_items bi WHERE bi.batch_id=p_batch_id AND bi.item_id=i.id;
  UPDATE partial_writeoff_batches SET status='confirmed',confirmed_at=now(),error_message=NULL WHERE id=p_batch_id;
  SELECT coalesce(error_message,'Confirmação pendente em outro lote') INTO v_other_error FROM partial_writeoff_batches
    WHERE operation_id=v_operation_id AND status='reconciliation_required' ORDER BY sequence LIMIT 1;
  IF v_other_error IS NOT NULL THEN v_operation_status:='reconciliation_required';
  ELSIF EXISTS(SELECT 1 FROM partial_writeoff_batches WHERE operation_id=v_operation_id AND status IN ('creating','awaiting_checkout','confirming')) THEN
    v_operation_status:='partial_separation';
  ELSIF EXISTS(SELECT 1 FROM partial_writeoff_items WHERE operation_id=v_operation_id AND original_quantity>withdrawn_quantity) THEN
    v_operation_status:='awaiting_balance';
  ELSE v_operation_status:='ready_to_consolidate'; END IF;
  UPDATE partial_writeoff_operations SET status=v_operation_status,
    reconciliation_reason=CASE WHEN v_other_error IS NOT NULL THEN v_other_error
      WHEN status='reconciliation_required' OR reconciliation_reason=v_previous_error THEN NULL ELSE reconciliation_reason END,
    version=version+1 WHERE id=v_operation_id;
  INSERT INTO partial_writeoff_events(operation_id,batch_id,event_type,payload,actor_id,actor_name)
    VALUES(v_operation_id,p_batch_id,'batch_confirmed','{}',p_actor_id,p_actor_name);
  RETURN (SELECT status FROM partial_writeoff_operations WHERE id=v_operation_id);
END $$;

-- O botão não pode ocultar erro de um lote ainda pendente no Checkout.
CREATE OR REPLACE FUNCTION public.partial_writeoff_unlock_reconciliation(
 p_operation_id uuid,p_actor_id uuid DEFAULT NULL,p_actor_name text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status text; v_new_status text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT status INTO v_status FROM partial_writeoff_operations WHERE id=p_operation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OPERATION_NOT_FOUND'; END IF;
 IF v_status<>'reconciliation_required' THEN RAISE EXCEPTION 'OPERATION_NOT_IN_RECONCILIATION:%',v_status; END IF;
 IF EXISTS(SELECT 1 FROM partial_writeoff_batches WHERE operation_id=p_operation_id AND status IN ('creating','confirming')) THEN RAISE EXCEPTION 'BATCH_IN_PROGRESS'; END IF;
 IF EXISTS(SELECT 1 FROM partial_writeoff_batches WHERE operation_id=p_operation_id AND status='reconciliation_required') THEN
   RAISE EXCEPTION 'Retome o lote pendente no Checkout ou audite o documento no GC antes de desbloquear a operação.';
 END IF;
 SELECT CASE WHEN bool_and(withdrawn_quantity>=original_quantity AND reserved_quantity=0) THEN 'ready_to_consolidate'
   WHEN bool_or(withdrawn_quantity>0) THEN 'awaiting_balance' ELSE 'awaiting_separation' END INTO v_new_status
 FROM partial_writeoff_items WHERE operation_id=p_operation_id;
 UPDATE partial_writeoff_operations SET status=coalesce(v_new_status,'awaiting_separation'),reconciliation_reason=NULL,version=version+1 WHERE id=p_operation_id;
 INSERT INTO partial_writeoff_events(operation_id,event_type,payload,actor_id,actor_name)
 VALUES(p_operation_id,'reconciliation_unlocked',jsonb_build_object('previous_status',v_status,'new_status',v_new_status),auth.uid(),p_actor_name);
 RETURN (SELECT status FROM partial_writeoff_operations WHERE id=p_operation_id);
END $$;

-- Somente estados comprovados pelos lotes; quantidades e documentos não mudam.
WITH affected AS (
 SELECT o.id,o.status,o.reconciliation_reason,b.error_message FROM partial_writeoff_operations o
 JOIN LATERAL (SELECT error_message FROM partial_writeoff_batches WHERE operation_id=o.id AND status='reconciliation_required' ORDER BY sequence LIMIT 1) b ON true
 WHERE o.status IN ('awaiting_separation','partial_separation','awaiting_balance')
), logged AS (
 INSERT INTO partial_writeoff_events(operation_id,event_type,payload)
 SELECT id,'audit_pending_confirmation_state',jsonb_build_object('previous_status',status,'previous_reason',reconciliation_reason) FROM affected RETURNING operation_id
)
UPDATE partial_writeoff_operations o SET status='reconciliation_required',reconciliation_reason=coalesce(a.error_message,'Confirmação pendente no Checkout'),version=version+1
FROM affected a JOIN logged l ON l.operation_id=a.id WHERE o.id=a.id;
WITH affected AS (
 SELECT o.id,o.reconciliation_reason FROM partial_writeoff_operations o
 WHERE o.budget_code='6438' AND o.status='awaiting_execution'
 AND o.reconciliation_reason LIKE '%397920118%73897%'
 AND NOT EXISTS(SELECT 1 FROM partial_writeoff_batches b WHERE b.operation_id=o.id AND b.status NOT IN ('confirmed','cancelled'))
), logged AS (
 INSERT INTO partial_writeoff_events(operation_id,event_type,payload)
 SELECT id,'audit_resolved_confirmation_message',jsonb_build_object('previous_reason',reconciliation_reason) FROM affected RETURNING operation_id
)
UPDATE partial_writeoff_operations o SET reconciliation_reason=NULL,version=version+1 FROM logged l WHERE o.id=l.operation_id;

-- Rotinas de cancelamento/exclusão tinham EXECUTE anônimo apesar de SECURITY DEFINER.
REVOKE EXECUTE ON FUNCTION public.partial_writeoff_cancel_batch(uuid,uuid,text,text),
 public.partial_writeoff_cancel_operation(uuid,uuid,text,text),public.partial_writeoff_delete_operation(uuid,uuid,text),
 public.partial_writeoff_force_cancel_operation(uuid,uuid,text,text),public.partial_writeoff_force_delete_operation(uuid,uuid,text)
 FROM PUBLIC,anon;
COMMIT;
