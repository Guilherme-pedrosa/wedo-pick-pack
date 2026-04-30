
-- Web Push subscriptions per user/device
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  enabled boolean NOT NULL DEFAULT true,
  events jsonb NOT NULL DEFAULT '["new_order","order_taken","stock_conflict","stock_regression"]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own subscriptions select"
  ON public.push_subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users manage own subscriptions insert"
  ON public.push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own subscriptions update"
  ON public.push_subscriptions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users manage own subscriptions delete"
  ON public.push_subscriptions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Snapshot of last seen state (for the cron watcher to compute diffs)
CREATE TABLE public.push_watcher_state (
  id text PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_watcher_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read watcher state"
  ON public.push_watcher_state FOR SELECT TO authenticated USING (true);

-- Dedup log so we don't double-notify
CREATE TABLE public.push_event_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  event_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_type, event_key)
);

ALTER TABLE public.push_event_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read push_event_log"
  ON public.push_event_log FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_push_event_log_created ON public.push_event_log(created_at DESC);
CREATE INDEX idx_push_subs_user ON public.push_subscriptions(user_id);
