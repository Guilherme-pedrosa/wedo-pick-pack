BEGIN;
-- Record an already-applied GC movement locally; this RPC never calls the ERP.
CREATE OR REPLACE FUNCTION public.partial_writeoff_reconcile_gc_debit(
  p_batch_id uuid, p_gc_document jsonb, p_source_budget jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid(); v_actor_name text; v_operation_id uuid; v_status text;
  v_operation public.partial_writeoff_operations; v_batch public.partial_writeoff_batches;
  v_expected jsonb; v_actual jsonb; v_before_items jsonb; v_source_id text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT name INTO v_actor_name FROM public.profiles WHERE id=v_actor;
  SELECT operation_id INTO v_operation_id FROM public.partial_writeoff_batches WHERE id=p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.partial_writeoff_operations WHERE id=v_operation_id FOR UPDATE;
  SELECT * INTO v_batch FROM public.partial_writeoff_batches WHERE id=p_batch_id FOR UPDATE;
  IF v_batch.status='confirmed' THEN
    RETURN jsonb_build_object('batch_id',p_batch_id,'already_confirmed',true,'status',v_operation.status);
  END IF;
  IF v_operation.status IN ('cancelled','completed','consolidating')
     OR v_operation.definitive_document_id IS NOT NULL
     OR v_batch.status NOT IN ('awaiting_checkout','reconciliation_required') THEN
    RAISE EXCEPTION 'BATCH_NOT_RECONCILABLE';
  END IF;
  IF coalesce(p_gc_document->>'situacao_estoque','') <> '1' THEN RAISE EXCEPTION 'GC_STOCK_NOT_APPLIED'; END IF;
  IF coalesce(p_gc_document->>'id','') <> coalesce(v_batch.auxiliary_document_id,'')
     OR coalesce(v_batch.auxiliary_document_id,'')=''
     OR coalesce(p_gc_document->>'codigo','') <> coalesce(v_batch.auxiliary_document_code,'')
     OR coalesce(p_gc_document->>'cliente_id','') <> v_operation.client_id
     OR position(v_batch.marker IN concat(p_gc_document->>'observacoes', ' ', p_gc_document->>'observacoes_interna'))=0 THEN
    RAISE EXCEPTION 'GC_DOCUMENT_IDENTITY_CHANGED';
  END IF;
  IF EXISTS (SELECT 1 FROM partial_writeoff_settings s WHERE s.singleton
    AND p_gc_document->>'situacao_id'=CASE WHEN v_batch.auxiliary_document_type='os' THEN s.os_cancel_status_id ELSE s.venda_cancel_status_id END)
    OR upper(coalesce(p_gc_document->>'nome_situacao','')) LIKE '%CANCELAD%' THEN
    RAISE EXCEPTION 'GC_DOCUMENT_CANCELLED';
  END IF;
  v_source_id := coalesce(nullif(v_operation.budget_snapshot->>'_partial_source_id',''),
    nullif(v_operation.budget_snapshot->>'id',''), v_operation.budget_id);
  IF coalesce(p_source_budget->>'id','') <> v_source_id THEN RAISE EXCEPTION 'BUDGET_IDENTITY_CHANGED'; END IF;
  PERFORM 1 FROM partial_writeoff_items WHERE operation_id=v_operation.id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM partial_writeoff_batch_items WHERE batch_id=p_batch_id)
     OR EXISTS (SELECT 1 FROM partial_writeoff_batch_items bi JOIN partial_writeoff_items i ON i.id=bi.item_id
       WHERE bi.batch_id=p_batch_id AND (i.operation_id<>v_operation.id OR i.reserved_quantity<bi.quantity
         OR i.withdrawn_quantity+bi.quantity>i.original_quantity)) THEN
    RAISE EXCEPTION 'BATCH_BALANCE_CHANGED';
  END IF;
  SELECT jsonb_object_agg(k,q) INTO v_expected FROM (
    SELECT i.product_id || '::' || coalesce(nullif(i.variation_id,'0'),'') k, sum(bi.quantity) q
    FROM partial_writeoff_batch_items bi JOIN partial_writeoff_items i ON i.id=bi.item_id
    WHERE bi.batch_id=p_batch_id GROUP BY 1
  ) expected;
  IF jsonb_typeof(p_gc_document->'produtos') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'AUXILIARY_ITEMS_CHANGED'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_gc_document->'produtos') line
    WHERE coalesce(coalesce(line->'produto',line)->>'movimenta_estoque','1')='0') THEN
    RAISE EXCEPTION 'GC_ITEM_STOCK_NOT_APPLIED';
  END IF;
  SELECT jsonb_object_agg(k,q) INTO v_actual FROM (
    SELECT (p->>'produto_id') || '::' || coalesce(nullif(p->>'variacao_id','0'),'') k,
      sum((p->>'quantidade')::numeric) q
    FROM (SELECT coalesce(line->'produto',line) p FROM jsonb_array_elements(p_gc_document->'produtos') line) products
    GROUP BY 1
  ) actual;
  IF v_actual IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'AUXILIARY_ITEMS_CHANGED'; END IF;
  SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) INTO v_before_items FROM partial_writeoff_items i WHERE operation_id=v_operation.id;
  INSERT INTO partial_writeoff_events(operation_id,batch_id,event_type,payload,actor_id,actor_name)
    VALUES(v_operation.id,p_batch_id,'gc_debit_reconciled',jsonb_build_object(
      'operation_before',to_jsonb(v_operation),'batch_before',to_jsonb(v_batch),'items_before',v_before_items,
      'gc_document',p_gc_document,'source_budget',p_source_budget),v_actor,v_actor_name);
  UPDATE partial_writeoff_batches SET status='confirming' WHERE id=p_batch_id;
  v_status := partial_writeoff_finish_confirmation(p_batch_id,true,NULL,v_actor,v_actor_name);
  IF NOT EXISTS (SELECT 1 FROM partial_writeoff_batches WHERE operation_id=v_operation.id AND status='reconciliation_required') THEN
    UPDATE partial_writeoff_operations SET reconciliation_reason=NULL WHERE id=v_operation.id;
  END IF;
  RETURN jsonb_build_object('batch_id',p_batch_id,'already_confirmed',false,'status',v_status);
END $$;
REVOKE ALL ON FUNCTION public.partial_writeoff_reconcile_gc_debit(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_reconcile_gc_debit(uuid,jsonb,jsonb) TO authenticated,service_role;

-- Called by Checkout only after rereading the budget, document and stock guards.
-- This claims the same failed batch; it never creates a new document or movement.
CREATE OR REPLACE FUNCTION public.partial_writeoff_retry_confirmation(p_batch_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid(); v_operation_id uuid;
  v_operation public.partial_writeoff_operations; v_batch public.partial_writeoff_batches;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT operation_id INTO v_operation_id FROM partial_writeoff_batches WHERE id=p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM partial_writeoff_operations WHERE id=v_operation_id FOR UPDATE;
  SELECT * INTO v_batch FROM partial_writeoff_batches WHERE id=p_batch_id FOR UPDATE;
  IF v_batch.status='confirmed' THEN RETURN 'confirmed'; END IF;
  IF v_operation.status IN ('cancelled','completed','consolidating')
     OR v_operation.definitive_document_id IS NOT NULL OR v_batch.confirmed_at IS NOT NULL
     OR v_batch.status <> 'reconciliation_required' OR coalesce(v_batch.auxiliary_document_id,'')='' THEN
    RAISE EXCEPTION 'BATCH_NOT_RETRYABLE';
  END IF;
  INSERT INTO partial_writeoff_events(operation_id,batch_id,event_type,payload,actor_id,actor_name)
    VALUES(v_operation.id,p_batch_id,'confirmation_retry_requested',jsonb_build_object('batch_before',to_jsonb(v_batch)),
      v_actor,(SELECT name FROM profiles WHERE id=v_actor));
  UPDATE partial_writeoff_batches SET status='awaiting_checkout' WHERE id=p_batch_id;
  RETURN partial_writeoff_claim_confirmation(p_batch_id);
END $$;
REVOKE ALL ON FUNCTION public.partial_writeoff_retry_confirmation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_retry_confirmation(uuid) TO authenticated,service_role;
COMMIT;
