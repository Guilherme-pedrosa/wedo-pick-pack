import { describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { assertStockConflict, commitmentFor, pendingOsLines, readAllOsCommitments } from './osStockCommitments';

const os = (id: string, status = 'PEDIDO EM CONFERENCIA', debited = '0', variation = 'v') => ({
  id, codigo: id, nome_cliente: 'Cliente', nome_situacao: status, situacao_estoque: debited,
  produtos: [{ produto: { produto_id: 'p', variacao_id: variation, possui_variacao: '1', quantidade: '1', movimenta_estoque: '1' } }],
});
describe('compromissos globais de estoque', () => {
  it('bloqueia duas OS não executadas que disputam a única peça, incluindo fora do módulo parcial', () => {
    const rows = [...pendingOsLines(os('100')), ...pendingOsLines(os('200'))];
    expect(() => assertStockConflict(1, 1, 0, rows, 'p', 'v', '100')).toThrow('#200');
    expect(() => assertStockConflict(2, 1, 0, rows, 'p', 'v', '100')).not.toThrow();
  });
  it('não conta executadas ou canceladas, mas conta NÃO EXECUTADO', () => {
    expect(pendingOsLines(os('100', 'EXECUTADO - AGUARDANDO PAGAMENTO'))).toEqual([]);
    expect(pendingOsLines(os('100', 'Cancelada - Uso em OS'))).toEqual([]);
    expect(pendingOsLines(os('100', 'NÃO EXECUTADO'))).toHaveLength(1);
  });
  it('mostra a OS aguardando execução já baixada sem descontar duas vezes do saldo do GC', () => {
    const rows = pendingOsLines(os('100', 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO', '1'));
    expect(commitmentFor(rows, 'p', 'v')).toMatchObject({ quantity: 1, outstanding: 0 });
    expect(() => assertStockConflict(1, 1, 0, rows, 'p', 'v')).not.toThrow();
  });
  it('separa variações e considera reserva local ainda não debitada', () => {
    const rows = pendingOsLines(os('100', undefined, '0', 'v2'));
    expect(commitmentFor(rows, 'p', 'v').quantity).toBe(0);
    expect(() => assertStockConflict(1, 1, 1, rows, 'p', 'v')).toThrow('reservas locais 1');
  });
  it('lê a segunda página e não publica resultado parcial quando há falha', async () => {
    const request = vi.fn().mockResolvedValueOnce({ data: [os('1')], meta: { total_paginas: 2, total_registros: 2, pagina_atual: 1 } })
      .mockResolvedValueOnce({ data: [os('2')], meta: { total_paginas: 2, total_registros: 2, pagina_atual: 2 } });
    expect(await readAllOsCommitments(request)).toHaveLength(2);
    const failure = vi.fn().mockResolvedValueOnce({ data: [os('1')], meta: { total_paginas: 2, total_registros: 2, pagina_atual: 1 } }).mockRejectedValueOnce(new Error('HTTP 500'));
    await expect(readAllOsCommitments(failure)).rejects.toThrow('HTTP 500');
  });
  it('bloqueia contagem incompleta, duplicação e situação sem estoque conhecido', async () => {
    await expect(readAllOsCommitments(async () => ({ data: [os('1')], meta: { total_paginas: 1, total_registros: 2, pagina_atual: 1 } }))).rejects.toThrow('ausentes');
    await expect(readAllOsCommitments(async () => ({ data: [os('1'), os('1')], meta: { total_paginas: 1, total_registros: 2, pagina_atual: 1 } }))).rejects.toThrow('inconsistente');
    expect(() => pendingOsLines({ ...os('1'), situacao_estoque: null })).toThrow('validar');
  });
});
