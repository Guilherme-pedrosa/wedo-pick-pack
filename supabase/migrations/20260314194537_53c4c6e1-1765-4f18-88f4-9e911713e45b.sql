
-- Toolboxes (maletas de ferramentas)
CREATE TABLE public.toolboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  technician_name text,
  technician_gc_id text,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

ALTER TABLE public.toolboxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read toolboxes" ON public.toolboxes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert own toolboxes" ON public.toolboxes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own toolboxes" ON public.toolboxes FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Toolbox items (ferramentas na maleta)
CREATE TABLE public.toolbox_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  toolbox_id uuid NOT NULL REFERENCES public.toolboxes(id) ON DELETE CASCADE,
  produto_id text NOT NULL,
  nome_produto text NOT NULL,
  quantidade integer NOT NULL DEFAULT 1,
  preco_unitario numeric DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.toolbox_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read toolbox_items" ON public.toolbox_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert toolbox_items" ON public.toolbox_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update toolbox_items" ON public.toolbox_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete toolbox_items" ON public.toolbox_items FOR DELETE TO authenticated USING (true);

-- Toolbox movement logs
CREATE TABLE public.toolbox_movement_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  toolbox_id uuid NOT NULL REFERENCES public.toolboxes(id),
  toolbox_name text NOT NULL,
  action text NOT NULL,
  produto_id text,
  produto_nome text,
  quantidade integer,
  preco_unitario numeric,
  ref_tipo text,
  ref_numero text,
  details text,
  operator_id uuid NOT NULL,
  operator_name text NOT NULL DEFAULT '',
  technician_name text,
  technician_gc_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.toolbox_movement_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read toolbox_movement_logs" ON public.toolbox_movement_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert toolbox_movement_logs" ON public.toolbox_movement_logs FOR INSERT TO authenticated WITH CHECK (true);

-- Toolbox conference records
CREATE TABLE public.toolbox_conference_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  toolbox_id uuid NOT NULL REFERENCES public.toolboxes(id),
  operator_id uuid NOT NULL,
  operator_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'completed',
  items_total integer NOT NULL DEFAULT 0,
  items_present integer NOT NULL DEFAULT 0,
  items_missing integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.toolbox_conference_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read toolbox_conference_records" ON public.toolbox_conference_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert toolbox_conference_records" ON public.toolbox_conference_records FOR INSERT TO authenticated WITH CHECK (true);

-- Conference items (checklist detail)
CREATE TABLE public.toolbox_conference_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id uuid NOT NULL REFERENCES public.toolbox_conference_records(id) ON DELETE CASCADE,
  toolbox_id uuid NOT NULL REFERENCES public.toolboxes(id),
  produto_id text NOT NULL,
  nome_produto text NOT NULL,
  quantidade_esperada integer NOT NULL DEFAULT 0,
  presente boolean NOT NULL DEFAULT false,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.toolbox_conference_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read toolbox_conference_items" ON public.toolbox_conference_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert toolbox_conference_items" ON public.toolbox_conference_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update toolbox_conference_items" ON public.toolbox_conference_items FOR UPDATE TO authenticated USING (true);
