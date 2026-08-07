CREATE OR REPLACE VIEW public.partial_writeoff_reservation_sources
WITH (security_invoker = on) AS
SELECT
  i.product_id,
  i.variation_id,
  i.product_code,
  i.product_name,
  i.reserved_quantity,
  o.id AS operation_id,
  o.budget_code,
  o.client_name,
  o.document_type,
  o.status,
  o.definitive_document_code,
  o.updated_at
FROM public.partial_writeoff_items i
JOIN public.partial_writeoff_operations o ON o.id = i.operation_id
WHERE i.reserved_quantity > 0;

GRANT SELECT ON public.partial_writeoff_reservation_sources TO authenticated, service_role;