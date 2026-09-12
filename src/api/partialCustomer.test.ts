import {describe,it,expect,vi} from 'vitest';
import {resolvePartialCustomer} from '../../supabase/functions/_shared/partialCustomer';
describe('cliente Auvo de venda parcial sem tarefa de serviço anterior',()=>{
  const customer=async()=>({id:'gc',cnpj:'43.572.954/0001-81'});
  it('resolve um único documento exato, sem escolher por semelhança do nome',async()=>{
    expect(await resolvePartialCustomer('gc',{customer,lookup:async()=>[{id:'123',cnpj:'43572954000181',name:'Nome comercial'},{id:'456',cnpj:'99999999999999'}]})).toBe(123);
  });
  it.each([{matches:[]},{matches:[{id:'123',cnpj:'43572954000181'},{id:'456',cnpj:'43572954000181'}]}])('bloqueia ausência ou ambiguidade',async ({matches})=>{
    await expect(resolvePartialCustomer('gc',{customer,lookup:async()=>matches})).rejects.toThrow(/Nenhum|mais de um/);
  });
  it('não consulta Auvo quando o GC devolve outro cliente',async()=>{
    const lookup=vi.fn();await expect(resolvePartialCustomer('outro',{customer,lookup})).rejects.toThrow('não confirmado');expect(lookup).not.toHaveBeenCalled();
  });
});
