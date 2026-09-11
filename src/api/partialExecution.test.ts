import { describe, expect, it } from 'vitest';
import { appendUniqueNote, executionDocument, isCancelledStatus, isExecutedStatus, requireExecutedDocuments } from './partialExecution';

describe('consolidação somente depois da execução', () => {
  it('bloqueia o caso real 4784 enquanto a 10137 está apenas conferida', () => {
    const documents = [
      executionDocument('1', { id: '389884274', codigo: '10034', nome_situacao: 'EXECUTADO - AGUARDANDO NEGOCIAÇÃO FINANCEIRA', situacao_estoque: '1' }),
      executionDocument('2', { id: '393982618', codigo: '10137', nome_situacao: 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO', situacao_estoque: '1' }),
    ];
    expect(() => requireExecutedDocuments(documents)).toThrow('10137');
    documents[1] = executionDocument('2', { id: '393982618', codigo: '10137', nome_situacao: 'EXECUTADO - AGUARDANDO PAGAMENTO', situacao_estoque: '1' });
    expect(() => requireExecutedDocuments(documents)).not.toThrow();
  });
  it('não confunde não executado, retirada, conferência ou cancelamento com execução', () => {
    for (const status of ['NÃO EXECUTADO', 'RETIRADA PELO TÉCNICO', 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO', 'Cancelada - Uso em OS']) {
      expect(isExecutedStatus(status)).toBe(false);
    }
    expect(isCancelledStatus('CANCELADA')).toBe(true);
  });
  it('não conclui com dado ausente ou estoque não aplicado', () => {
    expect(() => executionDocument('1', { id: '1' })).toThrow();
    expect(() => requireExecutedDocuments([])).toThrow();
    expect(() => requireExecutedDocuments([executionDocument('1', { id: '1', nome_situacao: 'EXECUTADO', situacao_estoque: '0' })])).toThrow();
  });
  it('acrescenta a referência final sem apagar observações nem repeti-la no retry', () => {
    expect(appendUniqueNote(appendUniqueNote('Histórico do técnico', 'Finalizada na OS 10'), 'Finalizada na OS 10'))
      .toBe('Histórico do técnico\nFinalizada na OS 10');
  });
});
