export function parseGcBoolean(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (value === null || value === undefined || String(value).trim() === '') return null;

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'sim', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'nao', 'não', 'no'].includes(normalized)) return false;
  return null;
}

/**
 * A política configurada pelo usuário é uma regra explícita de negócio.
 * Portanto, uma situação selecionada conta como saída mesmo quando o GC
 * retorna situacao_estoque=0. Fora da política, o efeito real positivo do GC
 * ainda inclui automaticamente o documento.
 */
export function shouldCountInventoryConsumption(
  situacaoEstoque: unknown,
  situacaoId: unknown,
  configuredSituacaoIds: readonly string[],
): boolean {
  const configured = configuredSituacaoIds.includes(String(situacaoId ?? ''));
  return configured || parseGcBoolean(situacaoEstoque) === true;
}
