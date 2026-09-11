import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';`);
  await db.exec(read('20260805143000_partial_writeoff_flow.sql').split('CREATE OR REPLACE FUNCTION public.partial_writeoff_open_operation')[0]);
  await db.exec('ALTER TABLE partial_writeoff_batches ADD COLUMN auvo_task_id text;');
  await db.exec(read('20260911170000_reopen_4784_awaiting_execution.sql'));
  await db.exec(read('20260316153930_4a7303ae-9d9e-40b0-80f3-e80f1fbd8af5.sql').split('ALTER TABLE public.os_generation_logs')[0]);
  await db.exec(read('20260911183000_partial_execution_consolidation.sql'));
  await db.exec(read('20260911200000_reservation_only.sql'));
  const op='11111111-1111-4111-8111-111111111111';
  const batch='22222222-2222-4222-8222-222222222222';
  await db.query(`INSERT INTO partial_writeoff_operations(id,budget_id,budget_code,client_id,client_name,document_type,status,budget_snapshot,flow_mode)
    VALUES($1,'budget','4784','client','Cliente','os','ready_to_consolidate','{}','partial_execution')`,[op]);
  assert.equal((await db.query('SELECT status FROM partial_writeoff_operations')).rows[0].status,'awaiting_execution');
  await db.query(`INSERT INTO partial_writeoff_items(operation_id,line_key,product_id,product_name,original_quantity,withdrawn_quantity,line_snapshot)
    VALUES($1,'p','p','Produto',1,1,'{}')`,[op]);
  await db.query(`INSERT INTO partial_writeoff_batches(id,operation_id,sequence,idempotency_key,marker,status,auxiliary_document_type,auxiliary_document_id,confirmed_at)
    VALUES($1,$2,1,'key','marker','confirmed','os','10137',now())`,[batch,op]);
  const doc={batchId:batch,documentId:'10137',documentCode:'10137',statusId:'7063705',statusName:'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO',executed:false,stockApplied:true};
  const check = docs => db.query('SELECT partial_writeoff_record_execution($1,$2::jsonb)',[op,JSON.stringify(docs)]);
  const claim = () => db.query('SELECT partial_writeoff_claim_consolidation($1)',[op]);
  await check([doc]);
  await assert.rejects(claim(),/OPERATION_NOT_CONSOLIDATABLE:awaiting_execution/);
  await assert.rejects(check([{...doc,documentId:'outra'}]),/EXECUTION_DOCUMENT_MISMATCH/);
  await assert.rejects(check([doc,doc]),/EXECUTION_DOCUMENT_MISMATCH/);
  await check([{...doc,executed:true}]); // Nome do estado ainda não prova execução.
  await assert.rejects(claim(),/OPERATION_NOT_CONSOLIDATABLE/);
  await check([{...doc,executed:true,statusName:'EXECUTADO - AGUARDANDO PAGAMENTO'}]);
  await db.exec(`UPDATE partial_writeoff_operations SET execution_verified_at=now()-interval '2 minutes'`);
  await assert.rejects(claim(),/EXECUTION_CHECK_REQUIRED/);
  await check([{...doc,executed:true,statusName:'EXECUTADO - AGUARDANDO PAGAMENTO'}]);
  await claim();
  await assert.rejects(claim(),/OPERATION_NOT_CONSOLIDATABLE:consolidating/);
  await db.query("SELECT partial_writeoff_checkpoint($1,'created','new-os','10139','{}')",[op]);
  assert.equal((await db.query('SELECT definitive_document_id FROM partial_writeoff_operations')).rows[0].definitive_document_id,'new-os');
  await assert.rejects(db.query("SELECT partial_writeoff_checkpoint($1,'created','other','10140','{}')",[op]),/DEFINITIVE_DOCUMENT_CHANGED/);
  await db.query("SELECT partial_writeoff_checkpoint($1,'finalizing','new-os','10139','{}')",[op]);
  await db.query("SELECT partial_writeoff_checkpoint($1,'created','new-os','10139','{}')",[op]);
  assert.equal((await db.query('SELECT consolidation_stage FROM partial_writeoff_operations')).rows[0].consolidation_stage,'finalizing');
  await assert.rejects(db.exec("UPDATE partial_writeoff_operations SET status='completed'"),/VERIFIED_CONSOLIDATION_REQUIRED/);
  await db.query("SELECT partial_writeoff_checkpoint($1,'finalized','new-os','10139','{}')",[op]);
  await db.exec("UPDATE partial_writeoff_operations SET created_by='33333333-3333-4333-8333-333333333333',status='completed'");
  assert.equal((await db.query('SELECT count(*)::int n FROM os_generation_logs WHERE success')).rows[0].n,1);
  await db.exec("UPDATE partial_writeoff_operations SET flow_mode='reservation',status='awaiting_execution',execution_verified_at=NULL");
  const settings=(await db.query('SELECT os_stock_status_id FROM partial_writeoff_settings WHERE singleton')).rows[0];
  await check([{...doc,executed:false,statusId:settings.os_stock_status_id,statusName:'Baixa pra reserva de peças - Aguardando Compra'}]);
  assert.equal((await db.query('SELECT status FROM partial_writeoff_operations')).rows[0].status,'ready_to_consolidate');
  await db.exec(`CREATE SCHEMA vault; CREATE SCHEMA extensions;
    CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
    CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql AS 'SELECT convert_to($1,''UTF8'')';
    INSERT INTO vault.decrypted_secrets VALUES('partial_execution_github_token_sha256',encode(convert_to(repeat('a',64),'UTF8'),'hex'));`);
  await db.exec(read('20260911203000_execution_worker_api.sql').split('-- Não usar o job')[0]+'COMMIT;');
  const api=(token,action,id=op,payload={})=>db.query('SELECT partial_execution_worker_api($1,$2,$3,$4::jsonb) result',[token,action,id,JSON.stringify(payload)]);
  await assert.rejects(api('b'.repeat(64),'operation'),/UNAUTHORIZED/);
  await assert.rejects(api('a'.repeat(64),'delete'),/UNSUPPORTED_ACTION/);
  assert.equal((await api('a'.repeat(64),'operation')).rows[0].result.flow_mode,'reservation');
  assert.equal((await api('a'.repeat(64),'list')).rows[0].result[0].id,op);
  console.log('PASS: espera pela execução, identidade dos documentos, expiração, exclusão mútua e persistência da definitiva.');
} catch (error) {
  console.error(error.message, error.detail || '');
  process.exitCode = 1;
} finally { await db.close(); }
