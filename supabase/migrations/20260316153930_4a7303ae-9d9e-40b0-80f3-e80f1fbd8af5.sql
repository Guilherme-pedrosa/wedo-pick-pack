
CREATE TABLE public.os_generation_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  orcamento_codigo TEXT NOT NULL,
  orcamento_id TEXT NOT NULL,
  nome_cliente TEXT NOT NULL,
  os_id TEXT,
  os_codigo TEXT,
  auvo_task_id TEXT,
  operator_id UUID NOT NULL,
  operator_name TEXT NOT NULL DEFAULT '',
  valor_total NUMERIC DEFAULT 0,
  equipamento TEXT,
  warnings TEXT[],
  error_message TEXT,
  success BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE public.os_generation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert os_generation_logs"
  ON public.os_generation_logs FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read os_generation_logs"
  ON public.os_generation_logs FOR SELECT TO authenticated
  USING (true);
