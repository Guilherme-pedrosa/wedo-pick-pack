import { describe, beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({ invoke:vi.fn() }));
vi.mock('@/integrations/supabase/client',()=>({ supabase:{ functions:{invoke:m.invoke} } }));
vi.mock('./compras',()=>({ listOrdensCompra:async()=>({data:[],meta:{total_paginas:0}}) }));
import { checkStockForOrders } from './gestaoclick';
const line=(q:number,v='')=>({produto:{produto_id:'p',variacao_id:v,possui_variacao:v?'1':'0',nome_produto:'Peça',quantidade:q}});
const doc=(id:string,products=[line(2)],stock='0'):any=>({id,codigo:id,nome_cliente:'Cliente',nome_situacao:'PEDIDO EM CONFERENCIA',situacao_estoque:stock,produtos:products});
beforeEach(()=>{ vi.clearAllMocks(); m.invoke.mockResolvedValue({data:{_proxy:{ok:true},data:{id:'p',estoque:3,variacoes:[{variacao:{id:'a',estoque:1}},{variacao:{id:'b',estoque:10}}]}}}); });
describe('varredura manual de estoque',()=>{
 it('soma linhas repetidas antes de marcar um pedido disponível',async()=>{
  const result=await checkStockForOrders([doc('1',[line(2),line(2)])]);
  expect(result.fullStockOrders.has('1')).toBe(false);
 });
 it('não transfere saldo de uma variação para outra',async()=>{
  const result=await checkStockForOrders([doc('1',[line(2,'a')]),doc('2',[line(8,'b')])]);
  expect([...result.fullStockOrders]).toEqual(['2']);
  expect(result.conflicts).toEqual([]);
 });
 it('não inclui itens já baixados nem linhas sem movimentação em conflitos',async()=>{
  const noStock=line(100); (noStock.produto as any).movimenta_estoque='0';
  const result=await checkStockForOrders([doc('1',[line(20)],'1'),doc('2',[line(2),noStock])]);
  expect(result.conflicts).toEqual([]); expect(result.fullStockOrders.has('2')).toBe(true);
 });
 it('não transforma resposta sem saldo em zero ou disponibilidade',async()=>{
  m.invoke.mockResolvedValue({data:{_proxy:{ok:true},data:{id:'p'}}});
  await expect(checkStockForOrders([doc('1')])).rejects.toThrow('todos os saldos');
 });
});
