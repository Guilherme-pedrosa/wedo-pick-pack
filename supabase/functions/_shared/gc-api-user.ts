export const GC_API_USER_ID = '1320473';

/**
 * Every GestãoClick read must be attributed to the dedicated API user.
 * `set` deliberately overwrites a caller-supplied usuario_id so a human/master
 * account can never be charged by accident.
 */
export function withGcApiUser(
  pathOrUrl: string,
  baseUrl = 'https://api.gestaoclick.com',
): string {
  const base = new URL(baseUrl);
  const url = new URL(pathOrUrl, base);
  if (url.origin !== base.origin) {
    throw new Error('GC_API_URL_OUTSIDE_ALLOWED_ORIGIN');
  }
  url.searchParams.set('usuario_id', GC_API_USER_ID);
  return url.toString();
}

/** Force write attribution without mutating the source payload. */
export function withGcApiUserPayload(
  payload: unknown,
): Record<string, unknown> {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};

  return { ...source, usuario_id: GC_API_USER_ID };
}
