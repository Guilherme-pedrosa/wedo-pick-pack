BEGIN;
-- Somente snapshots que releram a origem de cada baixa parcial são publicados.
CREATE OR REPLACE FUNCTION public.compras_worker_api(p_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb; snapshot_id uuid;
BEGIN
  IF length(coalesce(p_token,''))<>64 OR NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name='partial_execution_github_token_sha256'
      AND decrypted_secret=encode(extensions.digest(p_token,'sha256'),'hex')
  ) THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_action='partials' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object(
      'items',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]') FROM partial_writeoff_item_balances i WHERE i.operation_id=o.id),
      'batches',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]') FROM partial_writeoff_batches b WHERE b.operation_id=o.id)) ORDER BY o.id),'[]')
      INTO result FROM partial_writeoff_operations o WHERE status NOT IN ('completed','cancelled');
    RETURN jsonb_build_object('operations',result,'revision',compras_partial_revision());
  ELSIF p_action='save' THEN
    IF p_payload->>'revision' IS DISTINCT FROM compras_partial_revision() THEN RAISE EXCEPTION 'PARTIAL_BALANCE_CHANGED'; END IF;
    result:=p_payload->'result';
    IF coalesce((result->>'purchaseScanVersion')::int,0)<>3 OR jsonb_typeof(result->'itensList') IS DISTINCT FROM 'array'
      OR jsonb_typeof(result->'itensOkList') IS DISTINCT FROM 'array' OR jsonb_typeof(result->'itensCobertosporPedido') IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'INVALID_SCAN'; END IF;
    INSERT INTO compras_snapshots(total_produtos_sem_estoque,total_produtos_ok,total_itens_cobertos_pedido,total_orcamentos,
      estimativa_total,orcamentos_convertidos_count,itens_list,config_used,status,duration_ms)
    VALUES(jsonb_array_length(result->'itensList'),jsonb_array_length(result->'itensOkList'),jsonb_array_length(result->'itensCobertosporPedido'),
      (result->>'totalOrcamentos')::int,(result->>'estimativaTotal')::numeric,jsonb_array_length(result->'orcamentosConvertidos'),
      result->'itensList',coalesce(p_payload->'config','{}')||jsonb_build_object('purchase_scan_version',3,
        'partial_operations_included',result->'partialOperationsIncluded','warnings',result->'warnings','partial_revision',p_payload->>'revision'),
      'success',(p_payload->>'duration_ms')::int) RETURNING id INTO snapshot_id;
    RETURN jsonb_build_object('id',snapshot_id);
  END IF;
  RAISE EXCEPTION 'UNSUPPORTED_ACTION';
END $function$;

COMMIT;
