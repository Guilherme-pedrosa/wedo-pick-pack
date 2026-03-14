ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS os_status_to_show text[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS venda_status_to_show text[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS default_os_conclusion_status text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS default_venda_conclusion_status text NOT NULL DEFAULT '';