import { describe, expect, it } from 'vitest';
import {
  GC_API_USER_ID,
  withGcApiUser,
  withGcApiUserPayload,
} from '../../supabase/functions/_shared/gc-api-user';

describe('GestãoClick API user attribution', () => {
  it('adds the dedicated API user without dropping existing query parameters', () => {
    const result = new URL(withGcApiUser('/api/produtos?pagina=3&limite=100'));

    expect(result.origin).toBe('https://api.gestaoclick.com');
    expect(result.pathname).toBe('/api/produtos');
    expect(result.searchParams.get('pagina')).toBe('3');
    expect(result.searchParams.get('limite')).toBe('100');
    expect(result.searchParams.get('usuario_id')).toBe(GC_API_USER_ID);
  });

  it('overwrites a caller-supplied human usuario_id in URLs', () => {
    const result = new URL(withGcApiUser('/api/vendas?usuario_id=999999'));

    expect(result.searchParams.getAll('usuario_id')).toEqual([GC_API_USER_ID]);
  });

  it('does not allow proxy callers to redirect GC credentials to another origin', () => {
    expect(() => withGcApiUser('https://example.com/collect')).toThrow(
      'GC_API_URL_OUTSIDE_ALLOWED_ORIGIN',
    );
  });

  it('overwrites a caller-supplied human usuario_id in write payloads without mutation', () => {
    const source = { nome: 'Produto', usuario_id: '999999' };
    const result = withGcApiUserPayload(source);

    expect(result).toEqual({ nome: 'Produto', usuario_id: GC_API_USER_ID });
    expect(source.usuario_id).toBe('999999');
  });

  it('creates a valid attributed payload when the caller has no object body', () => {
    expect(withGcApiUserPayload(undefined)).toEqual({ usuario_id: GC_API_USER_ID });
  });
});
