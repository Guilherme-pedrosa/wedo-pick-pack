import { describe, expect, it } from 'vitest';
import { buildActivePartialDemand, getPartialStockAvailability, PartialWriteoffOperation } from './partialWriteoff';
import {
  documentTypeForBudgetKind,
  isBudgetEligibleForPartialWriteoff,
  isSaleEligibleForPartialWriteoff,
} from './partialWriteoffClient';

function operation(withdrawn: number, status: PartialWriteoffOperation['status'] = 'awaiting_balance'): PartialWriteoffOperation {
  return {
    id: 'operation-1',
    budget_id: 'budget-10',
    budget_code: '10',
    client_id: 'client-1',
    client_name: 'Cliente',
    document_type: 'os',
    status,
    budget_snapshot: {},
    definitive_document_id: null,
    definitive_document_code: null,
    definitive_auvo_task_id: null,
    reconciliation_reason: null,
    version: 1,
    created_at: '2026-08-05T00:00:00Z',
    updated_at: '2026-08-05T00:00:00Z',
    completed_at: null,
    items: [{
      id: 'item-1',
      operation_id: 'operation-1',
      line_key: 'product-1::::0',
      product_id: 'product-1',
      variation_id: '',
      product_name: 'Peça',
      product_code: 'P1',
      unit: 'UN',
      original_quantity: 10,
      reserved_quantity: 0,
      withdrawn_quantity: withdrawn,
      pending_purchase_quantity: 10 - withdrawn,
      available_to_reserve_quantity: 10 - withdrawn,
      global_reserved_quantity: 0,
      reserved_other_operations_quantity: 0,
      line_snapshot: {},
    }],
    batches: withdrawn > 0 ? [{
      id: `batch-${withdrawn}`,
      operation_id: 'operation-1',
      sequence: 1,
      marker: 'PP-PARCIAL-OS-1-1',
      status: 'confirmed',
      auxiliary_document_type: 'os',
      auxiliary_document_id: `aux-${withdrawn}`,
      auxiliary_document_code: '100',
      error_message: null,
      auvo_task_id: null,
      auvo_task_error: null,

      created_at: '2026-08-05T00:00:00Z',
      confirmed_at: '2026-08-05T00:00:00Z',
    }] : [],
  };
}

describe('demanda da baixa parcial', () => {
  it('mantém somente o saldo pendente após uma retirada de 4 em 10', () => {
    const result = buildActivePartialDemand([operation(4)]);
    expect(result.pendingByBudgetAndProduct.get('budget-10')?.get('product-1')).toBe(6);
    expect(result.auxiliaryDocumentIds.has('os:aux-4')).toBe(true);
  });

  it('chega a zero no cenário 4 + 2 + 4', () => {
    const result = buildActivePartialDemand([operation(10, 'ready_to_consolidate')]);
    expect(result.pendingByBudgetAndProduct.get('budget-10')?.get('product-1')).toBe(0);
  });

  it('remove operações concluídas do fluxo de Compras e Rastreador', () => {
    const result = buildActivePartialDemand([operation(10, 'completed')]);
    expect(result.activeBudgetIds.size).toBe(0);
    expect(result.pendingByBudgetAndProduct.size).toBe(0);
  });
});

describe('comprometimento global de estoque', () => {
  it('bloqueia uma segunda OS quando todo o saldo físico já está reservado', () => {
    const availability = getPartialStockAvailability({
      available_to_reserve_quantity: 1,
      global_reserved_quantity: 1,
    }, 1);

    expect(availability.availableStock).toBe(0);
    expect(availability.maxReservable).toBe(0);
    expect(availability.overcommitted).toBe(false);
  });

  it('sinaliza reservas antigas acima do saldo físico', () => {
    const availability = getPartialStockAvailability({
      available_to_reserve_quantity: 2,
      global_reserved_quantity: 3,
    }, 1);

    expect(availability.availableStock).toBe(0);
    expect(availability.maxReservable).toBe(0);
    expect(availability.overcommitted).toBe(true);
  });
});

describe('origem do orçamento no GestãoClick', () => {
  it('mantém orçamento de produto como venda mesmo quando possui serviço adicional', () => {
    expect(documentTypeForBudgetKind('produto', { servicos: [{ id: 'service-1' }] })).toBe('venda');
  });

  it('mantém orçamento de serviço como OS mesmo quando possui somente produtos', () => {
    expect(documentTypeForBudgetKind('servico', { produtos: [{ id: 'product-1' }] })).toBe('os');
  });

  it('mantém venda existente como venda', () => {
    expect(documentTypeForBudgetKind('venda', { produtos: [{ id: 'product-1' }] })).toBe('venda');
  });

  it('bloqueia orçamento que já gerou OS', () => {
    expect(isBudgetEligibleForPartialWriteoff({ nome_situacao: 'Aprovado - OS Gerada' })).toBe(false);
  });

  it('bloqueia orçamento que já gerou venda', () => {
    expect(isBudgetEligibleForPartialWriteoff({ nome_situacao: 'Aprovado - Venda Gerada' })).toBe(false);
  });

  it('aceita orçamento aprovado que ainda não gerou documento', () => {
    expect(isBudgetEligibleForPartialWriteoff({ nome_situacao: 'Aprovado' })).toBe(true);
  });

  it('aceita venda que ainda não movimentou estoque', () => {
    expect(isSaleEligibleForPartialWriteoff({ situacao_estoque: '0' })).toBe(true);
  });

  it('bloqueia venda que já movimentou estoque', () => {
    expect(isSaleEligibleForPartialWriteoff({ situacao_estoque: '1' })).toBe(false);
  });

  it('bloqueia venda quando a API não informa a situação de estoque', () => {
    expect(isSaleEligibleForPartialWriteoff({})).toBe(false);
  });
});
