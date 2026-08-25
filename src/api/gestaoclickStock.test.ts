import { describe, expect, it } from 'vitest';
import { parseProductStockResponse } from './gestaoclick';

describe('parseProductStockResponse', () => {
  it('lê o saldo quando o GestãoClick retorna o produto aninhado', () => {
    const result = parseProductStockResponse({
      data: { Produto: { id: '10', estoque: '7,5', valor_custo: '12,30' } },
    }, '10');

    expect(result).toEqual({ produto_id: '10', estoque: 7.5, valor_custo: 12.3 });
  });

  it('prioriza o saldo da variação solicitada', () => {
    const result = parseProductStockResponse({
      data: {
        id: '10',
        estoque: '20',
        variacoes: [
          { variacao: { id: '100', estoque: '3' } },
          { variacao: { id: '200', estoque: '9' } },
        ],
      },
    }, '10', '200');

    expect(result?.estoque).toBe(9);
  });
});