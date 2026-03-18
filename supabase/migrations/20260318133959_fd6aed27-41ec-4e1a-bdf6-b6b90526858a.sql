
CREATE TABLE public.supplier_lead_times (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id text NOT NULL,
  fornecedor_nome text NOT NULL,
  avg_lead_time_days numeric NOT NULL DEFAULT 0,
  min_lead_time_days numeric NOT NULL DEFAULT 0,
  max_lead_time_days numeric NOT NULL DEFAULT 0,
  sample_count integer NOT NULL DEFAULT 0,
  samples jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(fornecedor_id)
);

ALTER TABLE public.supplier_lead_times ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read supplier_lead_times"
  ON public.supplier_lead_times FOR SELECT TO authenticated USING (true);
