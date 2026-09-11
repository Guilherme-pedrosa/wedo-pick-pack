import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({from:vi.fn(),filter:vi.fn(),result:{data:null as any,error:null as any}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:m.from}}));
import {findPartialBatchByDocument} from './partialWriteoff';
beforeEach(()=>{
  vi.clearAllMocks();m.result={data:null,error:null};
  const q:any={select:()=>q,eq:()=>q,in:(...args:any[])=>{m.filter(...args);return q;},maybeSingle:async()=>m.result};
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
