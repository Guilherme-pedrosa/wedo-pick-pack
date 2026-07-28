-- The former 1-minute schedule multiplied every configured checkout status
-- and every recent separation into thousands of GestãoClick requests per day.
SELECT cron.unschedule('push-watcher-1min')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'push-watcher-1min'
);

SELECT cron.unschedule('push-watcher-5min')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'push-watcher-5min'
);

SELECT cron.schedule(
  'push-watcher-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yfqbhyadogytswelopsl.supabase.co/functions/v1/push-watcher',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
