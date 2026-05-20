
-- Singleton settings for purchase tracker watcher
CREATE TABLE public.purchase_tracker_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watched_situacao_ids text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.purchase_tracker_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read tracker settings"
  ON public.purchase_tracker_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated upsert tracker settings"
  ON public.purchase_tracker_settings FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated update tracker settings"
  ON public.purchase_tracker_settings FOR UPDATE TO authenticated USING (true);

-- Snapshot table
CREATE TABLE public.purchase_tracker_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'success',
  total int NOT NULL DEFAULT 0,
  warn_count int NOT NULL DEFAULT 0,
  crit_count int NOT NULL DEFAULT 0,
  arrival_overdue_count int NOT NULL DEFAULT 0,
  crit_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  arrival_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  duration_ms int
);

CREATE INDEX idx_tracker_snapshots_created_at ON public.purchase_tracker_snapshots(created_at DESC);

ALTER TABLE public.purchase_tracker_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read tracker snapshots"
  ON public.purchase_tracker_snapshots FOR SELECT TO authenticated USING (true);
