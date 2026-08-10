import { describe, expect, it } from 'vitest';
import { budgetStatusUpdatePayload } from './partialWriteoffClient';

describe('situacao do orcamento apos baixa parcial', () => {
  it('preserva linhas e financeiro e altera somente a situacao controlada', () => {
    const produtos = [{ produto: { produto_id: '1', quantidade: '2' } }];
    const pagamentos = [{ pagamento: { valor: '100.00' } }];
    const payload = budgetStatusUpdatePayload({
      id: 'budget-1',
      codigo: '5561',
      cliente_id: 'client-1',
      data: '2026-08-10',
      valor_total: '100.00',
      valor_frete: '0.00',
      condicao_pagamento: 'a_vista',
      produtos,
      servicos: [],
      pagamentos,
      desconto_valor: '5.00',
      nome_situacao: 'COMPRADO - AGUARDANDO CHEGADA',
    }, '9348312');

    expect(payload).toMatchObject({
      situacao_id: '9348312',
      cliente_id: 'client-1',
      valor_total: '100.00',
      produtos,
      pagamentos,
      desconto_valor: '5.00',
    });
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('codigo');
    expect(payload).not.toHaveProperty('nome_situacao');
  });

  it('sempre envia arrays validos quando o GC omite produtos ou servicos', () => {
    const payload = budgetStatusUpdatePayload({ cliente_id: 'client-1' }, '9348312');

    expect(payload.produtos).toEqual([]);
    expect(payload.servicos).toEqual([]);
    expect(payload.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
