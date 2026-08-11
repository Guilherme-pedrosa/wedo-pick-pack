import { describe, expect, it } from 'vitest';
import type { GCOrcamento } from '@/api/types';
import {
  aggregateInventoryBudgetDemand,
  hasNextBudgetPage,
  type TypedInventoryBudget,
} from './inventoryBudgetDemand';

function budget(
  id: string,
  codigo: string,
  produtos: Array<{ produto_id: string; variacao_id?: string; quantidade: string | number }>,
): GCOrcamento {
  return {
    id,
    codigo,
    cliente_id: '1',
    nome_cliente: `Cliente ${codigo}`,
    data: '2026-08-11',
    situacao_id: '8743485',
    nome_situacao: 'Aguardando chegada',
    valor_total: '0',
    produtos: produtos.map(produto => ({
      produto: {
        produto_id: produto.produto_id,
        variacao_id: produto.variacao_id || '',
        nome_produto: '',
        codigo_produto: '',
        sigla_unidade: 'UN',
        quantidade: produto.quantidade,
      },
    })),
  };
}

describe('hasNextBudgetPage', () => {
  it('encerra imediatamente quando o GC devolve lista vazia sem meta', () => {
    expect(hasNextBudgetPage(1, [], undefined)).toBe(false);
    const metaWithNullPages = { total_paginas: null } as unknown as Parameters<typeof hasNextBudgetPage>[2];
    expect(hasNextBudgetPage(1, [], metaWithNullPages)).toBe(false);
  });

  it('segue a paginação declarada e para na última página', () => {
    expect(hasNextBudgetPage(1, [{}], { pagina_atual: 1, total_paginas: 2, total_registros: 2 })).toBe(true);
    expect(hasNextBudgetPage(2, [{}], { pagina_atual: 2, total_paginas: 2, total_registros: 2 })).toBe(false);
  });

  it('segue proxima_pagina quando o GC não informa total_paginas', () => {
    const firstPageMeta = {
      pagina_atual: 1,
      total_paginas: null,
      total_registros: 22,
      proxima_pagina: 2,
    } as unknown as Parameters<typeof hasNextBudgetPage>[2];
    const lastPageMeta = {
      pagina_atual: 2,
      total_paginas: null,
      total_registros: 22,
      proxima_pagina: null,
    } as unknown as Parameters<typeof hasNextBudgetPage>[2];

    expect(hasNextBudgetPage(1, [{}], firstPageMeta)).toBe(true);
    expect(hasNextBudgetPage(2, [{}], lastPageMeta)).toBe(false);
  });
});

describe('aggregateInventoryBudgetDemand', () => {
  it('soma peças de orçamentos de produto e de serviço', () => {
    const rows: TypedInventoryBudget[] = [
      { budget: budget('1', '100', [{ produto_id: 'P1', quantidade: '2,00' }]), type: 'produto' },
      { budget: budget('2', '101', [{ produto_id: 'P1', quantidade: 3 }, { produto_id: 'P2', quantidade: 1 }]), type: 'servico' },
    ];

    const result = aggregateInventoryBudgetDemand(rows);

    expect(result.get('P1')?.qtd).toBe(5);
    expect(result.get('P1')?.refs.map(ref => ref.tipo)).toEqual(['produto', 'servico']);
    expect(result.get('P2')?.qtd).toBe(1);
  });

  it('usa apenas o saldo pendente do Pick & Pack em baixa parcial', () => {
    const rows: TypedInventoryBudget[] = [{
      budget: budget('3', '102', [
        { produto_id: 'P1', variacao_id: 'V1', quantidade: 5 },
        { produto_id: 'P2', quantidade: 2 },
      ]),
      type: 'servico',
    }];
    const partial = new Map([
      ['3', new Map([['P1::V1', 2], ['P2', 0]])],
    ]);

    const result = aggregateInventoryBudgetDemand(rows, partial);

    expect(result.get('P1')?.qtd).toBe(2);
    expect(result.has('P2')).toBe(false);
  });

  it('não duplica o mesmo orçamento se o GC o devolver nos dois filtros', () => {
    const sameBudget = budget('4', '103', [{ produto_id: 'P1', quantidade: 2 }]);
    const result = aggregateInventoryBudgetDemand([
      { budget: sameBudget, type: 'produto' },
      { budget: sameBudget, type: 'servico' },
    ]);

    expect(result.get('P1')?.qtd).toBe(2);
    expect(result.get('P1')?.refs).toHaveLength(1);
  });

  it('não transforma linha de serviço pura em item de estoque', () => {
    const serviceOnly = {
      ...budget('5', '104', []),
      servicos: [{ servico: { servico_id: 'S1', quantidade: 4 } }],
    } as GCOrcamento;

    expect(aggregateInventoryBudgetDemand([{ budget: serviceOnly, type: 'servico' }]).size).toBe(0);
  });
});
