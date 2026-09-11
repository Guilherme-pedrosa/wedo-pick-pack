BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='partial_execution_worker_token') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'partial_execution_worker_token','Autenticação do verificador de execução de baixas parciais');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.partial_execution_authorized(p_token text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT length(p_token)=64 AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='partial_execution_worker_token' AND decrypted_secret=p_token);
$$;
REVOKE ALL ON FUNCTION public.partial_execution_authorized(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.partial_execution_authorized(text) TO service_role;

-- O job só deve ser ativado após confirmar a implantação da função.
SELECT cron.schedule('partial-execution-5min','*/5 * * * *',$job$
  SELECT net.http_post(
    url := 'https://yfqbhyadogytswelopsl.supabase.co/functions/v1/partial-execution-worker',
    headers := jsonb_build_object('Content-Type','application/json','x-internal-token',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='partial_execution_worker_token')),
    body := '{}'::jsonb, timeout_milliseconds := 180000
  );
$job$);
SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='partial-execution-5min';
COMMIT;
