import { describe, expect, it } from 'vitest';
import {
  retainAvailableSituationIds,
  scopeSituationCatalog,
  scopeSituationIds,
} from './situationScopes';

describe('situationScopes', () => {
  const mergedCatalog = [
    { id: '7063587', nome: 'Aguardando Envio' },
    { id: '7063579', nome: 'AGUARDANDO COMPRA DE PEÇAS' },
    { id: '7063583', nome: 'Em aberto' },
    { id: '7063591', nome: 'Situação sem módulo válido' },
    { id: '7063587', nome: 'Duplicada' },
  ];

  it('keeps only budget situations from a merged catalog', () => {
    expect(scopeSituationCatalog(mergedCatalog, 'orcamento')).toEqual([
      { id: '7063587', nome: 'Aguardando Envio' },
    ]);
  });

  it('keeps only service-order situations from a merged catalog', () => {
    expect(scopeSituationCatalog(mergedCatalog, 'os')).toEqual([
      { id: '7063579', nome: 'AGUARDANDO COMPRA DE PEÇAS' },
    ]);
  });

  it('keeps only sales situations from a merged catalog', () => {
    expect(scopeSituationCatalog(mergedCatalog, 'venda')).toEqual([
      { id: '7063583', nome: 'Em aberto' },
    ]);
  });

  it('accepts new IDs when the upstream catalog is already scoped', () => {
    expect(scopeSituationCatalog([
      { id: '7063587', nome: 'Aguardando Envio' },
      { id: 'new-budget-status', nome: 'Novo status' },
    ], 'orcamento')).toEqual([
      { id: '7063587', nome: 'Aguardando Envio' },
      { id: 'new-budget-status', nome: 'Novo status' },
    ]);
  });

  it('removes foreign persisted IDs and unavailable selections', () => {
    expect(scopeSituationIds(['7063579', '7063587', '7063579'], 'os')).toEqual([
      '7063579',
    ]);
    expect(retainAvailableSituationIds(
      ['7063579', '7063587'],
      [{ id: '7063579' }],
    )).toEqual(['7063579']);
  });
});
