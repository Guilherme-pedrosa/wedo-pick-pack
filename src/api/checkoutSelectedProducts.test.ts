import { beforeEach, describe, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:m.invoke}}}));
import { enrichOrderProducts } from './gestaoclick';
beforeEach(()=>{
  vi.clearAllMocks();
  m.invoke.mockImplementation(async (_name:string,{body}:any)=>{
    const id=body.path.match(/^\/api\/produtos\/([^?]+)/)?.[1];
    if(!id) throw new Error('A abertura não deve consultar outras OS');
    return {data:{_proxy:{ok:true},data:{id,nome:id,codigo_interno:`COD-${id}`,codigo_barra:`BAR-${id}`,estoque:'3',atributos:[]}},error:null};
  });
});
const line=(id:string,q:number)=>({produto:{produto_id:id,variacao_id:'',nome_produto:id,quantidade:q,codigo_produto:'',codigo_barras:'',sigla_unidade:'UN'}});
describe('varredura somente dos produtos do pedido selecionado',()=>{
  it('consulta cada produto uma vez, reaproveita saldo/código e soma linhas repetidas',async()=>{
    const products=[line('p1',2),line('p1',2),line('p2',1)];
    const original=structuredClone(products), warning=vi.fn();
    const result=await enrichOrderProducts(products,{checkStock:true,onStockWarning:warning});
    expect(m.invoke).toHaveBeenCalledTimes(2);
    expect(m.invoke.mock.calls.map(c=>c[1].body.path)).toEqual([expect.stringMatching(/^\/api\/produtos\/p1\?cache_bust=/),expect.stringMatching(/^\/api\/produtos\/p2\?cache_bust=/)]);
    expect(m.invoke.mock.calls.every(c=>c[1].body.method==='GET')).toBe(true);
    expect(warning).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('p1 — solicitado 4, saldo GC 3'));
    expect(products).toEqual(original);
    expect(result.map(p=>p.produto.quantidade)).toEqual([2,2,1]);
    expect(result[0].produto.codigo_barras).toBe('BAR-p1');
  });
  it('não acusa falta para um documento cujo estoque já saiu',async()=>{
    const warning=vi.fn();
    await enrichOrderProducts([line('p1',10)],{checkStock:false,onStockWarning:warning});
    expect(warning).not.toHaveBeenCalled();
    expect(m.invoke).toHaveBeenCalledTimes(1);
  });
});
