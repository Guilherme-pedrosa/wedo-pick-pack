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

  it('lê a variação retornada sem envelope interno', () => {
    const result = parseProductStockResponse({
      data: {
        id: '10',
        estoque: 0,
        variacoes: [{ id: '200', estoque: '4,0000' }],
      },
    }, '10', '200');

    expect(result?.estoque).toBe(4);
  });

  it('não usa o saldo do produto-pai quando a variação solicitada não existe', () => {
    const result = parseProductStockResponse({
      data: {
        id: '10',
        estoque: 20,
        variacoes: [
          { variacao: { id: '100', estoque: 3 } },
          { variacao: { id: '200', estoque: 9 } },
        ],
      },
    }, '10', '999');

    expect(result).toBeNull();
  });
});