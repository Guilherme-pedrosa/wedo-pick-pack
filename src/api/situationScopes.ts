/**
 * GestãoClick currently returns the same merged catalog from the budget,
 * service-order and sales situation endpoints.
 *
 * These IDs come from each module's own situation registry in GestãoClick,
 * verified on 2026-07-24.
 */
export const SITUATION_IDS_BY_SCOPE = {
  orcamento: [
    '7063587',
    '7084340',
    '8757598',
    '7065899',
    '7063588',
    '8743484',
    '8743485',
    '8894381',
    '7109779',
    '7706107',
    '7063590',
    '7063589',
    '7841143',
    '8677888',
    '9153484',
  ],
  os: [
    '7063579',
    '7063580',
    '7659440',
    '7063581',
    '7213493',
    '7063705',
    '7684665',
    '7116099',
    '7063724',
    '7720756',
    '7124107',
    '8889036',
    '9203836',
    '7438044',
    '7535001',
    '8677491',
    '8760417',
    '7261986',
    '7063582',
    '7748831',
    '7873226',
    '8219136',
    '8679279',
    '8685059',
    '8707654',
    '8736723',
    '8756156',
    '8896431',
    '8928768',
    '9196494',
  ],
  venda: [
    '7063583',
    '8955109',
    '7063584',
    '8719737',
    '7063585',
    '7341121',
    '7340922',
    '7340612',
    '7340674',
    '7349298',
    '7340613',
    '7340738',
    '7063586',
    '7347355',
    '7352089',
    '7411572',
    '7427988',
    '7756506',
    '8163483',
    '9159739',
    '9251509',
    '9273222',
  ],
} as const;

export type SituationScope = keyof typeof SITUATION_IDS_BY_SCOPE;

type SituationLike = {
  id: string | number;
};

const SCOPE_ID_SETS: Record<SituationScope, ReadonlySet<string>> = {
  orcamento: new Set(SITUATION_IDS_BY_SCOPE.orcamento),
  os: new Set(SITUATION_IDS_BY_SCOPE.os),
  venda: new Set(SITUATION_IDS_BY_SCOPE.venda),
};

const FOREIGN_ID_SETS: Record<SituationScope, ReadonlySet<string>> = {
  orcamento: new Set([
    ...SITUATION_IDS_BY_SCOPE.os,
    ...SITUATION_IDS_BY_SCOPE.venda,
  ]),
  os: new Set([
    ...SITUATION_IDS_BY_SCOPE.orcamento,
    ...SITUATION_IDS_BY_SCOPE.venda,
  ]),
  venda: new Set([
    ...SITUATION_IDS_BY_SCOPE.orcamento,
    ...SITUATION_IDS_BY_SCOPE.os,
  ]),
};

function dedupeSituations<T extends SituationLike>(situations: T[]): T[] {
  const seen = new Set<string>();
  return situations.filter((situation) => {
    const id = String(situation?.id ?? '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Filters only when the response contains IDs known to belong to another
 * module. If GestãoClick fixes the endpoint and returns a clean catalog, new
 * IDs are accepted automatically.
 */
export function scopeSituationCatalog<T extends SituationLike>(
  situations: T[] | null | undefined,
  scope: SituationScope,
): T[] {
  const normalized = dedupeSituations(Array.isArray(situations) ? situations : []);
  const foreignIds = FOREIGN_ID_SETS[scope];
  const isMergedCatalog = normalized.some((situation) =>
    foreignIds.has(String(situation.id)),
  );

  if (!isMergedCatalog) return normalized;

  const allowedIds = SCOPE_ID_SETS[scope];
  return normalized.filter((situation) =>
    allowedIds.has(String(situation.id)),
  );
}

export function scopeSituationIds(
  ids: string[] | null | undefined,
  scope: SituationScope,
): string[] {
  const allowedIds = SCOPE_ID_SETS[scope];
  return [...new Set((ids || []).map(String))]
    .filter((id) => allowedIds.has(id));
}

export function retainAvailableSituationIds<T extends SituationLike>(
  ids: string[] | null | undefined,
  situations: T[] | null | undefined,
): string[] {
  const available = new Set((situations || []).map((situation) => String(situation.id)));
  return [...new Set((ids || []).map(String))]
    .filter((id) => available.has(id));
}
