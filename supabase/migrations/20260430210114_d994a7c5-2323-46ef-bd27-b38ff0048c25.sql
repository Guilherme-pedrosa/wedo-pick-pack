
SELECT cron.schedule(
  'push-watcher-1min',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yfqbhyadogytswelopsl.supabase.co/functions/v1/push-watcher',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmcWJoeWFkb2d5dHN3ZWxvcHNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzcxMjQsImV4cCI6MjA4ODMxMzEyNH0.0WJQkaF2YgrBjejGHVZWdAKHgXM5hZoPScXOKPWJKdo"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
