CREATE TABLE public.gc_status_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_type text NOT NULL,
  order_id text NOT NULL,
  situacao_id text,
  nome_situacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_type, order_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gc_status_snapshots TO authenticated;
GRANT ALL ON public.gc_status_snapshots TO service_role;

ALTER TABLE public.gc_status_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read gc status snapshots"
  ON public.gc_status_snapshots FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert gc status snapshots"
  ON public.gc_status_snapshots FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update gc status snapshots"
  ON public.gc_status_snapshots FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_gc_status_snapshots_updated_at
  BEFORE UPDATE ON public.gc_status_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();