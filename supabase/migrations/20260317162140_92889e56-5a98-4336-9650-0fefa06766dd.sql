
-- System-wide audit log table
CREATE TABLE public.system_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  user_name TEXT NOT NULL DEFAULT '',
  module TEXT NOT NULL,        -- e.g. 'checkout', 'compras', 'controle_caixas', 'controle_maletas', 'rastreador', 'config', 'admin'
  action TEXT NOT NULL,        -- e.g. 'separacao_concluida', 'caixa_criada', 'item_adicionado', 'login'
  entity_type TEXT,            -- e.g. 'box', 'toolbox', 'separation', 'os', 'user'
  entity_id TEXT,              -- ID of the affected entity
  entity_name TEXT,            -- human-readable name
  details JSONB,               -- any extra context
  ip_address TEXT
);

-- Enable RLS
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read logs (admins will filter in UI)
CREATE POLICY "Authenticated users can read system_logs"
  ON public.system_logs FOR SELECT TO authenticated
  USING (true);

-- All authenticated users can insert their own logs
CREATE POLICY "Users can insert own system_logs"
  ON public.system_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Index for fast queries
CREATE INDEX idx_system_logs_created_at ON public.system_logs (created_at DESC);
CREATE INDEX idx_system_logs_user_id ON public.system_logs (user_id);
CREATE INDEX idx_system_logs_module ON public.system_logs (module);
CREATE INDEX idx_system_logs_action ON public.system_logs (action);
