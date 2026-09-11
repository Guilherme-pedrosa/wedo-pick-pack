// Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite module.
// Uses an isolated PostgreSQL WASM database; never connects to production.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const base = readFileSync(new URL('../supabase/migrations/20260805143000_partial_writeoff_flow.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260911170000_reopen_4784_awaiting_execution.sql', import.meta.url), 'utf8');
const operationId = '5d213137-682e-4901-9b3c-e0e7818cb83d';
async function fixture() {
  const db = new PGlite();
  await db.exec(base.split('CREATE OR REPLACE FUNCTION public.partial_writeoff_open_operation')[0]);
  await db.exec('CREATE OR REPLACE FUNCTION public.partial_writeoff_claim_consolidation' +
    base.split('CREATE OR REPLACE FUNCTION public.partial_writeoff_claim_consolidation')[1]
      .split('CREATE OR REPLACE FUNCTION public.partial_writeoff_finish_consolidation')[0]);
  await db.exec(`
    ALTER TABLE partial_writeoff_batches ADD COLUMN auvo_task_id text;
    CREATE TABLE os_generation_logs (id text, orcamento_id text, os_id text, success boolean, error_message text);
    INSERT INTO partial_writeoff_operations(id,budget_id,budget_code,client_id,client_name,document_type,status,budget_snapshot,definitive_document_id,definitive_document_code,definitive_auvo_task_id,completed_at)
    VALUES ('${operationId}','348836923','4784','client','Cliente','os','completed','{}','394003937','10138','78957536',now());
    INSERT INTO partial_writeoff_items(operation_id,line_key,product_id,product_name,original_quantity,withdrawn_quantity,line_snapshot)
      SELECT '${operationId}',i::text,i::text,'Item '||i,1,1,'{}' FROM generate_series(1,15) i;
    INSERT INTO partial_writeoff_batches(operation_id,sequence,idempotency_key,marker,status,auxiliary_document_type,auxiliary_document_id,confirmed_at,auvo_task_id)
    VALUES ('${operationId}',1,'key1','marker1','cancelled','os','389884274',now(),'78145019'),
      ('${operationId}',2,'key2','marker2','cancelled','os','393982618',now(),'78949564');
    INSERT INTO os_generation_logs VALUES ('log','348836923','394003937',true,NULL),('other','other','other',true,NULL);
  `);
  return db;
}
const db = await fixture();
try {
  await db.exec(migration);
  const op = (await db.query('SELECT * FROM partial_writeoff_operations')).rows[0];
  assert.equal(op.status, 'awaiting_execution');
  await assert.rejects(db.query('SELECT partial_writeoff_claim_consolidation($1)', [operationId]), /OPERATION_NOT_CONSOLIDATABLE:awaiting_execution/);
  for (const field of ['definitive_document_id','definitive_document_code','definitive_auvo_task_id','completed_at']) assert.equal(op[field], null);
  assert.equal((await db.query('SELECT sum(withdrawn_quantity)::int n FROM partial_writeoff_items')).rows[0].n, 15);
  assert.deepEqual((await db.query('SELECT status,auvo_task_id FROM partial_writeoff_batches ORDER BY sequence')).rows,
    [{status:'confirmed',auvo_task_id:'78145019'},{status:'confirmed',auvo_task_id:'78949564'}]);
  const event = (await db.query("SELECT payload FROM partial_writeoff_events WHERE event_type='premature_consolidation_reopened'")).rows[0].payload;
  assert.equal(event.previous_operation.definitive_auvo_task_id, '78957536');
  assert.equal(event.previous_batches.length, 2);
  assert.equal(event.previous_generation_logs[0].success, true);
  assert.equal((await db.query("SELECT success FROM os_generation_logs WHERE id='log'")).rows[0].success, false);
  assert.equal((await db.query("SELECT success FROM os_generation_logs WHERE id='other'")).rows[0].success, true);
  await assert.rejects(db.exec("UPDATE partial_writeoff_batches SET status='cancelled'"), /EXECUTION_PENDING_PRESERVE_CONFIRMED_WRITEOFF/);
  await db.exec(migration);
  assert.equal((await db.query('SELECT count(*)::int n FROM partial_writeoff_events')).rows[0].n, 1);
} finally { await db.close(); }
const changed = await fixture();
try {
  await changed.exec('UPDATE partial_writeoff_items SET withdrawn_quantity=0');
  await assert.rejects(changed.exec(migration), /4784_BALANCES_CHANGED_REVIEW_REQUIRED/);
  await changed.exec('ROLLBACK');
  assert.equal((await changed.query('SELECT status FROM partial_writeoff_operations')).rows[0].status,'completed');
  assert.equal((await changed.query('SELECT count(*)::int n FROM partial_writeoff_events')).rows[0].n,0);
} finally { await changed.close(); }
console.log('PASS: reabertura, saldos, tarefas, histórico, logs, bloqueio, reexecução e rollback em divergência.');
