-- A sincronizacao geral ignora documentos auxiliares da baixa parcial para
-- impedir dupla contagem. O consumo desses documentos, portanto, precisa ser
-- alimentado pelo lote confirmado no Pick & Pack (fonte oficial da quantidade).

CREATE OR REPLACE FUNCTION public.partial_writeoff_refresh_inventory_consumption(
  p_batch_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch record;
  v_situacao_id text;
  v_event_count integer := 0;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT
    b.id,
    b.operation_id,
    b.status,
    b.auxiliary_document_type,
    b.auxiliary_document_id,
    b.auxiliary_document_code,
    b.confirmed_at,
    b.created_at,
    o.client_name,
    CASE
      WHEN o.budget_id ~* '^venda:' THEN 'venda'
      WHEN o.budget_id ~* '^os:' THEN 'os'
      ELSE lower(trim(coalesce(o.budget_snapshot->>'_partial_source_kind', '')))
    END AS source_kind
  INTO v_batch
  FROM public.partial_writeoff_batches b
  JOIN public.partial_writeoff_operations o ON o.id = b.operation_id
  WHERE b.id = p_batch_id
  FOR UPDATE OF b;

  IF NOT FOUND OR v_batch.auxiliary_document_id IS NULL THEN
    RETURN 0;
  END IF;

  -- O documento auxiliar pertence exclusivamente a este lote. Refazer suas
  -- linhas torna confirmacao, compensacao e retrocorrecao idempotentes.
  DELETE FROM public.inventory_consumption_events
  WHERE source_type = v_batch.auxiliary_document_type
    AND source_id = v_batch.auxiliary_document_id;

  -- Para venda-fonte, o lote vale somente enquanto confirmado; ao consolidar,
  -- a propria venda original passa a representar o total. Para orcamentos, o
  -- documento definitivo contem apenas o saldo ainda nao entregue, entao os
  -- lotes confirmados precisam permanecer depois da consolidacao.
  IF NOT (
    v_batch.status = 'confirmed'
    OR (
      v_batch.status = 'consolidated'
      AND v_batch.confirmed_at IS NOT NULL
      AND v_batch.source_kind <> 'venda'
    )
  ) THEN
    UPDATE public.doc_stock_effect
    SET debited = false,
        debited_at = NULL,
        debit_situacao_id = NULL,
        last_seen_at = v_now
    WHERE doc_type = v_batch.auxiliary_document_type
      AND doc_id = v_batch.auxiliary_document_id;
    RETURN 0;
  END IF;

  SELECT CASE v_batch.auxiliary_document_type
    WHEN 'os' THEN os_stock_status_id
    ELSE venda_stock_status_id
  END
  INTO v_situacao_id
  FROM public.partial_writeoff_settings
  WHERE singleton = true;

  v_situacao_id := coalesce(nullif(trim(v_situacao_id), ''), '7347355');

  INSERT INTO public.inventory_consumption_events (
    occurred_at,
    source_type,
    source_id,
    situacao_id,
    produto_id,
    variacao_id,
    qty,
    valor_custo,
    raw,
    cliente_nome
  )
  SELECT
    coalesce(v_batch.confirmed_at, v_batch.created_at, v_now),
    v_batch.auxiliary_document_type,
    v_batch.auxiliary_document_id,
    v_situacao_id,
    i.product_id,
    nullif(i.variation_id, ''),
    bi.quantity,
    CASE
      WHEN trim(coalesce(i.line_snapshot->'produto'->>'valor_custo', ''))
        ~ '^[+-]?[0-9]+([.,][0-9]+)?$'
      THEN replace(trim(i.line_snapshot->'produto'->>'valor_custo'), ',', '.')::numeric
      ELSE NULL
    END,
    coalesce(i.line_snapshot->'produto', i.line_snapshot, '{}'::jsonb)
      || jsonb_build_object(
        'partial_writeoff_batch_id', v_batch.id,
        'partial_writeoff_item_id', i.id,
        'partial_writeoff_operation_id', v_batch.operation_id,
        'partial_writeoff_document_code', v_batch.auxiliary_document_code,
        'partial_writeoff_quantity_source', 'confirmed_batch'
      ),
    nullif(trim(v_batch.client_name), '')
  FROM public.partial_writeoff_batch_items bi
  JOIN public.partial_writeoff_items i ON i.id = bi.item_id
  WHERE bi.batch_id = v_batch.id
    AND bi.quantity > 0
    AND nullif(trim(i.product_id), '') IS NOT NULL;

  GET DIAGNOSTICS v_event_count = ROW_COUNT;

  INSERT INTO public.doc_stock_effect (
    doc_type,
    doc_id,
    debited,
    debited_at,
    debit_situacao_id,
    first_seen_at,
    last_seen_at
  ) VALUES (
    v_batch.auxiliary_document_type,
    v_batch.auxiliary_document_id,
    true,
    coalesce(v_batch.confirmed_at, v_now),
    v_situacao_id,
    coalesce(v_batch.created_at, v_now),
    v_now
  )
  ON CONFLICT (doc_type, doc_id) DO UPDATE
  SET debited = EXCLUDED.debited,
      debited_at = EXCLUDED.debited_at,
      debit_situacao_id = EXCLUDED.debit_situacao_id,
      last_seen_at = EXCLUDED.last_seen_at;

  RETURN v_event_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.partial_writeoff_inventory_consumption_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.auxiliary_document_id IS NOT NULL
    AND (
      OLD.auxiliary_document_type IS DISTINCT FROM NEW.auxiliary_document_type
      OR OLD.auxiliary_document_id IS DISTINCT FROM NEW.auxiliary_document_id
    )
  THEN
    DELETE FROM public.inventory_consumption_events
    WHERE source_type = OLD.auxiliary_document_type
      AND source_id = OLD.auxiliary_document_id;

    UPDATE public.doc_stock_effect
    SET debited = false,
        debited_at = NULL,
        debit_situacao_id = NULL,
        last_seen_at = clock_timestamp()
    WHERE doc_type = OLD.auxiliary_document_type
      AND doc_id = OLD.auxiliary_document_id;
  END IF;

  PERFORM public.partial_writeoff_refresh_inventory_consumption(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_partial_writeoff_inventory_consumption
ON public.partial_writeoff_batches;

CREATE TRIGGER trg_partial_writeoff_inventory_consumption
AFTER INSERT OR UPDATE OF
  status,
  auxiliary_document_type,
  auxiliary_document_id,
  confirmed_at
ON public.partial_writeoff_batches
FOR EACH ROW
EXECUTE FUNCTION public.partial_writeoff_inventory_consumption_trigger();

CREATE INDEX IF NOT EXISTS idx_consumption_partial_writeoff_batch
ON public.inventory_consumption_events ((raw->>'partial_writeoff_batch_id'))
WHERE raw ? 'partial_writeoff_batch_id';

-- Corrige os lotes confirmados antes desta migration. Lotes cancelados ou
-- consolidados de orcamentos permanecem porque o documento definitivo leva
-- apenas o saldo; consolidados de uma venda-fonte saem para a venda integral
-- assumir o consumo sem duplicidade.
DO $$
DECLARE
  v_batch record;
BEGIN
  FOR v_batch IN
    SELECT id
    FROM public.partial_writeoff_batches
    WHERE (
        status = 'confirmed'
        OR (
          status = 'consolidated'
          AND confirmed_at IS NOT NULL
          AND operation_id IN (
            SELECT o.id
            FROM public.partial_writeoff_operations o
            WHERE CASE
              WHEN o.budget_id ~* '^venda:' THEN 'venda'
              ELSE lower(trim(coalesce(o.budget_snapshot->>'_partial_source_kind', '')))
            END <> 'venda'
          )
        )
      )
      AND auxiliary_document_id IS NOT NULL
  LOOP
    PERFORM public.partial_writeoff_refresh_inventory_consumption(v_batch.id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.partial_writeoff_refresh_inventory_consumption(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_refresh_inventory_consumption(uuid)
TO service_role;

COMMENT ON FUNCTION public.partial_writeoff_refresh_inventory_consumption(uuid) IS
'Materializa na analise de estoque somente as quantidades confirmadas de um lote de baixa parcial.';
