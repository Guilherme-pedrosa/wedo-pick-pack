
CREATE TABLE public.separations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  order_type text NOT NULL CHECK (order_type IN ('os', 'venda')),
  order_id text NOT NULL,
  order_code text NOT NULL,
  client_name text NOT NULL,
  status_name text NOT NULL,
  status_id text NOT NULL,
  target_status_id text NOT NULL,
  target_status_name text NOT NULL DEFAULT '',
  total_value text NOT NULL DEFAULT '0.00',
  items_total integer NOT NULL DEFAULT 0,
  items_confirmed integer NOT NULL DEFAULT 0,
  operator_name text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL,
  concluded_at timestamptz NOT NULL DEFAULT now(),
  invalidated boolean NOT NULL DEFAULT false,
  invalidated_at timestamptz,
  invalidated_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.separations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert separations"
  ON public.separations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can read separations"
  ON public.separations FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update own separations"
  ON public.separations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can update any separation"
  ON public.separations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
