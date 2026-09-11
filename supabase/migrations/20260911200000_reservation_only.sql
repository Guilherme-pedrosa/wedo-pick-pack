BEGIN;
ALTER TABLE public.partial_writeoff_operations ADD COLUMN IF NOT EXISTS flow_mode text NOT NULL DEFAULT 'partial_execution';
ALTER TABLE public.partial_writeoff_operations ALTER COLUMN flow_mode SET DEFAULT 'reservation';
CREATE OR REPLACE FUNCTION public.partial_writeoff_record_execution(p_operation_id uuid, p_documents jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE op public.partial_writeoff_operations%ROWTYPE; all_done boolean; next_status text;
BEGIN
  SELECT * INTO op FROM public.partial_writeoff_operations WHERE id=p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPERATION_NOT_FOUND'; END IF;
  IF op.status IN ('completed','cancelled','consolidating') THEN RETURN op.status; END IF;
  IF op.document_type <> 'os' THEN RAISE EXCEPTION 'OS_OPERATION_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM public.partial_writeoff_items WHERE operation_id=op.id
      AND (withdrawn_quantity <> original_quantity OR reserved_quantity <> 0))
  THEN RAISE EXCEPTION 'OPERATION_HAS_PENDING_BALANCE'; END IF;
  IF jsonb_typeof(p_documents) <> 'array' OR jsonb_array_length(p_documents)=0
  THEN RAISE EXCEPTION 'EXECUTION_DOCUMENTS_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_documents) d GROUP BY d->>'batchId' HAVING count(*)>1)
    OR jsonb_array_length(p_documents) <> (SELECT count(*) FROM public.partial_writeoff_batches WHERE operation_id=op.id AND confirmed_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_documents) d WHERE NOT EXISTS (
      SELECT 1 FROM public.partial_writeoff_batches b WHERE b.operation_id=op.id AND b.id::text=d->>'batchId'
      AND b.auxiliary_document_id=d->>'documentId' AND b.confirmed_at IS NOT NULL))
  THEN RAISE EXCEPTION 'EXECUTION_DOCUMENT_MISMATCH'; END IF;
  SELECT CASE WHEN op.flow_mode='reservation' THEN bool_and(coalesce((d->>'stockApplied')::boolean,false) AND d->>'statusId'=(SELECT os_stock_status_id FROM partial_writeoff_settings WHERE singleton)) ELSE bool_and(coalesce((d->>'executed')::boolean,false) AND coalesce((d->>'stockApplied')::boolean,false)
    AND upper(d->>'statusName') ~ '^EXECUTAD[AO]([^A-Z]|$)') END INTO all_done
  FROM jsonb_array_elements(p_documents) d;
  next_status := CASE WHEN all_done THEN 'ready_to_consolidate' ELSE 'awaiting_execution' END;
  -- Uma falha com documento já criado deve ser retomada explicitamente.
  IF op.status='reconciliation_required' AND NOT all_done THEN RETURN op.status; END IF;
  UPDATE public.partial_writeoff_operations SET execution_documents=p_documents,
    execution_verified_at=CASE WHEN all_done THEN now() ELSE NULL END,
    status=next_status, version=version+CASE WHEN status IS DISTINCT FROM next_status OR execution_documents IS DISTINCT FROM p_documents THEN 1 ELSE 0 END
  WHERE id=op.id;
  IF op.execution_documents IS DISTINCT FROM p_documents OR op.status IS DISTINCT FROM next_status THEN
    INSERT INTO public.partial_writeoff_events(operation_id,event_type,payload,actor_id)
    VALUES (op.id,'execution_checked',jsonb_build_object('documents',p_documents,'ready',all_done),auth.uid());
  END IF;
  RETURN next_status;
END $$;


COMMIT;
