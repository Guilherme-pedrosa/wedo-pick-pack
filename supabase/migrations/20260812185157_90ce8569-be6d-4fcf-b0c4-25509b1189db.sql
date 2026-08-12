CREATE TABLE public.auvo_customer_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gc_cliente_id text NOT NULL,
  gc_cliente_codigo text,
  gc_cliente_nome text NOT NULL,
  cnpj_normalizado text,
  auvo_customer_id text NOT NULL,
  auvo_customer_name text NOT NULL,
  usage_count integer NOT NULL DEFAULT 1,
  last_used_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT auvo_customer_links_unique_pair UNIQUE (gc_cliente_id, auvo_customer_id)
);

GRANT SELECT, INSERT, UPDATE ON public.auvo_customer_links TO authenticated;
GRANT ALL ON public.auvo_customer_links TO service_role;

ALTER TABLE public.auvo_customer_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read auvo customer links"
ON public.auvo_customer_links FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert auvo customer links"
ON public.auvo_customer_links FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update auvo customer links"
ON public.auvo_customer_links FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_auvo_customer_links_gc ON public.auvo_customer_links (gc_cliente_id);
CREATE INDEX idx_auvo_customer_links_cnpj ON public.auvo_customer_links (cnpj_normalizado);

CREATE TRIGGER update_auvo_customer_links_updated_at
BEFORE UPDATE ON public.auvo_customer_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();