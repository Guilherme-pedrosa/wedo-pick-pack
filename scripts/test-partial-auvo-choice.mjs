import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE TABLE profiles(id uuid PRIMARY KEY, auvo_user_id text);`);
  await db.exec(read('20260805143000_partial_writeoff_flow.sql'));
  await db.exec(read('20260807203500_partial_writeoff_global_stock_commitments.sql'));
  await db.exec('ALTER TABLE partial_writeoff_batches ADD COLUMN auvo_task_id text;');
  const op='11111111-1111-4111-8111-111111111111', item='22222222-2222-4222-8222-222222222222', user='33333333-3333-4333-8333-333333333333';
  await db.query(`INSERT INTO partial_writeoff_operations(id,budget_id,budget_code,client_id,client_name,document_type,budget_snapshot)
    VALUES($1,'budget','6438','client','Cliente','os','{"produtos":[{"quantidade":3}]}')`,[op]);
  await db.query(`INSERT INTO partial_writeoff_items(id,operation_id,line_key,product_id,product_name,original_quantity,line_snapshot)
    VALUES($1,$2,'p','p','Produto',3,'{}')`,[item,op]);
  await db.query(`INSERT INTO partial_writeoff_batches(operation_id,sequence,idempotency_key,marker,auxiliary_document_type,auvo_task_id)
    VALUES($1,1,'old','old','os','existing-task')`,[op]);
  await db.exec(read('20260911223000_partial_auvo_choice.sql'));
  const legacy = (await db.query("SELECT auvo_task_requested,auvo_task_id FROM partial_writeoff_batches WHERE idempotency_key='old'")).rows[0];
  assert.deepEqual(legacy,{auvo_task_requested:null,auvo_task_id:'existing-task'});
  const reserve=(key,choice,stock=3)=>db.query('SELECT partial_writeoff_reserve_batch_with_options($1,$2,$3::jsonb,$4,$5) AS r',[op,key,JSON.stringify([{item_id:item,quantity:1,stock_quantity:stock}]),choice,user]);
  const first=(await reserve('no',false)).rows[0].r;
  assert.equal((await reserve('no',false)).rows[0].r.batch_id,first.batch_id);
  await assert.rejects(reserve('yes',true),/Configure o usuário Auvo/);
  await db.query('INSERT INTO profiles VALUES($1,$2)',[user,'100']);
  await assert.rejects(reserve('no',true),/escolha Auvo deste lote/);
  await reserve('yes',true);
  await assert.rejects(reserve('over',false,2),/INSUFFICIENT_COMMITTED_STOCK/);
  await db.exec("UPDATE partial_writeoff_batches SET confirmed_at=now() WHERE idempotency_key='yes'");
  await assert.rejects(db.exec("UPDATE partial_writeoff_operations SET status='consolidating'"),/tarefa Auvo solicitada/);
  await db.exec("UPDATE partial_writeoff_batches SET auvo_task_id='new-task' WHERE idempotency_key='yes'");
  await db.exec("UPDATE partial_writeoff_operations SET status='consolidating'");
  const balances=(await db.query('SELECT original_quantity,reserved_quantity,withdrawn_quantity FROM partial_writeoff_items')).rows[0];
  assert.equal(Number(balances.original_quantity),3); assert.equal(Number(balances.reserved_quantity),2); assert.equal(Number(balances.withdrawn_quantity),0);
  assert.equal((await db.query('SELECT count(*)::int n FROM partial_writeoff_events WHERE event_type=\'auvo_task_choice\'')).rows[0].n,2);
  console.log('PASS: escolhas por lote, legado, repetição idempotente, estoque global, perfil Auvo e bloqueio da consolidação.');

  await db.exec(`ALTER TABLE profiles ADD COLUMN name text;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    UPDATE partial_writeoff_operations SET status='partial_separation';
    UPDATE partial_writeoff_batches SET status='awaiting_checkout',auxiliary_document_id='10226' WHERE idempotency_key='no';`);
  await db.exec(read('20260911230000_partial_auvo_late_request.sql'));
  assert.equal((await db.query('SELECT auvo_task_requested FROM partial_writeoff_batches WHERE id=$1',[first.batch_id])).rows[0].auvo_task_requested,false);
  const request=()=>db.query('SELECT partial_writeoff_request_auvo_task($1) AS r',[first.batch_id]);
  await assert.rejects(request(),/AUTH_REQUIRED/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
  const unchanged=async()=>JSON.stringify((await db.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM partial_writeoff_items i) AS items,
    (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM partial_writeoff_operations o) AS operations,
    (SELECT jsonb_agg(jsonb_build_object('id',b.id,'document',b.auxiliary_document_id,'task',b.auvo_task_id,'status',b.status) ORDER BY b.id) FROM partial_writeoff_batches b) AS documents`)).rows);
  const beforeLateRequest=await unchanged();
  assert.equal((await request()).rows[0].r.requested,true);
  await request();
  const events=(await db.query("SELECT payload,actor_id FROM partial_writeoff_events WHERE event_type='auvo_task_requested_later'")).rows;
  assert.equal(events.length,1); assert.equal(events[0].payload.previous_requested,false); assert.equal(events[0].actor_id,user);
  assert.equal(await unchanged(),beforeLateRequest);
  // Reuse an existing task, including a legacy batch, without reclassifying it.
  const old=(await db.query("SELECT id FROM partial_writeoff_batches WHERE idempotency_key='old'")).rows[0].id;
  assert.equal((await db.query('SELECT partial_writeoff_request_auvo_task($1) r',[old])).rows[0].r.auvo_task_id,'existing-task');
  for (const mutation of [
    "UPDATE partial_writeoff_operations SET status='cancelled'",
    "UPDATE partial_writeoff_operations SET definitive_document_id='final'",
    "UPDATE partial_writeoff_batches SET status='cancelled' WHERE idempotency_key='no'",
    "UPDATE partial_writeoff_batches SET auxiliary_document_id=NULL WHERE idempotency_key='no'",
    "UPDATE profiles SET auvo_user_id=NULL",
  ]) {
    await db.exec('BEGIN'); await db.exec(mutation);
    await assert.rejects(request(),/não está disponível|Configure o usuário Auvo/);
    await db.exec('ROLLBACK');
  }
  // Omitted option now defaults to true; explicit false still opts out.
  const defaultBatch=(await db.query(`SELECT partial_writeoff_reserve_batch_with_options(
    p_operation_id=>$1,p_idempotency_key=>'default-on',p_items=>$2::jsonb,p_actor_id=>$3) r`,
    [op,JSON.stringify([{item_id:item,quantity:1,stock_quantity:3}]),user])).rows[0].r;
  assert.equal((await db.query('SELECT auvo_task_requested FROM partial_writeoff_batches WHERE id=$1',[defaultBatch.batch_id])).rows[0].auvo_task_requested,true);
  assert.equal((await db.query("SELECT auvo_task_requested FROM partial_writeoff_batches WHERE idempotency_key='old'")).rows[0].auvo_task_requested,null);
  console.log('PASS: padrão marcado, solicitação posterior autenticada e auditada, repetição sem evento duplicado, preservação integral dos saldos/documentos e guardas de estado.');
} finally { await db.close(); }
