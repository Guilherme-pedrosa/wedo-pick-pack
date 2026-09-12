import {describe,it,expect} from 'vitest';
import {purchaseScanDue,purchaseSnapshotStale} from '../../supabase/functions/_shared/purchaseFreshness';
describe('atualidade da lista de compras',()=>{
  const now=Date.parse('2026-09-12T03:00:00Z');
  it('só executa nova varredura após três horas ou sem resultado válido',()=>{
    expect(purchaseScanDue('2026-09-12T01:00:00Z',now)).toBe(false);
    expect(purchaseScanDue('2026-09-12T00:00:00Z',now)).toBe(true);
    expect(purchaseScanDue(null,now)).toBe(true);
  });
  it('não esconde uma lista atrasada ou ausente atrás de contagem zero',()=>{
    expect(purchaseSnapshotStale('2026-09-11T23:00:00Z',now)).toBe(true);
    expect(purchaseSnapshotStale(null,now)).toBe(true);
    expect(purchaseSnapshotStale('2026-09-12T01:00:00Z',now)).toBe(false);
  });
});
