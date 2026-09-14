import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({from:vi.fn(),filter:vi.fn(),result:{data:null as any,error:null as any}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:m.from}}));
import {findPartialBatchByDocument,getPartialCheckoutEntry} from './partialWriteoff';
beforeEach(()=>{
  vi.clearAllMocks();m.result={data:null,error:null};
  const q:any={select:()=>q,eq:()=>q,not:(...args:any[])=>{m.filter(...args);return q;},is:(...args:any[])=>{m.filter(...args);return q;},in:(...args:any[])=>{m.filter(...args);return q;},maybeSingle:async()=>m.result};
  m.from.mockReturnValue(q);
});
it('inclui lotes em reconciliação na identificação direta do documento',async()=>{
  m.result.data={id:'batch',operation_id:'op',status:'reconciliation_required',auxiliary_document_type:'os',auxiliary_document_id:'doc',partial_writeoff_operations:{budget_code:'6438'}};
  expect(await findPartialBatchByDocument('os','doc')).toMatchObject({batchId:'batch',operationId:'op',budgetCode:'6438'});
  expect(m.filter).toHaveBeenCalledWith('status',['awaiting_checkout','reconciliation_required']);
});
it('não trata falha de consulta como ausência de baixa parcial',async()=>{
  m.result.error={message:'connection failed'};
  await expect(findPartialBatchByDocument('os','doc')).rejects.toThrow('vínculo de baixa parcial');
});
it('lookup direto permite retomar saldo confirmado, preservando operação fechada fora do checkout',async()=>{
  m.result.data={id:'batch',operation_id:'op',status:'confirmed',auxiliary_document_type:'os',auxiliary_document_id:'doc',partial_writeoff_operations:{budget_code:'6438',flow_mode:'partial_execution'}};
  expect(await getPartialCheckoutEntry('batch')).toMatchObject({batchId:'batch',operationId:'op',flowMode:'partial_execution'});
  expect(m.filter).toHaveBeenCalledWith('status',['awaiting_checkout','reconciliation_required','confirmed']);
  expect(m.filter).toHaveBeenCalledWith('partial_writeoff_operations.status','in','(completed,cancelled,consolidating)');
  expect(m.filter).toHaveBeenCalledWith('partial_writeoff_operations.definitive_document_id',null);
});
