import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.hoisted(() => ({ getOS: vi.fn(), getVenda: vi.fn(), stock: vi.fn(), commitments: vi.fn(), from: vi.fn() }));
vi.mock('./gestaoclick', () => ({ getOS: m.getOS, getVenda: m.getVenda, getProductStock: m.stock }));
vi.mock('./osStockCommitments', async importOriginal => ({ ...await importOriginal<any>(), fetchOsStockCommitments: m.commitments }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: m.from } }));
import { assertCheckoutStock } from './checkoutStockGuard';
const doc = (status = 'AGUARDANDO SEPARAÇÃO', stock = '0') => ({ id: '1', codigo: '10', nome_situacao: status, situacao_estoque: stock,
  produtos: [{ produto: { produto_id: 'p', quantidade: '2' } }], servicos: [] });
beforeEach(() => {
  vi.clearAllMocks(); m.getOS.mockResolvedValue(doc()); m.getVenda.mockResolvedValue(doc());
  m.stock.mockResolvedValue({ estoque: 1 }); m.commitments.mockResolvedValue([]);
  m.from.mockReturnValue({ select: () => ({ range: async () => ({ data: [], error: null }) }) });
});
describe('conferência final do estoque selecionado', () => {
  it('bloqueia falta de estoque mesmo fora das seis situações de compromisso', async () => {
    await expect(assertCheckoutStock('1')).rejects.toThrow('Conflito de estoque');
    expect(m.stock).toHaveBeenCalledWith('p', undefined, { forceFresh: true });
  });
  it('valida venda e não exclui compromisso de uma OS com o mesmo identificador', async () => {
    m.stock.mockResolvedValue({ estoque: 3 });
    m.commitments.mockResolvedValue([{ osId: '1', code: '99', productId: 'p', variationId: '', quantity: 2, status: 'PEDIDO EM CONFERENCIA' }]);
    await expect(assertCheckoutStock('1', undefined, undefined, 'venda')).rejects.toThrow('Conflito');
    expect(m.getVenda).toHaveBeenCalledOnce(); expect(m.getOS).not.toHaveBeenCalled();
  });
  it('não desconta novamente um documento já baixado', async () => {
    m.getOS.mockResolvedValue(doc('RETIRADA PELO TECNICO', '1'));
    await assertCheckoutStock('1'); expect(m.stock).not.toHaveBeenCalled(); expect(m.commitments).not.toHaveBeenCalled();
  });
  it('bloqueia saldo desconhecido e soma linhas repetidas do mesmo produto', async () => {
    const current = doc(); current.produtos.push(...structuredClone(current.produtos)); m.getOS.mockResolvedValue(current);
    m.stock.mockResolvedValue({ estoque: 3 });
    await expect(assertCheckoutStock('1')).rejects.toThrow('solicitado 4');
    m.getOS.mockResolvedValue(doc('PEDIDO EM CONFERENCIA', ''));
    await expect(assertCheckoutStock('1')).rejects.toThrow('validar');
  });
});
