-- Emergency quota protection: the full historical reconciliation must not run
-- automatically. It can be resumed only after an incremental, cursor-persisted
-- scheduler is deployed.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN (
  'inventory-consumption-daily-0400-brt',
  'inventory-consumption-daily-0400',
  'inventory-consumption-daily-0600',
  'inventory-consumption-daily-0600-brt'
);
