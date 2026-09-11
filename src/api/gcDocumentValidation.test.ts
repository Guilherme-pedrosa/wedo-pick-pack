import { describe, beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({ invoke:vi.fn() }));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:m.invoke}}}));
import { checkDocumentExists } from './gcDocumentValidation';
beforeEach(()=>vi.clearAllMocks());
describe('prova de exclusão de documento',()=>{
 it('usa o proxy instalado e confere o identificador',async()=>{
  m.invoke.mockResolvedValue({data:{_proxy:{ok:true},data:{id:'1'}}});
  expect(await checkDocumentExists('os','1')).toBe(true);
  expect(m.invoke).toHaveBeenCalledWith('gc-proxy',expect.any(Object));
 });
 it.each([{error:{message:'timeout'}},{data:{_proxy:{ok:false,gc_http_status:500}}},{data:{_proxy:{ok:true},data:{id:'2'}}}])('não libera reserva com resposta inconclusiva',async response=>{
  m.invoke.mockResolvedValue(response); await expect(checkDocumentExists('os','1')).rejects.toThrow('preservada');
 });
 it('considera ausente apenas o 404 confirmado',async()=>{
  m.invoke.mockResolvedValue({data:{_proxy:{ok:false,gc_http_status:404}}}); expect(await checkDocumentExists('venda','1')).toBe(false);
 });
});
