import { readFileSync } from 'node:fs';
import { consolidateExecutedOs } from '../supabase/functions/_shared/partialConsolidation.ts';
import { executionDocument } from '../supabase/functions/_shared/partialExecution.ts';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const token=process.env.PARTIAL_EXECUTION_TOKEN;
if(!token)throw Error('Segredo da rotina não configurado.');
const headers={apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'};
const api=async(action,operationId=null,payload={})=>{
  const res=await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/partial_execution_worker_api`,{method:'POST',headers,body:JSON.stringify({p_token:token,p_action:action,p_operation_id:operationId,p_payload:payload}),signal:AbortSignal.timeout(30000)});
  const data=await res.json();if(!res.ok)throw Error(`Banco: ${data.message || res.status}`);return data;
};
const gc=async(path,method='GET',payload)=>{
  const res=await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/gc-proxy`,{method:'POST',headers,body:JSON.stringify({path,method,payload}),signal:AbortSignal.timeout(30000)});
  const data=await res.json();if(!res.ok||!data?._proxy?.ok)throw Error(`GC ${method} ${path}: ${data?._proxy?.gc_http_status || res.status}`);return data;
};
let failures=0;
for(const row of await api('list')){
  try{
    const reload=()=>api('operation',row.id);
    const op=await reload();const documents=[];
    for(const b of op.batches.filter(b=>b.confirmed_at&&b.auxiliary_document_id)){
      const doc=(await gc(`/api/ordens_servicos/${b.auxiliary_document_id}`)).data;
      if(String(doc?.id)!==b.auxiliary_document_id)throw Error('Documento divergente.');
      documents.push(executionDocument(b.id,doc));
    }
    const status=await api('record_execution',row.id,{p_documents:documents});
    if(status==='ready_to_consolidate')await consolidateExecutedOs(await reload(),{
      gc,reload,settings:()=>api('settings',row.id),rpc:(name,payload)=>api(name.replace('partial_writeoff_',''),row.id,payload),
    });
    console.log(`Orçamento #${op.budget_code}: ${(await reload()).status}`);
  }catch(error){
    failures++;console.error(`Operação ${row.id}: ${error.message}`);
    await api('error',row.id,{message:error.message});
  }
}
if(failures)process.exitCode=1;
