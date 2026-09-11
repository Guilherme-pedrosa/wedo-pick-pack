import { describe, it, beforeEach, vi, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
const m=vi.hoisted(()=>({invoke:vi.fn(),rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:m.invoke},rpc:m.rpc}}));
import { executeStockEntrada, executeStockSaida } from './stockMovement';
const input={vendaGcId:'AJE:original',toolboxName:'Maleta',technicianName:'Técnico'};
beforeEach(()=>{vi.clearAllMocks(); Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});});
describe('estorno de maleta',()=>{
 it('impede uma segunda saída quando há operação sem confirmação',async()=>{
  m.rpc.mockResolvedValue({error:{message:'Há uma saída de estoque sem confirmação'}});
  await expect(executeStockSaida({toolboxId:'box',toolboxName:'Maleta',technicianName:'Técnico',technicianGcId:'123',justificativa:'Empréstimo',items:[{produto_id:'p',nome_produto:'Ferramenta',quantidade:1}]})).rejects.toThrow('sem confirmação');
  expect(m.invoke).not.toHaveBeenCalled();
 });
 it('confirma saída e vínculo juntos depois da resposta do GC',async()=>{
  m.rpc.mockResolvedValue({data:'issue'});m.invoke.mockResolvedValue({data:{success:true,venda_gc_id:'AJE:ref'}});
  await executeStockSaida({toolboxId:'box',toolboxName:'Maleta',technicianName:'Técnico',technicianGcId:'123',justificativa:'Empréstimo',items:[{produto_id:'p',nome_produto:'Ferramenta',quantidade:1}]});
  expect(m.rpc).toHaveBeenLastCalledWith('toolbox_stock_issue_finish',{p_id:'issue',p_result:{success:true,venda_gc_id:'AJE:ref'}});
 });
 it('reutiliza confirmação anterior sem devolver novamente ao GC',async()=>{
  m.rpc.mockResolvedValue({data:{claimed:false,result:{success:true}}});
  expect((await executeStockEntrada(input)).success).toBe(true); expect(m.invoke).not.toHaveBeenCalled();
 });
 it('não confirma resultado recusado e não libera repetição incerta',async()=>{
  m.rpc.mockResolvedValue({data:{claimed:true}}); m.invoke.mockResolvedValue({data:{success:false,error:'Saldo não atualizado'}});
  await expect(executeStockEntrada(input)).rejects.toThrow('Saldo não atualizado');
  expect(m.rpc).toHaveBeenCalledTimes(1);
  m.rpc.mockResolvedValue({error:{message:'Estorno já iniciado'}});
  await expect(executeStockEntrada(input)).rejects.toThrow('já iniciado'); expect(m.invoke).toHaveBeenCalledTimes(1);
 });
 it('registra confirmação só após sucesso do GC',async()=>{
  m.rpc.mockResolvedValue({data:{claimed:true}}); m.invoke.mockResolvedValue({data:{success:true,summary:'Estornado'}});
  await executeStockEntrada(input);
  expect(m.rpc).toHaveBeenLastCalledWith('toolbox_stock_return_finish',expect.objectContaining({p_result:{success:true,summary:'Estornado'}}));
 });
});
