type RecordValue = Record<string, any>;
const normalized = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

/** Use the budget's explicit field first, then only services measured in technical hours. */
export function budgetTechnicalHours(budget: RecordValue): string | null {
  for (const entry of budget.atributos || []) {
    const a = entry.atributo || entry;
    const name = normalized(a.descricao || a.nome);
    if (String(a.atributo_id) === '67350' || /HORAS?.*TECNIC/.test(name)) {
      const value = String(a.conteudo ?? '').trim();
      if (value) return value;
    }
  }
  let hours = 0;
  let found = false;
  for (const entry of budget.servicos || []) {
    const service = entry.servico || entry;
    const name = normalized(service.nome_servico);
    if (!/\bHORA\s+TECNICA\b|\bHORA\s+HOMEM\b/.test(name)) continue;
    const value = String(service.quantidade ?? '').trim();
    const quantity = Number(value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value);
    if (!Number.isFinite(quantity) || quantity < 0) return null;
    found = true;
    hours += quantity;
  }
  return found ? String(Number(hours.toFixed(6))) : null;
}

/** Fill only a missing OS field. Preserve manual values (e.g. 26), all other attributes and the source. */
export function withMissingTechnicalHours(document: RecordValue, budget: RecordValue): RecordValue {
  const attributes = structuredClone(document.atributos || []);
  const existing = attributes.find((entry: RecordValue) => String((entry.atributo || entry).atributo_id) === '73897');
  if (existing && String((existing.atributo || existing).conteudo ?? '').trim()) return document;
  const hours = budgetTechnicalHours(budget);
  if (hours === null) throw new Error('A OS está sem HORAS TÉCNICAS e o orçamento não informa esse valor. Preencha o campo na OS do GestãoClick antes de retomar o Checkout.');
  if (existing) (existing.atributo || existing).conteudo = hours;
  else attributes.push({ atributo: { atributo_id: '73897', conteudo: hours } });
  return { ...document, atributos: attributes };
}
