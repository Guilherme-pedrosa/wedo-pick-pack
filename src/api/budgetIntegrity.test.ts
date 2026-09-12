import { describe, expect, it } from 'vitest';
import { assertBudgetUnchanged, assertOperationQuantities, documentDifferences } from './budgetIntegrity';

const budget = () => ({ id: '6438', cliente_id: 'cliente', valor_total: '9900.00', introducao: 'Garantia original',
  observacoes: 'Condições aprovadas', equipamentos: [{ serie: 'serie-original' }],
  atributos: [{ atributo: { atributo_id: '73341', conteudo: '77509692' } }],
  pagamentos: [{ pagamento: { data_vencimento: '2027-01-08', valor: '9900.00' } }],
  produtos: [{ produto: { produto_id: 'cortina', variacao_id: 'v', quantidade: '3.0000', valor_venda: '990.0000', movimenta_estoque: '1' } }],
  servicos: [{ servico: { servico_id: 'instalacao', quantidade: '16.0000', valor_venda: '155.0000' } }] });

describe('preservação integral do orçamento', () => {
  it('aceita desconto vazio normalizado para zero, mas bloqueia desconto real e preço apagado', () => {
    expect(documentDifferences({ desconto_valor: '', desconto_porcentagem: null }, { desconto_valor: '0.0000', desconto_porcentagem: 0 })).toEqual([]);
    expect(documentDifferences({ desconto_valor: '' }, { desconto_valor: '1' })).toEqual(['desconto_valor']);
    expect(documentDifferences({ valor_venda: '' }, { valor_venda: 0 })).toEqual(['valor_venda']);
  });
  it('bloqueia quantidade reduzida de 3 para 1 mesmo com total monetário igual', () => {
    const source = budget(), changed = budget(); changed.produtos[0].produto.quantidade = '1';
    expect(() => assertBudgetUnchanged(source, changed)).toThrow('produtos[0].produto.quantidade');
  });
  it('protege serviços, pagamento, garantia, observações, equipamento e tarefa original', () => {
    for (const field of ['servicos', 'pagamentos', 'introducao', 'observacoes', 'equipamentos', 'atributos'] as const) {
      const changed: any = budget(); changed[field] = Array.isArray(changed[field]) ? [] : '';
      expect(() => assertBudgetUnchanged(budget(), changed)).toThrow(field);
    }
  });
  it('aceita somente metadados técnicos e mantém preços e quantidades sob conferência', () => {
    const source: any = budget(); source.situacao_id = 'original'; source.valor_custo = '1';
    const changed: any = structuredClone(source); changed.situacao_id = 'parcial'; changed.valor_custo = '2';
    changed.produtos[0].produto.id = 'nova-linha-gc';
    expect(documentDifferences(source, changed)).toEqual([]);
    changed.produtos[0].produto.valor_venda = '900';
    expect(() => assertBudgetUnchanged(source, changed)).toThrow('valor_venda');
  });
  it('bloqueia divergência nos saldos locais e preserva baixas já realizadas', () => {
    const items = [{ product_id: 'cortina', variation_id: 'v', original_quantity: 1, withdrawn_quantity: 0, reserved_quantity: 0 }];
    expect(() => assertOperationQuantities(budget(), items)).toThrow('quantidades locais');
    items[0].original_quantity = 3;
    expect(() => assertOperationQuantities(budget(), items)).not.toThrow();
    items[0].withdrawn_quantity = 4;
    expect(() => assertOperationQuantities(budget(), items)).toThrow('baixas');
  });
  it('distingue todos os dígitos de identificadores grandes sem perder precisão', () => {
    expect(documentDifferences({ equipamento_id: '9127637542627376' }, { equipamento_id: '9127637542627377' })).toEqual(['equipamento_id']);
    expect(documentDifferences({ quantidade: '03.0000' }, { quantidade: 3 })).toEqual([]);
  });
});
