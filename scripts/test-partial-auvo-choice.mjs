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
} finally { await db.close(); }
