BEGIN;
-- A rotina do GitHub só acessa estas ações, autenticada por segredo exclusivo.
CREATE OR REPLACE FUNCTION public.partial_execution_worker_api(p_token text,p_action text,p_operation_id uuid DEFAULT NULL,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; op public.partial_writeoff_operations%ROWTYPE;
BEGIN
  IF length(coalesce(p_token,''))<>64 OR NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name='partial_execution_github_token_sha256'
    AND decrypted_secret=encode(extensions.digest(p_token,'sha256'),'hex')
  ) THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_action='list' THEN
    WITH stale AS (
      UPDATE partial_writeoff_operations SET status='reconciliation_required',reconciliation_reason='Execução interrompida; retome reutilizando o documento persistido.'
      WHERE document_type='os' AND status='consolidating' AND updated_at<now()-interval '30 minutes' RETURNING id
    ) INSERT INTO partial_writeoff_events(operation_id,event_type,payload)
      SELECT id,'interrupted_consolidation_recovered','{}'::jsonb FROM stale;
    SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') INTO result FROM (
      SELECT id FROM partial_writeoff_operations WHERE document_type='os' AND status IN ('awaiting_execution','ready_to_consolidate') ORDER BY updated_at LIMIT 10
    ) t;
    RETURN result;
  END IF;
  SELECT * INTO op FROM partial_writeoff_operations WHERE id=p_operation_id AND document_type='os';
  IF NOT FOUND THEN RAISE EXCEPTION 'OPERATION_NOT_FOUND'; END IF;
  CASE p_action
    WHEN 'operation' THEN
      RETURN to_jsonb(op)||jsonb_build_object('batches',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY sequence),'[]') FROM partial_writeoff_batches b WHERE operation_id=op.id));
    WHEN 'settings' THEN RETURN (SELECT to_jsonb(s) FROM partial_writeoff_settings s WHERE singleton);
    WHEN 'record_execution' THEN RETURN to_jsonb(partial_writeoff_record_execution(op.id,p_payload->'p_documents'));
    WHEN 'claim_consolidation' THEN RETURN to_jsonb(partial_writeoff_claim_consolidation(op.id));
    WHEN 'historical_tasks' THEN RETURN partial_writeoff_historical_tasks(op.id);
    WHEN 'checkpoint' THEN
      PERFORM partial_writeoff_checkpoint(op.id,p_payload->>'p_stage',p_payload->>'p_document_id',p_payload->>'p_document_code',p_payload->'p_payload');
    WHEN 'finish_consolidation' THEN
      PERFORM partial_writeoff_finish_consolidation(op.id,(p_payload->>'p_success')::boolean,p_payload->>'p_document_id',p_payload->>'p_document_code',p_payload->>'p_auvo_task_id',p_payload->>'p_error_message');
    WHEN 'error' THEN
      IF NOT EXISTS(SELECT 1 FROM partial_writeoff_events WHERE operation_id=op.id AND event_type='automatic_execution_check_failed' AND payload=p_payload AND created_at>now()-interval '1 day') THEN
        INSERT INTO partial_writeoff_events(operation_id,event_type,payload) VALUES(op.id,'automatic_execution_check_failed',p_payload);
      END IF;
    ELSE RAISE EXCEPTION 'UNSUPPORTED_ACTION';
  END CASE;
  RETURN 'null'::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.partial_execution_worker_api(text,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partial_execution_worker_api(text,text,uuid,jsonb) TO anon,authenticated,service_role;
-- Não usar o job da Edge Function enquanto a implantação não estiver disponível.
SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='partial-execution-5min';
COMMIT;
