-- Prevents the same physical stock from being reserved by concurrent partial
-- write-off operations. The GestãoClick stock snapshot is supplied by the
-- application and validated atomically against every reservation in progress.

CREATE OR REPLACE VIEW public.partial_writeoff_item_balances AS
SELECT
  i.*,
  (i.original_quantity - i.withdrawn_quantity) AS pending_purchase_quantity,
  (i.original_quantity - i.withdrawn_quantity - i.reserved_quantity) AS available_to_reserve_quantity,
  sum(i.reserved_quantity) OVER (
    PARTITION BY i.product_id, i.variation_id
  ) AS global_reserved_quantity,
  sum(i.reserved_quantity) OVER (
    PARTITION BY i.product_id, i.variation_id
  ) - sum(i.reserved_quantity) OVER (
    PARTITION BY i.operation_id, i.product_id, i.variation_id
  ) AS reserved_other_operations_quantity
FROM public.partial_writeoff_items i;

GRANT SELECT ON public.partial_writeoff_item_balances TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.partial_writeoff_reserve_batch(
  p_operation_id uuid,
  p_idempotency_key text,
  p_items jsonb,
  p_actor_id uuid DEFAULT NULL,
  p_actor_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id uuid;
  v_sequence integer;
  v_document_type text;
  v_status text;
  v_row record;
  v_available numeric;
  v_global_reserved numeric;
  v_available_stock numeric;
  v_marker text;
BEGIN
  SELECT id INTO v_batch_id
  FROM public.partial_writeoff_batches
  WHERE idempotency_key = p_idempotency_key;
  IF v_batch_id IS NOT NULL THEN
    RETURN jsonb_build_object('batch_id', v_batch_id, 'existing', true);
  END IF;

  SELECT document_type, status
  INTO v_document_type, v_status
  FROM public.partial_writeoff_operations
  WHERE id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'OPERATION_NOT_FOUND'; END IF;
  IF v_status NOT IN ('awaiting_separation', 'partial_separation', 'awaiting_balance') THEN
    RAISE EXCEPTION 'OPERATION_NOT_RESERVABLE:%', v_status;
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_BATCH';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS requested(item_id uuid, quantity numeric, stock_quantity numeric)
    GROUP BY requested.item_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_BATCH_ITEM';
  END IF;

  SELECT coalesce(max(sequence), 0) + 1 INTO v_sequence
  FROM public.partial_writeoff_batches
  WHERE operation_id = p_operation_id;

  v_marker := 'PP-PARCIAL-' || upper(v_document_type) || '-' || replace(p_operation_id::text, '-', '') || '-' || v_sequence;

  INSERT INTO public.partial_writeoff_batches (
    operation_id, sequence, idempotency_key, marker, auxiliary_document_type
  ) VALUES (
    p_operation_id, v_sequence, p_idempotency_key, v_marker, v_document_type
  ) RETURNING id INTO v_batch_id;

  -- Stable ordering plus one transaction-level lock per stock key prevents
  -- double reservation and deadlocks between operations containing many items.
  FOR v_row IN
    SELECT
      i.id AS item_id,
      i.product_id,
      i.variation_id,
      i.product_name,
      requested.quantity,
      requested.stock_quantity
    FROM jsonb_to_recordset(p_items) AS requested(item_id uuid, quantity numeric, stock_quantity numeric)
    JOIN public.partial_writeoff_items i
      ON i.id = requested.item_id
     AND i.operation_id = p_operation_id
    ORDER BY i.product_id, i.variation_id, i.id
  LOOP
    IF v_row.quantity IS NULL OR v_row.quantity <= 0 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY';
    END IF;
    IF v_row.stock_quantity IS NULL OR v_row.stock_quantity < 0 THEN
      RAISE EXCEPTION 'STOCK_SNAPSHOT_REQUIRED';
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'partial-writeoff-stock:' || v_row.product_id || ':' || coalesce(v_row.variation_id, ''),
        0
      )
    );

    SELECT original_quantity - reserved_quantity - withdrawn_quantity
    INTO v_available
    FROM public.partial_writeoff_items
    WHERE id = v_row.item_id AND operation_id = p_operation_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_FOUND'; END IF;
    IF v_row.quantity > v_available THEN
      RAISE EXCEPTION 'QUANTITY_EXCEEDS_PENDING:%:%', v_row.quantity, v_available;
    END IF;

    SELECT coalesce(sum(reserved_quantity), 0)
    INTO v_global_reserved
    FROM public.partial_writeoff_items
    WHERE product_id = v_row.product_id
      AND variation_id = v_row.variation_id;

    v_available_stock := greatest(v_row.stock_quantity - v_global_reserved, 0);
    IF v_row.quantity > v_available_stock THEN
      RAISE EXCEPTION 'INSUFFICIENT_COMMITTED_STOCK:%:%:%:%',
        regexp_replace(v_row.product_name, ':', '-', 'g'),
        v_row.stock_quantity,
        v_global_reserved,
        v_available_stock;
    END IF;

    UPDATE public.partial_writeoff_items
    SET reserved_quantity = reserved_quantity + v_row.quantity
    WHERE id = v_row.item_id;

    INSERT INTO public.partial_writeoff_batch_items (batch_id, item_id, quantity)
    VALUES (v_batch_id, v_row.item_id, v_row.quantity);
  END LOOP;

  -- A malformed request containing an unknown item would otherwise create an
  -- empty/partial batch because the join above cannot return that item.
  IF (SELECT count(*) FROM public.partial_writeoff_batch_items WHERE batch_id = v_batch_id)
     <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  UPDATE public.partial_writeoff_operations
  SET status = 'partial_separation', version = version + 1
  WHERE id = p_operation_id;

  INSERT INTO public.partial_writeoff_events (
    operation_id, batch_id, event_type, payload, actor_id, actor_name
  ) VALUES (
    p_operation_id,
    v_batch_id,
    'batch_reserved',
    jsonb_build_object('items', p_items, 'stock_control', 'global_atomic_commitment'),
    p_actor_id,
    p_actor_name
  );

  RETURN jsonb_build_object('batch_id', v_batch_id, 'existing', false);
END;
$$;

REVOKE ALL ON FUNCTION public.partial_writeoff_reserve_batch(uuid, text, jsonb, uuid, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partial_writeoff_reserve_batch(uuid, text, jsonb, uuid, text)
TO authenticated, service_role;

COMMENT ON FUNCTION public.partial_writeoff_reserve_batch(uuid, text, jsonb, uuid, text) IS
  'Atomically reserves partial write-off stock across all active OS/sales using a live GestãoClick stock snapshot.';
