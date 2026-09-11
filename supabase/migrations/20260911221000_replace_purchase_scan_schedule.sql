-- O workflow purchase-scan.yml só assume após existir um resultado validado do motor novo.
-- Execução verificada em produção: GitHub Actions 34634722689 (d448e2a).
SELECT cron.alter_job(jobid, active := false)
FROM cron.job
WHERE jobname = 'compras-auto-scan-3h'
  AND EXISTS (SELECT 1 FROM public.compras_snapshots
    WHERE status = 'success' AND config_used->>'purchase_scan_version' = '2');
