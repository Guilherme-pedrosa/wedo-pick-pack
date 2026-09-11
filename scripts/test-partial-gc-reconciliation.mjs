import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const op='11111111-1111-4111-8111-111111111111', item='22222222-2222-4222-8222-222222222222';
const missing='44444444-4444-4444-8444-444444444444', actor='33333333-3333-4333-8333-333333333333';
const batch='55555555-5555-4555-8555-555555555555';
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    CREATE TABLE profiles(id uuid PRIMARY KEY, name text);`);
  await db.exec(read('20260805143000_partial_writeoff_flow.sql'));
  await db.exec(`ALTER TABLE partial_writeoff_batches ADD COLUMN auvo_task_id text;
    ALTER TABLE partial_writeoff_batches ADD COLUMN auvo_task_requested boolean;`);
  await db.exec(read('20260911233000_reconcile_confirmed_gc_debit.sql'));
  await db.query(`INSERT INTO profiles VALUES($1,'Operador');
    `,[actor]);
  const source={id:'source',codigo:'6276',cliente_id:'client',produtos:[{produto:{produto_id:'p',quantidade:'2'}},{produto:{produto_id:'missing',quantidade:'1'}}],valor_total:'100.00'};
  await db.query(`INSERT INTO partial_writeoff_operations(id,budget_id,budget_code,client_id,client_name,document_type,budget_snapshot)
    VALUES($1,'source','6276','client','Sapore','os',$2)`,[op,source]);
  await db.query(`INSERT INTO partial_writeoff_items(id,operation_id,line_key,product_id,variation_id,product_name,original_quantity,reserved_quantity,line_snapshot)
    VALUES($1,$2,'p','p','v','Peça baixada',2,2,'{}'),($3,$2,'missing','missing','','Vedação',1,0,'{}')`,[item,op,missing]);
  await db.query(`INSERT INTO partial_writeoff_batches(id,operation_id,sequence,idempotency_key,marker,status,auxiliary_document_type,auxiliary_document_id,auxiliary_document_code,auvo_task_id,auvo_task_requested,error_message)
    VALUES($1,$2,1,'key','marker','reconciliation_required','os','doc','10224','preserve-task',true,'Falha antiga')`,[batch,op]);
  await db.query(`INSERT INTO partial_writeoff_batch_items VALUES($1,$2,2)`,[batch,item]);
  const doc={id:'doc',codigo:'10224',cliente_id:'client',situacao_id:'other-status',nome_situacao:'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO',situacao_estoque:'1',observacoes:'[marker]',produtos:[{produto:{produto_id:'p',variacao_id:'v',quantidade:'2.0000',movimenta_estoque:'1'}}]};
  const run=(document=doc,budget=source)=>db.query('SELECT partial_writeoff_reconcile_gc_debit($1,$2,$3) r',[batch,document,budget]);
  await assert.rejects(run(),/AUTH_REQUIRED/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);
  const bad=[
    [{...doc,situacao_estoque:'0'},/GC_STOCK_NOT_APPLIED/],
    [{...doc,id:'other'},/GC_DOCUMENT_IDENTITY_CHANGED/],
    [{...doc,observacoes:''},/GC_DOCUMENT_IDENTITY_CHANGED/],
    [{...doc,cliente_id:'other'},/GC_DOCUMENT_IDENTITY_CHANGED/],
    [{...doc,nome_situacao:'CANCELADA'},/GC_DOCUMENT_CANCELLED/],
    [{...doc,produtos:[]},/AUXILIARY_ITEMS_CHANGED/],
    [{...doc,produtos:[{produto:{produto_id:'p',variacao_id:'v',quantidade:'1'}}]},/AUXILIARY_ITEMS_CHANGED/],
    [{...doc,produtos:[{produto:{produto_id:'p',variacao_id:'other',quantidade:'2'}}]},/AUXILIARY_ITEMS_CHANGED/],
    [{...doc,produtos:[{produto:{produto_id:'p',variacao_id:'v',quantidade:'2',movimenta_estoque:'0'}}]},/GC_ITEM_STOCK_NOT_APPLIED/],
  ];
  for (const [document,error] of bad) await assert.rejects(run(document),error);
  await assert.rejects(run(doc,{...source,id:'other'}),/BUDGET_IDENTITY_CHANGED/);
  for(const mutation of ["UPDATE partial_writeoff_operations SET status='cancelled'", "UPDATE partial_writeoff_operations SET definitive_document_id='final'", "UPDATE partial_writeoff_batches SET status='cancelled'", "UPDATE partial_writeoff_items SET reserved_quantity=0 WHERE product_id='p'"]) {
    await db.exec('BEGIN'); await db.exec(mutation); await assert.rejects(run(),/BATCH_NOT_RECONCILABLE|BATCH_BALANCE_CHANGED/); await db.exec('ROLLBACK');
  }
  assert.equal((await run()).rows[0].r.already_confirmed,false);
  assert.equal((await run()).rows[0].r.already_confirmed,true);
  const rows=(await db.query('SELECT product_id,original_quantity,reserved_quantity,withdrawn_quantity FROM partial_writeoff_items ORDER BY product_id')).rows;
  assert.deepEqual(rows.map(r=>[r.product_id,Number(r.original_quantity),Number(r.reserved_quantity),Number(r.withdrawn_quantity)]),[['missing',1,0,0],['p',2,0,2]]);
  const preserved=(await db.query(`SELECT o.budget_snapshot,o.status,b.auxiliary_document_id,b.auvo_task_id,b.auvo_task_requested FROM partial_writeoff_operations o JOIN partial_writeoff_batches b ON b.operation_id=o.id`)).rows[0];
  assert.deepEqual(preserved,{budget_snapshot:source,status:'awaiting_balance',auxiliary_document_id:'doc',auvo_task_id:'preserve-task',auvo_task_requested:true});
  const events=(await db.query("SELECT event_type,payload FROM partial_writeoff_events ORDER BY id")).rows;
  assert.deepEqual(events.map(e=>e.event_type),['gc_debit_reconciled','batch_confirmed']);
  assert.deepEqual(events[0].payload.gc_document,doc);
  assert.equal(events[0].payload.batch_before.error_message,'Falha antiga');
  await db.exec('BEGIN');
  await db.exec("UPDATE partial_writeoff_batches SET status='reconciliation_required',confirmed_at=NULL,error_message='Erro GC antigo'");
  const retry=()=>db.query('SELECT partial_writeoff_retry_confirmation($1) r',[batch]);
  assert.equal((await retry()).rows[0].r,'confirming');
  assert.deepEqual((await db.query('SELECT product_id,original_quantity,reserved_quantity,withdrawn_quantity FROM partial_writeoff_items ORDER BY product_id')).rows,rows);
  assert.equal((await db.query("SELECT count(*)::int n FROM partial_writeoff_events WHERE event_type='confirmation_retry_requested'")).rows[0].n,1);
  await assert.rejects(retry(),/BATCH_NOT_RETRYABLE/);
  await db.exec('ROLLBACK');
  assert.equal((await retry()).rows[0].r,'confirmed');
  console.log('PASS: confirmação atômica sem duplicar, identidade/quantidades/estoque/estado, preservação do orçamento e Auvo, pendência de compra e prova anterior.');
} finally { await db.close(); }
