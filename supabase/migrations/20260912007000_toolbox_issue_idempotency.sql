BEGIN;
CREATE TABLE public.toolbox_stock_issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), toolbox_id uuid NOT NULL REFERENCES public.toolboxes(id),
 technician_gc_id text NOT NULL, technician_name text NOT NULL, items jsonb NOT NULL,
 status text NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','confirmed')),
 result jsonb, actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz
);
CREATE UNIQUE INDEX toolbox_stock_issue_pending ON public.toolbox_stock_issues(toolbox_id) WHERE status='processing';
ALTER TABLE public.toolbox_stock_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.toolbox_stock_issues FROM anon,authenticated;
CREATE FUNCTION public.toolbox_stock_issue_claim(p_toolbox_id uuid,p_technician_gc_id text,p_technician_name text,p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_box toolboxes; v_id uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT * INTO v_box FROM toolboxes WHERE id=p_toolbox_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TOOLBOX_NOT_FOUND'; END IF;
 IF nullif(v_box.technician_gc_id,'') IS NOT NULL OR nullif(v_box.venda_gc_id,'') IS NOT NULL THEN RAISE EXCEPTION 'Esta maleta já possui técnico ou saída vinculada. Atualize a tela.'; END IF;
 IF EXISTS(SELECT 1 FROM toolbox_stock_issues WHERE toolbox_id=p_toolbox_id AND status='processing') THEN
   RAISE EXCEPTION 'Há uma saída de estoque sem confirmação para esta maleta. Confira a integração antes de repetir o ajuste.';
 END IF;
 IF coalesce(p_technician_gc_id,'')='' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'INVALID_ISSUE'; END IF;
 INSERT INTO toolbox_stock_issues(toolbox_id,technician_gc_id,technician_name,items,actor_id)
 VALUES(p_toolbox_id,p_technician_gc_id,p_technician_name,p_items,auth.uid()) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
CREATE FUNCTION public.toolbox_stock_issue_finish(p_id uuid,p_result jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_issue toolbox_stock_issues; v_box toolboxes;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT * INTO v_issue FROM toolbox_stock_issues WHERE id=p_id AND actor_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ISSUE_NOT_CLAIMED'; END IF;
 IF v_issue.status='confirmed' THEN RETURN; END IF;
 IF p_result->>'success' IS DISTINCT FROM 'true' OR coalesce(p_result->>'venda_gc_id','')='' THEN RAISE EXCEPTION 'GC_ISSUE_NOT_CONFIRMED'; END IF;
 SELECT * INTO v_box FROM toolboxes WHERE id=v_issue.toolbox_id FOR UPDATE;
 IF nullif(v_box.technician_gc_id,'') IS NOT NULL OR nullif(v_box.venda_gc_id,'') IS NOT NULL THEN RAISE EXCEPTION 'TOOLBOX_LINK_CHANGED'; END IF;
 UPDATE toolboxes SET technician_gc_id=v_issue.technician_gc_id,technician_name=v_issue.technician_name,venda_gc_id=p_result->>'venda_gc_id' WHERE id=v_issue.toolbox_id;
 UPDATE toolbox_stock_issues SET status='confirmed',result=p_result,confirmed_at=now() WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.toolbox_stock_issue_claim(uuid,text,text,jsonb),public.toolbox_stock_issue_finish(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.toolbox_stock_issue_claim(uuid,text,text,jsonb),public.toolbox_stock_issue_finish(uuid,jsonb) TO authenticated;
COMMIT;
