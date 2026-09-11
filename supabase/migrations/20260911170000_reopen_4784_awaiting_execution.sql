-- Reabre somente a baixa parcial 4784. Não altera estoque no GC nem tarefas Auvo.
-- A OS 10138 continua existindo; deixa de ser a conclusão ativa desta operação.
BEGIN;

ALTER TABLE public.partial_writeoff_operations
  DROP CONSTRAINT partial_writeoff_operations_status_check;
ALTER TABLE public.partial_writeoff_operations
  ADD CONSTRAINT partial_writeoff_operations_status_check CHECK (status IN (
    'awaiting_separation', 'partial_separation', 'awaiting_balance',
    'awaiting_execution', 'ready_to_consolidate', 'consolidating',
    'completed', 'cancelled', 'reconciliation_required'
  ));

DO $$
DECLARE
  op public.partial_writeoff_operations%ROWTYPE;
  previous_batches jsonb;
  previous_logs jsonb;
BEGIN
  SELECT * INTO op FROM public.partial_writeoff_operations
  WHERE id = '5d213137-682e-4901-9b3c-e0e7818cb83d' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF; -- ambientes sem dados de produção
  IF EXISTS (SELECT 1 FROM public.partial_writeoff_events
    WHERE operation_id = op.id AND event_type = 'premature_consolidation_reopened')
  THEN RETURN; END IF;
  IF op.budget_code <> '4784' OR op.budget_id <> '348836923'
    OR op.status <> 'completed'
    OR op.definitive_document_id IS DISTINCT FROM '394003937'
  THEN RAISE EXCEPTION '4784_STATE_CHANGED_REVIEW_REQUIRED'; END IF;

  PERFORM 1 FROM public.partial_writeoff_items WHERE operation_id = op.id FOR UPDATE;
  IF (SELECT count(*) FROM public.partial_writeoff_items WHERE operation_id = op.id) <> 15
    OR EXISTS (SELECT 1 FROM public.partial_writeoff_items WHERE operation_id = op.id
      AND (withdrawn_quantity <> original_quantity OR reserved_quantity <> 0))
  THEN RAISE EXCEPTION '4784_BALANCES_CHANGED_REVIEW_REQUIRED'; END IF;

  PERFORM 1 FROM public.partial_writeoff_batches WHERE operation_id = op.id FOR UPDATE;
  IF (SELECT count(*) FROM public.partial_writeoff_batches WHERE operation_id = op.id) <> 2
    OR EXISTS (SELECT 1 FROM public.partial_writeoff_batches WHERE operation_id = op.id
      AND (confirmed_at IS NULL OR status NOT IN ('confirmed', 'consolidated', 'cancelled')
        OR auxiliary_document_id NOT IN ('389884274', '393982618')
        OR auxiliary_document_id IS NULL))
  THEN RAISE EXCEPTION '4784_BATCHES_CHANGED_REVIEW_REQUIRED'; END IF;

  SELECT jsonb_agg(to_jsonb(b)) INTO previous_batches
    FROM public.partial_writeoff_batches b WHERE operation_id = op.id;
  SELECT jsonb_agg(to_jsonb(l)) INTO previous_logs FROM public.os_generation_logs l
    WHERE orcamento_id = op.budget_id AND os_id = '394003937';

  INSERT INTO public.partial_writeoff_events(operation_id, event_type, payload, actor_name)
  VALUES (op.id, 'premature_consolidation_reopened', jsonb_build_object(
    'reason', 'Baixas preservadas; aguardando última execução e reconciliação da OS 10138 antes de nova consolidação.',
    'previous_operation', to_jsonb(op), 'previous_batches', previous_batches,
    'previous_generation_logs', previous_logs,
    'superseded_document_id', '394003937', 'superseded_document_code', '10138',
    'preserved_auvo_task_id', op.definitive_auvo_task_id
  ), 'Migração: reabertura solicitada do orçamento 4784');

  -- Confirmação representa a baixa já registrada, não execução técnica.
  UPDATE public.partial_writeoff_batches SET status = 'confirmed', error_message = NULL,
    updated_at = now() WHERE operation_id = op.id;

  -- Impede os consumidores dos logs de considerarem a conclusão antecipada válida.
  UPDATE public.os_generation_logs SET success = false,
    error_message = 'Consolidação antecipada revogada: orçamento 4784 aguardando última execução. OS 10138 e tarefa Auvo preservadas no histórico.'
  WHERE orcamento_id = op.budget_id AND os_id = '394003937';

  UPDATE public.partial_writeoff_operations SET status = 'awaiting_execution',
    definitive_document_id = NULL, definitive_document_code = NULL,
    definitive_auvo_task_id = NULL, completed_at = NULL,
    reconciliation_reason = 'Aguardando última execução. Conferir estoque e OS 10138 existente antes de autorizar conciliação final; não gerar documento duplicado.',
    version = version + 1, updated_at = now()
  WHERE id = op.id;
END $$;

-- A auditoria não pode desfazer baixas confirmadas enquanto aguarda execução.
-- Isso também protege a RPC cancel_batch usada por clientes antigos.
CREATE OR REPLACE FUNCTION public.partial_writeoff_guard_waiting_batch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'confirmed' AND NEW.status IN ('cancelled', 'failed')
    AND EXISTS (SELECT 1 FROM public.partial_writeoff_operations
      WHERE id = OLD.operation_id AND status = 'awaiting_execution')
  THEN RAISE EXCEPTION 'EXECUTION_PENDING_PRESERVE_CONFIRMED_WRITEOFF'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS partial_writeoff_guard_waiting_batch ON public.partial_writeoff_batches;
CREATE TRIGGER partial_writeoff_guard_waiting_batch
BEFORE UPDATE OF status ON public.partial_writeoff_batches
FOR EACH ROW EXECUTE FUNCTION public.partial_writeoff_guard_waiting_batch();

COMMIT;
