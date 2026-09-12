BEGIN;
-- Quantidades do lote representam a baixa líquida atual. A quantidade original
-- permanece no comprovante da separação e no evento com todos os itens anteriores.
CREATE OR REPLACE FUNCTION public.partial_writeoff_reconcile_return(p_batch_id uuid,p_gc_document jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b partial_writeoff_batches; o partial_writeoff_operations; proof separations;
 before_items jsonb; old_map jsonb; new_map jsonb; k text; previous numeric; actual numeric;
 delta numeric; total_returned numeric:=0; line record; new_status text;
BEGIN
 SELECT * INTO b FROM partial_writeoff_batches WHERE id=p_batch_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
 SELECT * INTO o FROM partial_writeoff_operations WHERE id=b.operation_id FOR UPDATE;
 SELECT * INTO b FROM partial_writeoff_batches WHERE id=p_batch_id FOR UPDATE;
 IF o.status IN ('completed','cancelled','consolidating') OR o.definitive_document_id IS NOT NULL THEN RAISE EXCEPTION 'OPERATION_NOT_RETURNABLE'; END IF;
 IF b.status NOT IN ('confirmed','cancelled') OR b.confirmed_at IS NULL THEN RAISE EXCEPTION 'BATCH_NOT_CONFIRMED'; END IF;
 IF p_gc_document->>'id' IS DISTINCT FROM b.auxiliary_document_id OR p_gc_document->>'cliente_id' IS DISTINCT FROM o.client_id
   OR coalesce(p_gc_document->>'situacao_estoque','') NOT IN ('0','1')
   OR position(b.marker in coalesce(p_gc_document->>'observacoes','')||coalesce(p_gc_document->>'observacoes_interna',''))=0
   OR jsonb_typeof(p_gc_document->'produtos') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'GC_RETURN_DOCUMENT_INVALID'; END IF;
 SELECT * INTO proof FROM separations WHERE order_id=b.auxiliary_document_id AND order_type=b.auxiliary_document_type
   AND invalidated=true AND invalidated_reason LIKE 'DEVOLUÇÃO:%' AND invalidated_at>=b.confirmed_at
   ORDER BY invalidated_at DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'RETURN_RECEIPT_REQUIRED'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(bi)||jsonb_build_object('product_id',i.product_id,'variation_id',i.variation_id,'withdrawn_before',i.withdrawn_quantity)),'[]')
   INTO before_items FROM partial_writeoff_batch_items bi JOIN partial_writeoff_items i ON i.id=bi.item_id WHERE bi.batch_id=b.id;
 IF EXISTS(SELECT 1 FROM partial_writeoff_batch_items bi JOIN partial_writeoff_items i ON i.id=bi.item_id WHERE bi.batch_id=b.id GROUP BY i.product_id,i.variation_id HAVING count(*)>1) THEN RAISE EXCEPTION 'DUPLICATE_RETURN_LINES_REQUIRE_REVIEW'; END IF;
 SELECT coalesce(jsonb_object_agg(i.product_id||'::'||i.variation_id,bi.quantity),'{}') INTO old_map
   FROM partial_writeoff_batch_items bi JOIN partial_writeoff_items i ON i.id=bi.item_id WHERE bi.batch_id=b.id;
 IF p_gc_document->>'situacao_estoque'='0' THEN new_map:='{}';
 ELSE
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_gc_document->'produtos') x WHERE nullif(x->'produto'->>'produto_id','') IS NOT NULL
      AND coalesce(x->'produto'->>'movimenta_estoque','1')<>'0' AND (nullif(x->'produto'->>'quantidade','') IS NULL OR (x->'produto'->>'quantidade')::numeric<0)) THEN RAISE EXCEPTION 'INVALID_RETURN_QUANTITY'; END IF;
   SELECT coalesce(jsonb_object_agg(pid||'::'||vid,q),'{}') INTO new_map FROM (
     SELECT x->'produto'->>'produto_id' pid,coalesce(x->'produto'->>'variacao_id','') vid,sum((x->'produto'->>'quantidade')::numeric) q
     FROM jsonb_array_elements(p_gc_document->'produtos') x WHERE nullif(x->'produto'->>'produto_id','') IS NOT NULL
       AND coalesce(x->'produto'->>'movimenta_estoque','1')<>'0' GROUP BY 1,2) lines;
 END IF;
 FOR k IN SELECT jsonb_object_keys(new_map) LOOP
   IF NOT old_map ? k OR (new_map->>k)::numeric>(old_map->>k)::numeric THEN RAISE EXCEPTION 'GC_RETURN_HAS_ADDED_QUANTITIES'; END IF;
 END LOOP;
 FOR line IN SELECT bi.item_id,bi.quantity,i.product_id||'::'||i.variation_id product_key,i.withdrawn_quantity
   FROM partial_writeoff_batch_items bi JOIN partial_writeoff_items i ON i.id=bi.item_id WHERE bi.batch_id=b.id FOR UPDATE OF bi,i LOOP
   previous:=line.quantity; actual:=coalesce((new_map->>line.product_key)::numeric,0); delta:=previous-actual;
   IF delta>line.withdrawn_quantity OR delta<0 THEN RAISE EXCEPTION 'RETURN_BALANCE_MISMATCH'; END IF;
   IF delta>0 THEN
     total_returned:=total_returned+delta;
     UPDATE partial_writeoff_items SET withdrawn_quantity=withdrawn_quantity-delta WHERE id=line.item_id;
     IF actual=0 THEN DELETE FROM partial_writeoff_batch_items WHERE batch_id=b.id AND item_id=line.item_id;
     ELSE UPDATE partial_writeoff_batch_items SET quantity=actual WHERE batch_id=b.id AND item_id=line.item_id; END IF;
   END IF;
 END LOOP;
 IF total_returned=0 THEN RETURN jsonb_build_object('returned_quantity',0,'already_reconciled',true); END IF;
 IF NOT EXISTS(SELECT 1 FROM partial_writeoff_batch_items WHERE batch_id=b.id) THEN
   UPDATE partial_writeoff_batches SET status='cancelled',error_message='Devolução integral confirmada no GC; comprovante e tarefas preservados.' WHERE id=b.id;
 END IF;
 new_status:=CASE WHEN EXISTS(SELECT 1 FROM partial_writeoff_batches WHERE operation_id=o.id AND status='reconciliation_required') THEN 'reconciliation_required'
   WHEN EXISTS(SELECT 1 FROM partial_writeoff_batches WHERE operation_id=o.id AND status IN ('creating','awaiting_checkout','confirming')) THEN 'partial_separation' ELSE 'awaiting_balance' END;
 UPDATE partial_writeoff_operations SET status=new_status,version=version+1 WHERE id=o.id;
 INSERT INTO partial_writeoff_events(operation_id,batch_id,event_type,payload,actor_id,actor_name)
 VALUES(o.id,b.id,'returned_items_reconciled',jsonb_build_object('returned_quantity',total_returned,'separation_id',proof.id,
   'return_reason',proof.invalidated_reason,'return_recorded_at',proof.invalidated_at,'batch_items_before',before_items,
   'gc_document',p_gc_document,'old_document_quantities',old_map,'new_document_quantities',new_map),auth.uid(),'Reconciliação de devolução comprovada');
 RETURN jsonb_build_object('returned_quantity',total_returned,'status',new_status,'batch_status',(SELECT status FROM partial_writeoff_batches WHERE id=b.id));
END $$;
REVOKE ALL ON FUNCTION public.partial_writeoff_reconcile_return(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_reconcile_return(uuid,jsonb) TO authenticated,service_role;
COMMIT;
