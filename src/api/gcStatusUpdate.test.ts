import { describe, it, expect, vi } from 'vitest';
import { changeDocumentStatus } from './gcStatusUpdate';

const document = () => ({ id: '10', codigo: '6277', cliente_id: 'c', tipo: 'produto', situacao_id: 'pending', valor_total: '100.00',
  produtos: [{ produto: { produto_id: 'p', quantidade: '3', valor_venda: '33.333333', valor_total: '100.00' } }],
  servicos: [], pagamentos: [{ pagamento: { valor: '45.99', data_vencimento: '2026-09-30' } }, { pagamento: { valor: '54.01', data_vencimento: '2026-10-30' } }],
  desconto_valor: '0.01', introducao: 'Garantia original', previsao_entrega: '2026-10-01', observacoes: '', observacoes_interna: '',
  atributos: [{ atributo: { atributo_id: '73897', conteudo: '8' } }], equipamentos: [{ equipamento: { equipamento: 'Forno' } }],
});

describe('troca de situação sem alterar o documento comercial', () => {
  it.each(['os', 'venda'] as const)('preserva valores, parcelas, campos e exclusões mais recentes em %s', async type => {
    const current: any = document();
    const old = { ...structuredClone(current), observacoes: 'Apagada no GC', atributos: [], pagamentos: [] };
    let sent: any;
    const request = vi.fn(async (_path, options) => {
      if (options) {
        sent = JSON.parse(options.body);
        Object.assign(current, sent, { produtos: sent.produtos.map((produto: any) => ({ produto })) });
      }
      return { data: structuredClone(current) };
    });
    const confirmed = await changeDocumentStatus(request, type, '10', old, 'done', 'Operador');
    expect(confirmed).toEqual(current);
    expect(confirmed.situacao_id).toBe('done');
    expect(sent.produtos[0]).toMatchObject({ quantidade: '3', valor_venda: '33.333333', valor_total: '100.00' });
    expect(sent.pagamentos).toEqual(document().pagamentos);
    expect(sent).toMatchObject({ atributos: document().atributos, equipamentos: document().equipamentos,
      introducao: 'Garantia original', previsao_entrega: '2026-10-01', desconto_valor: '0.01' });
    expect(sent.observacoes).not.toContain('Apagada');
    expect(request.mock.calls.filter(([, o]) => o)).toHaveLength(1);
  });
  it('não atualiza usando cache quando a leitura original falha', async () => {
    const request = vi.fn().mockRejectedValue(new Error('GC indisponível'));
    await expect(changeDocumentStatus(request, 'os', '10', document(), 'done')).rejects.toThrow('GC indisponível');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('bloqueia quantidades alteradas depois da conferência', async () => {
    const current = document(); current.produtos[0].produto.quantidade = '5';
    const request = vi.fn().mockResolvedValue({ data: current });
    await expect(changeDocumentStatus(request, 'venda', '10', document(), 'done')).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('detecta perda comercial mesmo que o GC confirme a situação', async () => {
    const current = document();
    const request = vi.fn().mockResolvedValueOnce({ data: current }).mockResolvedValueOnce({ data: { situacao_id: 'done' } })
      .mockResolvedValue({ data: { ...current, situacao_id: 'done', pagamentos: [] } });
    await expect(changeDocumentStatus(request, 'os', '10', current, 'done')).rejects.toThrow('pagamentos');
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('não altera valores nem repete PUT recusado por parcelas', async () => {
    const request = vi.fn().mockResolvedValueOnce({ data: document() }).mockRejectedValue(new Error('parcelas divergentes'));
    await expect(changeDocumentStatus(request, 'os', '10', document(), 'done')).rejects.toThrow('parcelas');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
