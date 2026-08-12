import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('GestãoClick quota guards', () => {
  it.each([
    'supabase/functions/create-gc-purchase-from-suggestions/index.ts',
    'supabase/functions/estoque-ai-chat/index.ts',
    'supabase/functions/gc-proxy/index.ts',
    'supabase/functions/generate-os/index.ts',
    'supabase/functions/inventory-lead-time-sync/index.ts',
    'supabase/functions/partial-writeoff/index.ts',
    'supabase/functions/purchase-tracker-snapshot/index.ts',
    'supabase/functions/separations-status-daily/index.ts',
    'supabase/functions/sync-products/index.ts',
    'supabase/functions/toolbox-stock-movement/index.ts',
  ])('%s routes direct GestãoClick requests through the API-user guard', (path) => {
    expect(source(path)).toContain('withGcApiUser');
  });

  it.each([
    'supabase/functions/create-gc-purchase-from-suggestions/index.ts',
    'supabase/functions/estoque-ai-chat/index.ts',
    'supabase/functions/gc-proxy/index.ts',
    'supabase/functions/generate-os/index.ts',
    'supabase/functions/partial-writeoff/index.ts',
    'supabase/functions/toolbox-stock-movement/index.ts',
  ])('%s forces the API user into GestãoClick write payloads', (path) => {
    expect(source(path)).toContain('withGcApiUserPayload');
  });

  it('disables every known name of the expensive inventory cron', () => {
    const migration = source(
      'supabase/migrations/20260812090000_disable_inventory_consumption_heavy_crons.sql',
    );

    expect(migration).toContain('inventory-consumption-daily-0400-brt');
    expect(migration).toContain('inventory-consumption-daily-0600');
    expect(migration).toContain('cron.unschedule(jobid)');
  });

  it('keeps the deployed daily orchestrator stop-on-429 and no-progress guards', () => {
    const daily = source('supabase/functions/inventory-consumption-daily/index.ts');

    expect(daily).toMatch(/data\?\.retry === true/);
    expect(daily).toMatch(/RATE_LIMIT\|429/);
    expect(daily).toContain("cursorKey(nextCursor) === prevKey");
    expect(daily).not.toContain('selfUrl');
  });
});
