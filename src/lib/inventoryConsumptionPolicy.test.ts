import { describe, expect, it } from 'vitest';
import {
  parseGcBoolean,
  shouldCountInventoryConsumption,
} from '../../supabase/functions/_shared/inventory-consumption-policy';

describe('inventory consumption policy', () => {
  it('accepts a situation selected by the user even when GC returns stock effect 0', () => {
    expect(shouldCountInventoryConsumption('0', '8219136', ['8219136'])).toBe(true);
  });

  it('accepts a positive stock effect even when the situation is not selected', () => {
    expect(shouldCountInventoryConsumption('1', '9159739', [])).toBe(true);
  });

  it('rejects a document only when neither the policy nor GC marks an output', () => {
    expect(shouldCountInventoryConsumption('0', '999', ['8219136'])).toBe(false);
    expect(shouldCountInventoryConsumption(null, '999', ['8219136'])).toBe(false);
  });

  it('normalizes GestãoClick boolean values', () => {
    expect(parseGcBoolean('sim')).toBe(true);
    expect(parseGcBoolean('não')).toBe(false);
    expect(parseGcBoolean('')).toBeNull();
  });
});
