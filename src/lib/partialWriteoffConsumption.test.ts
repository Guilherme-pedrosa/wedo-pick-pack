import { describe, expect, it } from 'vitest';
import {
  activePartialWriteoffSourceIds,
  activePartialWriteoffSourceKey,
} from '../../supabase/functions/_shared/partial-writeoff-consumption';

describe('fonte de consumo de baixa parcial', () => {
  it('suprime a venda original enquanto a operacao esta ativa', () => {
    const operation = {
      budget_id: 'venda:379827387',
      status: 'awaiting_balance',
      budget_snapshot: {},
    };

    expect(activePartialWriteoffSourceKey(operation)).toBe('venda:379827387');
    expect(activePartialWriteoffSourceIds([operation], 'venda')).toEqual(new Set(['379827387']));
  });

  it('usa os metadados explicitos sem confundir orcamento de servico com OS', () => {
    const serviceBudget = {
      budget_id: '372128156',
      status: 'awaiting_balance',
      budget_snapshot: {
        _partial_source_kind: 'servico',
        _partial_source_id: '372128156',
      },
    };
    const osSource = {
      budget_id: 'budget-local',
      status: 'partial_separation',
      budget_snapshot: {
        _partial_source_kind: 'os',
        _partial_source_id: '9981',
      },
    };

    expect(activePartialWriteoffSourceKey(serviceBudget)).toBeNull();
    expect(activePartialWriteoffSourceIds([serviceBudget, osSource], 'os')).toEqual(new Set(['9981']));
  });

  it.each(['completed', 'cancelled'])('libera a origem quando a operacao fica %s', (status) => {
    expect(activePartialWriteoffSourceKey({ budget_id: 'venda:123', status })).toBeNull();
  });
});
