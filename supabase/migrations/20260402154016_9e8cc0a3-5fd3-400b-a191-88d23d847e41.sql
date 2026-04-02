
-- Clear old OS consumption events and their doc_stock_effect records
-- so the next sync re-processes them with correct occurred_at dates
DELETE FROM public.inventory_consumption_events WHERE source_type = 'os';
DELETE FROM public.doc_stock_effect WHERE doc_type = 'os';
