BEGIN;
CREATE TABLE IF NOT EXISTS public.toolbox_stock_returns (
 request_key text PRIMARY KEY, reference text NOT NULL, status text NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','confirmed')),
 result jsonb, actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz
);
ALTER TABLE public.toolbox_stock_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.toolbox_stock_returns FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.toolbox_stock_return_claim(p_key text,p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row toolbox_stock_returns; v_count int;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF coalesce(length(p_key),0)<>64 OR coalesce(length(p_reference),0)=0 THEN RAISE EXCEPTION 'INVALID_RETURN_REFERENCE'; END IF;
 INSERT INTO toolbox_stock_returns(request_key,reference,actor_id) VALUES(p_key,p_reference,auth.uid()) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 SELECT * INTO v_row FROM toolbox_stock_returns WHERE request_key=p_key FOR UPDATE;
 IF v_row.reference<>p_reference THEN RAISE EXCEPTION 'RETURN_REFERENCE_CHANGED'; END IF;
 IF v_row.status='confirmed' THEN RETURN jsonb_build_object('claimed',false,'result',v_row.result); END IF;
 IF v_count=0 THEN RAISE EXCEPTION 'Estorno já iniciado. Confira o estoque e o registro da integração antes de repetir; o vínculo foi preservado.'; END IF;
 RETURN jsonb_build_object('claimed',true);
END $$;
CREATE OR REPLACE FUNCTION public.toolbox_stock_return_finish(p_key text,p_result jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF p_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'GC_RETURN_NOT_CONFIRMED'; END IF;
 UPDATE toolbox_stock_returns SET status='confirmed',result=p_result,confirmed_at=now()
 WHERE request_key=p_key AND actor_id=auth.uid() AND status='processing';
 IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM toolbox_stock_returns WHERE request_key=p_key AND status='confirmed') THEN RAISE EXCEPTION 'RETURN_NOT_CLAIMED'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.toolbox_stock_return_claim(text,text),public.toolbox_stock_return_finish(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.toolbox_stock_return_claim(text,text),public.toolbox_stock_return_finish(text,jsonb) TO authenticated;
COMMIT;
