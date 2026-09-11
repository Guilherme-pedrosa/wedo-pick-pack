import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
const m=vi.hoisted(()=>({db:null as any, rows:[] as any[], updates:[] as any[], requests:[] as string[], products:[] as any[], broken:false}));
vi.mock('https://esm.sh/@supabase/supabase-js@2',()=>({createClient:()=>m.db}));
let handler:(req:Request)=>Promise<Response>;
beforeEach(async()=>{
 vi.resetModules(); m.rows=[];m.updates=[];m.requests=[];m.broken=false;
 m.products=Array.from({length:205},(_,i)=>({id:String(i+1),nome:`Peça ${i+1}`,codigo_interno:`P${i+1}`,estoque:8,valor_custo:17,ativo:'1'}));
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('Deno',{env:{get:()=> 'test-only'},serve:(fn:any)=>{handler=fn;}});
 vi.spyOn(globalThis,'setTimeout').mockImplementation(((fn:()=>void)=>{fn();return 0;}) as any);
 m.db={from:(table:string)=>{
   const q:any={}; let action='read'; let patch:any;
   const result=()=>({error:null,data:table==='sync_runs'?(action==='insert'?{id:'run'}:null):table==='box_items'?[{produto_id:'1'}]:table==='toolbox_items'?[{produto_id:'2'}]:table==='product_queries'?[{resolved_produto_id:'205'}]:[]});
   q.select=q.eq=q.lt=q.gte=q.not=q.order=()=>q;
   q.insert=(value:any)=>{action='insert';patch=value;return q;};
   q.update=(value:any)=>{m.updates.push(value);return q;};
   q.upsert=(rows:any)=>{m.rows.push(...rows);return q;};
   q.range=q.single=q.maybeSingle=async()=>result();
   q.then=(resolve:any,reject:any)=>Promise.resolve(result()).then(resolve,reject);
   return q;
 }};
 vi.stubGlobal('fetch',vi.fn(async(input:any)=>{
   const url=new URL(typeof input==='string'?input:input.url);m.requests.push(url.pathname+url.search);
   const page=Number(url.searchParams.get('pagina'));
   if(url.pathname!=='/api/produtos'||!page)throw Error('Não deveria buscar produto individual');
   return new Response(JSON.stringify({data:m.products.slice((page-1)*100,page*100),meta:{total_paginas:3,total_registros:m.broken?206:205}}),{status:200});
 }));
 // Edge entry point runs with the Deno/Supabase mocks above, separately from app typechecking.
 const edgeEntry = '../../supabase/functions/sync-products/index.ts';
 await import(edgeEntry);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('sincronização incremental sem repetir somente os primeiros produtos',()=>{
 it('inclui produto no fim do catálogo, maletas e saldo/custo atuais em uma execução',async()=>{
  const response=await handler(new Request('https://test/sync',{method:'POST',body:JSON.stringify({run_type:'incremental'})}));
  const result=await response.json();expect(result).toMatchObject({status:'success',fetchedCount:3,upsertCount:3});
  expect(m.rows.map(r=>r.produto_id)).toEqual(['1','2','205']);
  expect(m.rows[0].payload_min_json).toMatchObject({estoque:8,valor_custo:17});
  expect(m.requests).toHaveLength(3);
 });
 it('não publica atualização com uma página/registros faltando',async()=>{
  m.broken=true;
  const response=await handler(new Request('https://test/sync',{method:'POST',body:JSON.stringify({run_type:'incremental'})}));
  expect(response.status).toBe(500);expect(m.rows).toEqual([]);expect(m.updates.at(-1).status).toBe('failed');
 });
});
