BEGIN;

CREATE TABLE IF NOT EXISTS public.preserved_auvo_tasks (
  budget_id text NOT NULL, task_id text NOT NULL, error_message text,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(budget_id,task_id)
);
ALTER TABLE public.preserved_auvo_tasks ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.preserved_auvo_tasks TO service_role;

ALTER TABLE public.partial_writeoff_operations
  ADD COLUMN IF NOT EXISTS execution_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS execution_documents jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS consolidation_stage text;

-- Clientes antigos não podem liberar a consolidação só porque terminou o Checkout.
CREATE OR REPLACE FUNCTION public.partial_writeoff_require_execution_state()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.document_type = 'os' AND NEW.status = 'ready_to_consolidate'
    AND (NEW.execution_verified_at IS NULL OR NEW.execution_verified_at < now() - interval '90 seconds')
  THEN NEW.status := 'awaiting_execution'; END IF;
  IF TG_OP='UPDATE' AND NEW.document_type='os' AND NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed'
    AND (NEW.consolidation_stage IS DISTINCT FROM 'finalized' OR NEW.definitive_document_id IS NULL)
  THEN RAISE EXCEPTION 'VERIFIED_CONSOLIDATION_REQUIRED'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS partial_writeoff_require_execution_state ON public.partial_writeoff_operations;
CREATE TRIGGER partial_writeoff_require_execution_state BEFORE INSERT OR UPDATE OF status
ON public.partial_writeoff_operations FOR EACH ROW EXECUTE FUNCTION public.partial_writeoff_require_execution_state();

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
  SELECT bool_and(coalesce((d->>'executed')::boolean,false) AND coalesce((d->>'stockApplied')::boolean,false)
    AND upper(d->>'statusName') ~ '^EXECUTAD[AO]([^A-Z]|$)') INTO all_done
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

CREATE OR REPLACE FUNCTION public.partial_writeoff_claim_consolidation(p_operation_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE op public.partial_writeoff_operations%ROWTYPE;
BEGIN
  SELECT * INTO op FROM public.partial_writeoff_operations WHERE id=p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPERATION_NOT_FOUND'; END IF;
  IF op.status='completed' THEN RETURN 'completed'; END IF;
  IF op.status <> 'ready_to_consolidate' THEN RAISE EXCEPTION 'OPERATION_NOT_CONSOLIDATABLE:%',op.status; END IF;
  IF op.document_type='os' AND (op.execution_verified_at IS NULL OR op.execution_verified_at < now()-interval '90 seconds')
  THEN RAISE EXCEPTION 'EXECUTION_CHECK_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partial_writeoff_items WHERE operation_id=op.id)
    OR EXISTS (SELECT 1 FROM public.partial_writeoff_items WHERE operation_id=op.id AND (withdrawn_quantity<>original_quantity OR reserved_quantity<>0))
  THEN RAISE EXCEPTION 'OPERATION_HAS_PENDING_BALANCE'; END IF;
  UPDATE public.partial_writeoff_operations SET status='consolidating',version=version+1,reconciliation_reason=NULL WHERE id=op.id;
  INSERT INTO public.partial_writeoff_events(operation_id,event_type,payload) VALUES(op.id,'consolidation_started',jsonb_build_object('execution_documents',op.execution_documents));
  RETURN 'consolidating';
END $$;

CREATE OR REPLACE FUNCTION public.partial_writeoff_checkpoint(p_operation_id uuid,p_stage text,
  p_document_id text DEFAULT NULL,p_document_code text DEFAULT NULL,p_payload jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE op public.partial_writeoff_operations%ROWTYPE;
BEGIN
  SELECT * INTO op FROM public.partial_writeoff_operations WHERE id=p_operation_id FOR UPDATE;
  IF NOT FOUND OR op.status <> 'consolidating' THEN RAISE EXCEPTION 'OPERATION_NOT_CONSOLIDATING'; END IF;
  IF p_stage NOT IN ('creating','created','finalizing','finalized') THEN RAISE EXCEPTION 'INVALID_CONSOLIDATION_STAGE'; END IF;
  IF op.definitive_document_id IS NOT NULL AND p_document_id IS DISTINCT FROM op.definitive_document_id
    THEN RAISE EXCEPTION 'DEFINITIVE_DOCUMENT_CHANGED'; END IF;
  IF p_stage<>'creating' AND nullif(p_document_id,'') IS NULL THEN RAISE EXCEPTION 'DOCUMENT_ID_REQUIRED'; END IF;
  UPDATE public.partial_writeoff_operations SET consolidation_stage=CASE
    WHEN array_position(ARRAY['creating','created','finalizing','finalized'],consolidation_stage) > array_position(ARRAY['creating','created','finalizing','finalized'],p_stage)
    THEN consolidation_stage ELSE p_stage END,
    definitive_document_id=coalesce(p_document_id,definitive_document_id),
    definitive_document_code=coalesce(p_document_code,definitive_document_code) WHERE id=op.id;
  INSERT INTO public.partial_writeoff_events(operation_id,event_type,payload,actor_id)
  VALUES(op.id,'consolidation_'||p_stage,p_payload||jsonb_build_object('document_id',p_document_id,'document_code',p_document_code),auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.partial_writeoff_historical_tasks(p_operation_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(DISTINCT task),'[]') FROM (
    SELECT auvo_task_id task FROM public.partial_writeoff_batches WHERE operation_id=p_operation_id
    UNION SELECT payload->>'preserved_auvo_task_id' FROM public.partial_writeoff_events
      WHERE operation_id=p_operation_id AND event_type='premature_consolidation_reopened'
  ) t WHERE nullif(task,'') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.partial_writeoff_record_execution(uuid,jsonb),public.partial_writeoff_checkpoint(uuid,text,text,text,jsonb),public.partial_writeoff_historical_tasks(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_record_execution(uuid,jsonb),public.partial_writeoff_checkpoint(uuid,text,text,text,jsonb),public.partial_writeoff_historical_tasks(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.partial_writeoff_log_definitive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.document_type='os' AND NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    INSERT INTO public.os_generation_logs(orcamento_codigo,orcamento_id,nome_cliente,os_id,os_codigo,auvo_task_id,operator_id,operator_name,valor_total,success)
    SELECT NEW.budget_code,NEW.budget_id,NEW.client_name,NEW.definitive_document_id,NEW.definitive_document_code,
      NEW.definitive_auvo_task_id,coalesce(NEW.created_by,auth.uid()),'Consolidação de execuções existentes',coalesce((NEW.budget_snapshot->>'valor_total')::numeric,0),true
    WHERE NOT EXISTS(SELECT 1 FROM public.os_generation_logs WHERE os_id=NEW.definitive_document_id AND success);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS partial_writeoff_log_definitive ON public.partial_writeoff_operations;
CREATE TRIGGER partial_writeoff_log_definitive AFTER UPDATE OF status ON public.partial_writeoff_operations
FOR EACH ROW EXECUTE FUNCTION public.partial_writeoff_log_definitive();

UPDATE public.partial_writeoff_operations SET status='awaiting_execution',version=version+1
WHERE document_type='os' AND status='ready_to_consolidate' AND execution_verified_at IS NULL;
COMMIT;
