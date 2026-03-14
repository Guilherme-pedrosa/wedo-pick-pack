
CREATE TABLE public.box_movement_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id uuid NOT NULL REFERENCES public.boxes(id) ON DELETE CASCADE,
  box_name text NOT NULL,
  action text NOT NULL,
  produto_id text,
  produto_nome text,
  quantidade integer,
  preco_unitario numeric,
  ref_tipo text,
  ref_numero text,
  technician_name text,
  technician_gc_id text,
  operator_id uuid NOT NULL,
  operator_name text NOT NULL DEFAULT '',
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.box_movement_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read movement logs"
  ON public.box_movement_logs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert movement logs"
  ON public.box_movement_logs FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE INDEX idx_box_movement_logs_box_id ON public.box_movement_logs(box_id);
CREATE INDEX idx_box_movement_logs_action ON public.box_movement_logs(action);
CREATE INDEX idx_box_movement_logs_created_at ON public.box_movement_logs(created_at DESC);
