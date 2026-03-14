
CREATE TABLE public.technicians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gc_id text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read technicians"
  ON public.technicians FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert technicians"
  ON public.technicians FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update technicians"
  ON public.technicians FOR UPDATE TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete technicians"
  ON public.technicians FOR DELETE TO authenticated
  USING (true);
