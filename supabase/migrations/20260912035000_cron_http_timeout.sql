BEGIN;
-- O padrão de 5s encerrava a conexão antes das rotinas de 30-40s terminarem.
-- Mantém destinos, credenciais e horários existentes; altera apenas o timeout.
DO $$
DECLARE job record; changed text;
BEGIN
 FOR job IN SELECT jobid,command FROM cron.job WHERE active AND jobname IN
   ('sync-products-full','sync-products-incremental','sync-products-daily-23h','purchase-tracker-snapshot-hourly','separations-status-daily-06h','push-watcher-5min') LOOP
   IF job.command ~* 'timeout_milliseconds' THEN CONTINUE; END IF;
   changed:=regexp_replace(job.command,'\)\s*(AS request_id)?;\s*$',', timeout_milliseconds := 60000 ) \1;','i');
   IF changed=job.command THEN RAISE EXCEPTION 'CRON_COMMAND_FORMAT_CHANGED:%',job.jobid; END IF;
   PERFORM cron.alter_job(job.jobid,command:=changed);
 END LOOP;
END $$;
COMMIT;
