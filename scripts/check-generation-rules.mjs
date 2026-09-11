// Read-only deployment probe: creates no documents, tasks or database records.
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const response=await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/generate-os`,{
  method:'POST',headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({action:'generation_rules'}),signal:AbortSignal.timeout(30000),
});
const result=await response.json();
const ready=response.ok && result.version==='2026-09-11-product-sales-v1'
  && result.rules?.venda?.budgetStatusId==='7706107' && result.rules?.venda?.documentStatusId==='9303817'
  && result.rules?.venda?.questionnaireId===224444;
console.log(JSON.stringify({ready,httpStatus:response.status,result}));
if(!ready)process.exitCode=1;
