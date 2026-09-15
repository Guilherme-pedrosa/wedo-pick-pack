BEGIN;

-- A reserva/baixa de estoque não comprova a execução da OS. Esta regra vale
-- também para operações antigas cujo flow_mode permanece 'reservation'.
-- Não alterar esse campo no histórico: ele também distingue escolhas Auvo antigas.
CREATE OR REPLACE FUNCTION public.partial_writeoff_documents_executed(p_documents jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE all_done boolean;
BEGIN
  IF jsonb_typeof(p_documents) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(p_documents) = 0 THEN RETURN false; END IF;
  SELECT bool_and(
    coalesce(d->'executed' = 'true'::jsonb, false)
    AND coalesce(d->'stockApplied' = 'true'::jsonb, false)
    AND coalesce(
      upper(trim(d->>'statusName')) ~ '^EXECUTAD[AO]([^A-Z]|$)'
      OR upper(trim(d->>'statusName')) IN (
        'CHAMADO FECHADO - FATURADO',
        'IMP CIGAM FATURADO TOTAL',
        'FINANCEIRO SEPARADO / BAIXA CIGAM'
      ), false)
  ) INTO all_done
  FROM jsonb_array_elements(p_documents) d;
  RETURN coalesce(all_done, false);
END $$;

REVOKE ALL ON FUNCTION public.partial_writeoff_documents_executed(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_documents_executed(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.partial_writeoff_open_operation(
  p_budget jsonb,
  p_document_type text,
  p_items jsonb,
  p_created_by uuid DEFAULT NULL,
  p_created_by_name text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_operation_id uuid;
  v_budget_id text := trim(coalesce(p_budget->>'id', ''));
  v_item jsonb;
BEGIN
  IF v_budget_id = '' OR trim(coalesce(p_budget->>'codigo', '')) = '' THEN
    RAISE EXCEPTION 'INVALID_BUDGET';
  END IF;
  IF p_document_type NOT IN ('os', 'venda') THEN
    RAISE EXCEPTION 'INVALID_DOCUMENT_TYPE';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_ITEMS';
  END IF;

  SELECT id INTO v_operation_id
  FROM public.partial_writeoff_operations
  WHERE budget_id = v_budget_id AND status NOT IN ('completed', 'cancelled')
  FOR UPDATE;
  IF v_operation_id IS NOT NULL THEN RETURN v_operation_id; END IF;

  INSERT INTO public.partial_writeoff_operations (
    budget_id, budget_code, client_id, client_name, document_type,
    budget_snapshot, created_by, created_by_name, flow_mode
  ) VALUES (
    v_budget_id,
    trim(p_budget->>'codigo'),
    trim(coalesce(p_budget->>'cliente_id', '')),
    trim(coalesce(p_budget->>'nome_cliente', '')),
    p_document_type,
    p_budget,
    p_created_by,
    nullif(trim(coalesce(p_created_by_name, '')), ''),
    CASE WHEN p_document_type = 'os' THEN 'partial_execution' ELSE 'reservation' END
  ) RETURNING id INTO v_operation_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.partial_writeoff_items (
      operation_id, line_key, product_id, variation_id, product_name,
      product_code, unit, original_quantity, line_snapshot
    ) VALUES (
      v_operation_id,
      trim(v_item->>'line_key'),
      trim(v_item->>'product_id'),
      trim(coalesce(v_item->>'variation_id', '')),
      trim(coalesce(v_item->>'product_name', 'Produto')),
      trim(coalesce(v_item->>'product_code', '')),
      trim(coalesce(v_item->>'unit', 'UN')),
      (v_item->>'original_quantity')::numeric,
      coalesce(v_item->'line_snapshot', '{}'::jsonb)
    );
  END LOOP;

  INSERT INTO public.partial_writeoff_events (
    operation_id, event_type, payload, actor_id, actor_name
  ) VALUES (
    v_operation_id, 'operation_opened', jsonb_build_object('document_type', p_document_type),
    p_created_by, p_created_by_name
  );
  RETURN v_operation_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT id INTO v_operation_id
    FROM public.partial_writeoff_operations
    WHERE budget_id = v_budget_id AND status NOT IN ('completed', 'cancelled');
    IF v_operation_id IS NOT NULL THEN RETURN v_operation_id; END IF;
    RAISE;
END $$;

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
  IF jsonb_typeof(p_documents) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'EXECUTION_DOCUMENTS_REQUIRED';
  END IF;
  IF jsonb_array_length(p_documents)=0 THEN RAISE EXCEPTION 'EXECUTION_DOCUMENTS_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_documents) d GROUP BY d->>'batchId' HAVING count(*)>1)
    OR jsonb_array_length(p_documents) <> (SELECT count(*) FROM public.partial_writeoff_batches WHERE operation_id=op.id AND confirmed_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_documents) d WHERE NOT EXISTS (
      SELECT 1 FROM public.partial_writeoff_batches b WHERE b.operation_id=op.id AND b.id::text=d->>'batchId'
      AND b.auxiliary_document_id=d->>'documentId' AND b.confirmed_at IS NOT NULL))
  THEN RAISE EXCEPTION 'EXECUTION_DOCUMENT_MISMATCH'; END IF;
  all_done := public.partial_writeoff_documents_executed(p_documents);
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

-- Protege chamadas antigas que tentem reaproveitar uma verificação de reserva.
CREATE OR REPLACE FUNCTION public.partial_writeoff_require_execution_state()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.document_type = 'os' AND NEW.status = 'ready_to_consolidate'
    AND (NEW.execution_verified_at IS NULL OR NEW.execution_verified_at < now() - interval '90 seconds'
      OR NOT public.partial_writeoff_documents_executed(NEW.execution_documents))
  THEN
    NEW.status := 'awaiting_execution';
    NEW.execution_verified_at := NULL;
  END IF;
  IF TG_OP='UPDATE' AND NEW.document_type='os' AND NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed'
    AND (NEW.consolidation_stage IS DISTINCT FROM 'finalized' OR NEW.definitive_document_id IS NULL)
  THEN RAISE EXCEPTION 'VERIFIED_CONSOLIDATION_REQUIRED'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS partial_writeoff_require_execution_state ON public.partial_writeoff_operations;
CREATE TRIGGER partial_writeoff_require_execution_state
BEFORE INSERT OR UPDATE OF status, execution_verified_at, execution_documents
ON public.partial_writeoff_operations FOR EACH ROW EXECUTE FUNCTION public.partial_writeoff_require_execution_state();

CREATE OR REPLACE FUNCTION public.partial_writeoff_claim_consolidation(p_operation_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE op public.partial_writeoff_operations%ROWTYPE;
BEGIN
  SELECT * INTO op FROM public.partial_writeoff_operations WHERE id=p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPERATION_NOT_FOUND'; END IF;
  IF op.status='completed' THEN RETURN 'completed'; END IF;
  IF op.status <> 'ready_to_consolidate' THEN RAISE EXCEPTION 'OPERATION_NOT_CONSOLIDATABLE:%',op.status; END IF;
  IF op.document_type='os' AND (op.execution_verified_at IS NULL OR op.execution_verified_at < now()-interval '90 seconds'
    OR NOT public.partial_writeoff_documents_executed(op.execution_documents))
  THEN RAISE EXCEPTION 'EXECUTION_CHECK_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partial_writeoff_items WHERE operation_id=op.id)
    OR EXISTS (SELECT 1 FROM public.partial_writeoff_items WHERE operation_id=op.id AND (withdrawn_quantity<>original_quantity OR reserved_quantity<>0))
  THEN RAISE EXCEPTION 'OPERATION_HAS_PENDING_BALANCE'; END IF;
  UPDATE public.partial_writeoff_operations SET status='consolidating',version=version+1,reconciliation_reason=NULL WHERE id=op.id;
  INSERT INTO public.partial_writeoff_events(operation_id,event_type,payload) VALUES(op.id,'consolidation_started',jsonb_build_object('execution_documents',op.execution_documents));
  RETURN 'consolidating';
END $$;

-- Invalida somente liberações ainda ativas sem execução comprovada. Não reabre
-- operações concluídas nem interrompe uma consolidação que já foi iniciada.
-- Preserva integralmente documentos, quantidades, lotes e escolhas/tarefas Auvo.
WITH invalidated AS (
  UPDATE public.partial_writeoff_operations
  SET status=CASE WHEN status='ready_to_consolidate' THEN 'awaiting_execution' ELSE status END,
      execution_verified_at=NULL,
      version=version+1
  WHERE document_type='os'
    AND status NOT IN ('completed','cancelled','consolidating')
    AND (status='ready_to_consolidate' OR execution_verified_at IS NOT NULL)
    AND NOT public.partial_writeoff_documents_executed(execution_documents)
  RETURNING id
)
INSERT INTO public.partial_writeoff_events(operation_id,event_type,payload)
SELECT id,'execution_readiness_invalidated',jsonb_build_object(
  'reason','OS exige execução comprovada; reserva de estoque não comprova execução',
  'stock_changed',false
) FROM invalidated;

COMMIT;
