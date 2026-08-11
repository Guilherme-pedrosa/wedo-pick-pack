CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'inventory-consumption-daily-0600';

-- pg_cron usa UTC: 09:00 UTC = 06:00 em America/Sao_Paulo.
-- A função faz somente duas varreduras paginadas (Vendas e OS), evitando a
-- multiplicação de requisições por situação que existia no sincronizador antigo.
SELECT cron.schedule(
  'inventory-consumption-daily-0600',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://yfqbhyadogytswelopsl.supabase.co/functions/v1/inventory-consumption-daily',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
