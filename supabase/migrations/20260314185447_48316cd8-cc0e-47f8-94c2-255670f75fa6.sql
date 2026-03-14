
CREATE TABLE public.box_handoff_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id uuid NOT NULL REFERENCES public.boxes(id) ON DELETE CASCADE,
  box_name text NOT NULL,
  technician_name text NOT NULL,
  technician_gc_id text NOT NULL,
  operator_id uuid NOT NULL,
  operator_name text NOT NULL DEFAULT '',
  items_count integer NOT NULL DEFAULT 0,
  total_value numeric NOT NULL DEFAULT 0,
  handed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.box_handoff_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read handoff logs"
  ON public.box_handoff_logs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert handoff logs"
  ON public.box_handoff_logs FOR INSERT TO authenticated
  WITH CHECK (true);
