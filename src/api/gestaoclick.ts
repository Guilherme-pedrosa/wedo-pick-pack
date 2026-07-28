import { GCOrdemServico, GCVenda, GCSituacao, GCMeta, GCProdutoItem, GCOrdemCompra } from './types';
import { listOrdensCompra } from './compras';
import { MOCK_OS, MOCK_VENDAS, MOCK_STATUS_OS, MOCK_STATUS_VENDA } from './mockData';
import { scopeSituationCatalog, scopeSituationIds } from './situationScopes';
import { supabase } from '@/integrations/supabase/client';

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

export function isUsingMock(): boolean {
  return !SUPABASE_PROJECT_ID;
}

const GC_PROXY_TIMEOUT_MS = 20000;
const GC_GET_MAX_ATTEMPTS = 3;

async function apiRequest<T>(path: string, options?: { method?: string; body?: string }): Promise<T> {
  const method = options?.method || 'GET';
  const isGet = method === 'GET';
  const maxAttempts = isGet ? GC_GET_MAX_ATTEMPTS : 1;
  const payload = options?.body ? JSON.parse(options.body) : undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), GC_PROXY_TIMEOUT_MS);
      });

      const invokePromise = supabase.functions.invoke('gc-proxy', {
        body: { path, method, payload },
      });

      const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

      if (error) {
        const msg = error.message || 'Erro de conexão com o servidor';
        if (msg.includes('Failed to fetch')) throw new Error('NETWORK_ERROR');
        throw new Error(msg);
      }

      const response = data as any;

      // Check proxy metadata for GC API errors
      const proxyMeta = response?._proxy;
      const gcOk = proxyMeta?.ok;
      const gcHttpStatus = proxyMeta?.gc_http_status;

      // Also check GC's own status field in body
      const gcBodyStatus = response?.status; // "success" or "error"
      const gcBodyCode = response?.code; // numeric status from GC

      if (gcOk === false || gcBodyStatus === 'error' || (gcBodyCode && gcBodyCode >= 400)) {
        const gcMsg = response?.data?.mensagem || response?.data?.erro || response?.error || '';
        const statusCode = gcHttpStatus || gcBodyCode || 0;

        if (statusCode === 429) {
          if (attempt < maxAttempts - 1) {
            const waitMs = 900 * (attempt + 1) + Math.floor(Math.random() * 200);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
          throw new Error('RATE_LIMIT');
        }

        if (statusCode === 401 || statusCode === 403) throw new Error('AUTH_ERROR');
        throw new Error(gcMsg || `Erro ${statusCode} no GestãoClick`);
      }

      return response as T;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      const retryable = isGet && (message === 'REQUEST_TIMEOUT' || message === 'NETWORK_ERROR' || message === 'RATE_LIMIT');

      if (retryable && attempt < maxAttempts - 1) {
        const waitMs = 900 * (attempt + 1) + Math.floor(Math.random() * 200);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (message === 'REQUEST_TIMEOUT') throw new Error('TIMEOUT');
      throw err instanceof Error ? err : new Error('Erro de conexão com o servidor');
    }
  }

  throw new Error('Erro de conexão com o servidor');
}

const mockDelay = () => new Promise(r => setTimeout(r, 300));

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function normalizeStatusId(value: unknown): string {
  return String(value ?? '').trim();
}

async function confirmStatusApplied(tipo: 'os' | 'venda', id: string, expectedStatusId: string): Promise<boolean> {
  const path = tipo === 'os' ? `/api/ordens_servicos/${id}` : `/api/vendas/${id}`;
  const expected = normalizeStatusId(expectedStatusId);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await apiRequest<{ data?: { situacao_id?: string | number } }>(path);
      const current = normalizeStatusId(res?.data?.situacao_id);
      if (current === expected) return true;
    } catch {
      // ignore transient read errors and retry
    }

    if (attempt < 2) await wait(900);
  }

  return false;
}

// --- LIST ---
export async function listOS(situacaoId?: string, pagina = 1, pesquisa?: string): Promise<{ data: GCOrdemServico[]; meta: GCMeta }> {
  const term = pesquisa?.trim();

  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_OS];
    if (situacaoId) data = data.filter(o => o.situacao_id === situacaoId);
    if (term) {
      const q = term.toLowerCase();
      data = data.filter(o =>
        o.codigo.toLowerCase().includes(q) ||
        o.nome_cliente.toLowerCase().includes(q)
      );
    }
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }

  const params = new URLSearchParams({ pagina: String(pagina) });
  if (situacaoId) params.set('situacao_id', situacaoId);

  // Mantém a fila com os códigos mais novos no topo (ex.: OS 9090)
  params.set('ordenacao', 'codigo');
  params.set('direcao', 'desc');

  if (term) {
    if (/^\d+$/.test(term)) {
      params.set('codigo', term);
      params.set('limite', '100');
    }
    // Text search (client name) is handled client-side — GC 'nome' param
    // searches OS title, not client name, so we skip it here.
  }

  return apiRequest<{ data: GCOrdemServico[]; meta: GCMeta }>(`/api/ordens_servicos?${params.toString()}`);
}

/** Fetch OS for multiple situacao_ids in parallel, merging & deduplicating results */
export async function listOSMultiStatus(situacaoIds: string[], pesquisa?: string): Promise<{ data: GCOrdemServico[]; meta: GCMeta }> {
  const scopedIds = isUsingMock()
    ? [...new Set(situacaoIds)]
    : scopeSituationIds(situacaoIds, 'os');
  if (situacaoIds.length === 0) return listOS(undefined, 1, pesquisa);
  if (scopedIds.length === 0) {
    return { data: [], meta: { pagina_atual: 1, total_paginas: 1, total_registros: 0 } };
  }
  if (scopedIds.length === 1) return listOS(scopedIds[0], 1, pesquisa);

  const results = await Promise.all(
    scopedIds.map(sid => listOS(sid, 1, pesquisa).catch(() => ({ data: [] as GCOrdemServico[], meta: { pagina_atual: 1, total_paginas: 1, total_registros: 0 } })))
  );

  const seen = new Set<string>();
  const merged: GCOrdemServico[] = [];
  for (const r of results) {
    for (const o of r.data) {
      if (!seen.has(o.id)) { seen.add(o.id); merged.push(o); }
    }
  }
  return { data: merged, meta: { pagina_atual: 1, total_paginas: 1, total_registros: merged.length } };
}

export async function listVendas(situacaoId?: string, pagina = 1, pesquisa?: string): Promise<{ data: GCVenda[]; meta: GCMeta }> {
  const term = pesquisa?.trim();

  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_VENDAS];
    if (situacaoId) data = data.filter(v => v.situacao_id === situacaoId);
    if (term) {
      const q = term.toLowerCase();
      data = data.filter(v =>
        v.codigo.toLowerCase().includes(q) ||
        v.nome_cliente.toLowerCase().includes(q)
      );
    }
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }

  const params = new URLSearchParams({ pagina: String(pagina) });
  if (situacaoId) params.set('situacao_id', situacaoId);

  params.set('ordenacao', 'codigo');
  params.set('direcao', 'desc');

  if (term) {
    if (/^\d+$/.test(term)) {
      params.set('codigo', term);
      params.set('limite', '100');
    }
    // Text search (client name) is handled client-side
  }

  return apiRequest<{ data: GCVenda[]; meta: GCMeta }>(`/api/vendas?${params.toString()}`);
}

/** Fetch Vendas for multiple situacao_ids in parallel, merging & deduplicating results */
export async function listVendasMultiStatus(situacaoIds: string[], pesquisa?: string): Promise<{ data: GCVenda[]; meta: GCMeta }> {
  const scopedIds = isUsingMock()
    ? [...new Set(situacaoIds)]
    : scopeSituationIds(situacaoIds, 'venda');
  if (situacaoIds.length === 0) return listVendas(undefined, 1, pesquisa);
  if (scopedIds.length === 0) {
    return { data: [], meta: { pagina_atual: 1, total_paginas: 1, total_registros: 0 } };
  }
  if (scopedIds.length === 1) return listVendas(scopedIds[0], 1, pesquisa);

  const results = await Promise.all(
    scopedIds.map(sid => listVendas(sid, 1, pesquisa).catch(() => ({ data: [] as GCVenda[], meta: { pagina_atual: 1, total_paginas: 1, total_registros: 0 } })))
  );

  const seen = new Set<string>();
  const merged: GCVenda[] = [];
  for (const r of results) {
    for (const o of r.data) {
      if (!seen.has(o.id)) { seen.add(o.id); merged.push(o); }
    }
  }
  return { data: merged, meta: { pagina_atual: 1, total_paginas: 1, total_registros: merged.length } };
}

// --- GET SINGLE ---
export async function getOS(id: string): Promise<GCOrdemServico> {
  if (isUsingMock()) {
    await mockDelay();
    const found = MOCK_OS.find(o => o.id === id);
    if (!found) throw new Error('NOT_FOUND');
    return { ...found };
  }
  const res = await apiRequest<{ data: GCOrdemServico }>(`/api/ordens_servicos/${id}`);
  return res.data;
}

export async function getVenda(id: string): Promise<GCVenda> {
  if (isUsingMock()) {
    await mockDelay();
    const found = MOCK_VENDAS.find(v => v.id === id);
    if (!found) throw new Error('NOT_FOUND');
    return { ...found };
  }
  const res = await apiRequest<{ data: GCVenda }>(`/api/vendas/${id}`);
  return res.data;
}

// --- STATUSES ---
export async function getStatusOS(): Promise<GCSituacao[]> {
  if (isUsingMock()) {
    await mockDelay();
    return [...MOCK_STATUS_OS];
  }
  const res = await apiRequest<{ data: GCSituacao[] }>('/api/situacoes_ordens_servicos');
  return scopeSituationCatalog(res.data, 'os');
}

export async function getStatusVendas(): Promise<GCSituacao[]> {
  if (isUsingMock()) {
    await mockDelay();
    return [...MOCK_STATUS_VENDA];
  }
  const res = await apiRequest<{ data: GCSituacao[] }>('/api/situacoes_vendas');
  return scopeSituationCatalog(res.data, 'venda');
}

// --- UPDATE STATUS ---
async function fetchLatestForStatusUpdate<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await apiRequest<{ data?: T }>(path);
    if (res?.data) return res.data;
  } catch (error) {
    console.warn(
      `[GC] Failed to fetch latest doc before status update (${path}):`,
      error instanceof Error ? error.message : error
    );
  }
  return fallback;
}

type GCUpdateResponse = {
  data?: { situacao_id?: string | number };
  situacao_id?: string | number;
};

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseCurrency(value: unknown): number {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: number, decimals = 2): string {
  return roundTo(value, decimals).toFixed(decimals);
}

const MONEY_FIELDS = ['valor_venda', 'valor_custo', 'valor_total', 'desconto_valor', 'valor_frete', 'valor'];

function normalizeMoneyValue(value: unknown): string {
  return formatCurrency(parseCurrency(value), 2);
}

function normalizeLineMoney<T extends Record<string, any>>(
  items: T[] | undefined,
  key: 'produto' | 'servico'
): T[] | undefined {
  if (!Array.isArray(items)) return items;

  return items.map((entry) => {
    const line = entry?.[key] || entry;
    if (!line || typeof line !== 'object') return entry;

    const normalizedLine = { ...line };
    for (const field of MONEY_FIELDS) {
      if (normalizedLine[field] != null && String(normalizedLine[field]).trim() !== '') {
        normalizedLine[field] = normalizeMoneyValue(normalizedLine[field]);
      }
    }
    if (normalizedLine.desconto_porcentagem != null && String(normalizedLine.desconto_porcentagem).trim() !== '') {
      normalizedLine.desconto_porcentagem = normalizeMoneyValue(normalizedLine.desconto_porcentagem);
    }

    if (entry?.[key] && typeof entry[key] === 'object') {
      return { ...entry, [key]: normalizedLine };
    }

    return normalizedLine as T;
  });
}

function normalizePaymentsMoney(payments: any[] | undefined): any[] | undefined {
  if (!Array.isArray(payments)) return payments;
  return payments.map((payment) => {
    if (payment?.pagamento && typeof payment.pagamento === 'object') {
      return {
        ...payment,
        pagamento: {
          ...payment.pagamento,
          valor: normalizeMoneyValue(payment.pagamento.valor),
        },
      };
    }
    if (payment?.valor != null) return { ...payment, valor: normalizeMoneyValue(payment.valor) };
    return payment;
  });
}

const FINANCIAL_SCALE = 4n;
const FINANCIAL_FACTOR = 10n ** FINANCIAL_SCALE;

function parseScaledDecimal(value: unknown, scale = Number(FINANCIAL_SCALE)): bigint {
  const raw = String(value ?? '').trim();
  if (!raw) return 0n;

  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const sign = normalized.startsWith('-') ? -1n : 1n;
  const unsigned = normalized.replace(/^[+-]/, '');
  const [integerPart = '0', fractionPart = ''] = unsigned.split('.');
  const integerDigits = integerPart.replace(/\D/g, '') || '0';
  const fractionDigits = fractionPart.replace(/\D/g, '');
  const keptFraction = fractionDigits.slice(0, scale).padEnd(scale, '0');
  const nextDigit = Number(fractionDigits[scale] || '0');

  let scaled = BigInt(integerDigits) * (10n ** BigInt(scale)) + BigInt(keptFraction || '0');
  if (nextDigit >= 5) scaled += 1n;
  return scaled * sign;
}

function roundFractionToInt(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) return 0n;
  if (numerator <= 0n) return 0n;
  return (numerator + denominator / 2n) / denominator;
}

function computeExpectedLineGrossUnitPrice(line: Record<string, any>): number | null {
  const qty = parseCurrency(line.quantidade);
  if (qty <= 0) return null;

  const hasLineTotal = String(line.valor_total ?? '').trim() !== '';
  if (!hasLineTotal) return null;

  const lineTotal = parseCurrency(line.valor_total);
  const fixedDiscount = parseCurrency(line.desconto_valor);
  const percentDiscount = parseCurrency(line.desconto_porcentagem);

  // GestãoClick validates PUTs using the gross unit price (before line discounts).
  // Some documents with fixed discounts come back from GET with valor_venda already
  // netted down to zero, which makes the ERP subtract the discount twice on update.
  if (fixedDiscount > 0) {
    return (lineTotal + fixedDiscount) / qty;
  }

  if (percentDiscount > 0 && percentDiscount < 100) {
    const factor = 1 - percentDiscount / 100;
    if (factor <= 0) return null;
    return lineTotal / qty / factor;
  }

  return lineTotal / qty;
}

/**
 * Conservative line price normalization.
 *
 * Only fixes the specific double-discount bug where GestãoClick GET returns
 * `valor_venda = 0` (or near zero) on a line that has a `desconto_valor > 0`.
 * In that case, sending the payload back as-is causes the ERP to subtract the
 * discount a second time.
 *
 * In all other cases — including normal lines with discounts — we leave
 * `valor_venda` untouched. The values returned by GET are already consistent
 * with the installments stored in the ERP, and rewriting them would introduce
 * sub-cent rounding drift that triggers "valor das parcelas" errors.
 */
function normalizeLineUnitPrice<T extends Record<string, any>>(
  items: T[] | undefined,
  key: 'produto' | 'servico'
): T[] | undefined {
  if (!Array.isArray(items)) return items;

  return items.map((entry) => {
    const line = entry?.[key];
    if (!line || typeof line !== 'object') return entry;

    const qty = parseCurrency(line.quantidade);
    const currentUnit = parseCurrency(line.valor_venda);
    const fixedDiscount = parseCurrency(line.desconto_valor);
    const lineTotal = parseCurrency(line.valor_total);

    const declaredLineCents = Math.round(lineTotal * 100);
    const computedLineCents = computeLineTotalCents(line);

    // Fix small rounding drift from fractional quantities without changing the
    // order total. Example OS 9742: qty 1,500 × unit 145,73 is validated by GC as
    // 218,60 by our calc path, but the GC-declared line total is 218,59. When the
    // difference is below R$ 0,50, always trust GestãoClick's valor_total and send
    // the exact gross unit implied by that value so the PUT validates the stored
    // total instead of our recomputed total.
    const hasLineRoundingDrift =
      qty > 0 &&
      lineTotal >= 0 &&
      computedLineCents != null &&
      computedLineCents !== declaredLineCents &&
      Math.abs(computedLineCents - declaredLineCents) < 50;

    if (hasLineRoundingDrift) {
      const expectedUnit = computeExpectedLineGrossUnitPrice(line);
      if (expectedUnit != null && Number.isFinite(expectedUnit) && expectedUnit >= 0) {
        return {
          ...entry,
          [key]: {
            ...line,
            valor_venda: formatCurrency(expectedUnit, 2),
          },
        };
      }
    }

    // Only intervene in the exact double-discount scenario:
    // valor_venda is effectively zero, but the line carries a fixed discount
    // and a positive line total. Without this fix the ERP would subtract the
    // discount twice on PUT.
    const isDoubleDiscountBug =
      qty > 0 &&
      fixedDiscount > 0 &&
      currentUnit < 0.005 &&
      lineTotal > 0;

    if (!isDoubleDiscountBug) return entry;

    const grossUnit = (lineTotal + fixedDiscount) / qty;
    if (!Number.isFinite(grossUnit) || grossUnit <= 0) return entry;

    return {
      ...entry,
      [key]: {
        ...line,
        valor_venda: formatCurrency(grossUnit, 2),
      },
    };
  });
}

function computeNormalizedDocumentTotalCents(payload: Record<string, any>): number | null {
  let totalCents = 0;
  let hasLine = false;

  const addLines = (items: any[] | undefined, key: 'produto' | 'servico') => {
    if (!Array.isArray(items)) return;

    for (const entry of items) {
      const line = entry?.[key] || entry;
      if (!line || typeof line !== 'object') continue;

      const qty = parseCurrency(line.quantidade);
      const unit = parseCurrency(line.valor_venda);
      if (qty <= 0 || String(line.valor_venda ?? '').trim() === '') continue;

      let lineTotal = qty * unit;
      const discountType = String(line.tipo_desconto || line.desconto_tipo || 'R$').trim();
      const fixedDiscount = parseCurrency(line.desconto_valor);
      const percentDiscount = parseCurrency(line.desconto_porcentagem);

      if (discountType === '%' && percentDiscount > 0) {
        lineTotal *= 1 - percentDiscount / 100;
      } else if (fixedDiscount > 0) {
        lineTotal -= fixedDiscount;
      }

      totalCents += Math.round(Math.max(0, lineTotal) * 100);
      hasLine = true;
    }
  };

  addLines(payload.produtos, 'produto');
  addLines(payload.servicos, 'servico');

  if (!hasLine) return null;

  const headerDiscountCents = Math.round(parseCurrency(payload.desconto_valor) * 100);
  const headerPercent = parseCurrency(payload.desconto_porcentagem);
  const freteCents = Math.round(parseCurrency(payload.valor_frete) * 100);
  let subtotalCents = totalCents;

  if (headerPercent > 0 && headerPercent < 100) {
    subtotalCents = Math.round(subtotalCents * (1 - headerPercent / 100));
  }

  return subtotalCents - headerDiscountCents + freteCents;
}

function applySmallRoundingDiscount(payload: Record<string, any>): Record<string, any> {
  const declaredCents = Math.round(parseCurrency(payload.valor_total) * 100);
  if (declaredCents <= 0) return payload;

  const computedCents = computeNormalizedDocumentTotalCents(payload);
  if (computedCents == null || computedCents === declaredCents) return payload;

  const diffCents = computedCents - declaredCents;
  if (Math.abs(diffCents) > 100) return payload;

  const currentDiscountCents = Math.round(parseCurrency(payload.desconto_valor) * 100);
  const nextDiscountCents = currentDiscountCents + diffCents;
  if (nextDiscountCents < 0) return payload;

  console.warn(`[GC] Ajuste financeiro de centavos na separação: calculado=${formatCurrency(computedCents / 100)}, declarado=${formatCurrency(declaredCents / 100)}, ajuste=${formatCurrency(diffCents / 100)}.`);

  return {
    ...payload,
    tipo_desconto: 'R$',
    desconto_tipo: 'R$',
    desconto_valor: formatCurrency(nextDiscountCents / 100),
    desconto_porcentagem: '0.00',
  };
}

function isInstallmentMismatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('valor do pedido') && message.includes('valor das parcelas');
}

/** Read the valor from a pagamento entry, handling both flat {valor} and nested {pagamento:{valor}} */
function getPagamentoValor(p: any): number {
  if (p?.pagamento?.valor != null) return parseCurrency(p.pagamento.valor);
  return parseCurrency(p?.valor);
}

/** Set the valor on a pagamento entry, preserving whichever structure it uses */
function setPagamentoValor(p: any, newValor: string): any {
  if (p?.pagamento && typeof p.pagamento === 'object') {
    return { ...p, pagamento: { ...p.pagamento, valor: newValor } };
  }
  return { ...p, valor: newValor };
}

function computeLineTotalCents(line: Record<string, any>): number | null {
  const qty = parseScaledDecimal(line?.quantidade);
  const unit = parseScaledDecimal(line?.valor_venda);
  if (qty <= 0n || unit < 0n || String(line?.valor_venda ?? '').trim() === '') return null;

  const fixedDiscount = parseScaledDecimal(line?.desconto_valor);
  const percentDiscount = parseScaledDecimal(line?.desconto_porcentagem);
  const maxPercent = 100n * FINANCIAL_FACTOR;

  let amountNumerator = qty * unit;
  let amountDenominator = FINANCIAL_FACTOR * FINANCIAL_FACTOR;

  if (percentDiscount > 0n) {
    if (percentDiscount >= maxPercent) {
      amountNumerator = 0n;
    } else {
      amountNumerator *= maxPercent - percentDiscount;
      amountDenominator *= maxPercent;
    }
  }

  const centsNumerator = (amountNumerator * 100n * FINANCIAL_FACTOR) - (fixedDiscount * 100n * amountDenominator);
  const centsDenominator = amountDenominator * FINANCIAL_FACTOR;
  const cents = roundFractionToInt(centsNumerator, centsDenominator);
  return Number(cents);
}

/**
 * Compute the order total the same way GestãoClick's PUT validator does after
 * our line-unit normalization: calculate each line from quantidade × valor_venda,
 * round each line to cents, then sum.
 */
function computeRecomputedTotalCents(payload: Record<string, any>): number | null {
  const lineSumCents = (arr: any[] | undefined, key: 'produto' | 'servico'): number => {
    if (!Array.isArray(arr)) return 0;
    return arr.reduce((s, entry) => {
      const line = entry?.[key] || entry;
      const computed = computeLineTotalCents(line);
      if (computed != null) return s + computed;

      const declared = line?.valor_total;
      if (declared !== undefined && declared !== null && String(declared).trim() !== '') {
        return s + Math.round(parseCurrency(declared) * 100);
      }
      return s;
    }, 0);
  };

  const produtosCents = lineSumCents(payload.produtos, 'produto');
  const servicosCents = lineSumCents(payload.servicos, 'servico');
  if (produtosCents <= 0 && servicosCents <= 0) return null;

  const descontoCents = Math.round(parseCurrency(payload.desconto_valor) * 100);
  const descontoPct = parseCurrency(payload.desconto_porcentagem);
  const freteCents = Math.round(parseCurrency(payload.valor_frete) * 100);

  let subtotalCents = produtosCents + servicosCents;
  if (descontoPct > 0 && descontoPct < 100) {
    subtotalCents = Math.round(subtotalCents * (1 - descontoPct / 100));
  }
  const totalCents = subtotalCents - descontoCents + freteCents;
  return totalCents > 0 ? totalCents : null;
}

function recalcPagamentos(payload: Record<string, any>): Record<string, any> {
  const declaredTotalCents = Math.round(parseCurrency(payload.valor_total) * 100);
  const recomputedCents = computeRecomputedTotalCents(payload);

  // The document's valor_total is authoritative. Do not "fix" a stored 5361,41
  // into 5361,42; instead line-unit normalization above must make GC validate
  // the stored total.
  const targetCents = declaredTotalCents > 0 ? declaredTotalCents : (recomputedCents ?? 0);

  if (targetCents <= 0 || !Array.isArray(payload.pagamentos) || payload.pagamentos.length === 0) {
    return payload;
  }

  const nextPayload = payload;

  const parcCentsList = nextPayload.pagamentos.map((p: any) => Math.round(getPagamentoValor(p) * 100));
  const parcTotalCents = parcCentsList.reduce((s: number, c: number) => s + c, 0);

  // Already exact to the cent — no adjustment needed
  if (parcTotalCents === targetCents) return nextPayload;

  console.warn(`[GC] Pagamentos total (${parcTotalCents / 100}) ≠ alvo (${targetCents / 100}). Diff=${(targetCents - parcTotalCents) / 100}. Redistribuindo.`);

  if (nextPayload.pagamentos.length === 1) {
    return {
      ...nextPayload,
      pagamentos: [setPagamentoValor(nextPayload.pagamentos[0], formatCurrency(targetCents / 100))],
    };
  }

  // Distribute in cents proportionally; assign rounding remainder to last parcel
  const baseCents = parcTotalCents > 0 ? parcCentsList : nextPayload.pagamentos.map(() => Math.floor(targetCents / nextPayload.pagamentos.length));
  const baseSum = baseCents.reduce((s: number, c: number) => s + c, 0) || 1;

  let distributedCents = 0;
  const newCentsList: number[] = nextPayload.pagamentos.map((_: any, i: number) => {
    if (i === nextPayload.pagamentos.length - 1) {
      return targetCents - distributedCents;
    }
    const portion = Math.round((baseCents[i] * targetCents) / baseSum);
    distributedCents += portion;
    return portion;
  });

  const adjusted = nextPayload.pagamentos.map((p: any, i: number) =>
    setPagamentoValor(p, formatCurrency(newCentsList[i] / 100))
  );

  return { ...nextPayload, pagamentos: adjusted };
}

function withInstallmentPrecisionFallback(payload: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {
    ...payload,
    produtos: normalizeLineMoney(normalizeLineUnitPrice(payload.produtos, 'produto'), 'produto') || payload.produtos,
    servicos: normalizeLineMoney(normalizeLineUnitPrice(payload.servicos, 'servico'), 'servico') || payload.servicos,
    pagamentos: normalizePaymentsMoney(payload.pagamentos),
  };
  for (const field of ['valor_total', 'valor_frete', 'desconto_valor']) {
    if (normalized[field] != null && String(normalized[field]).trim() !== '') {
      normalized[field] = normalizeMoneyValue(normalized[field]);
    }
  }
  if (normalized.desconto_porcentagem != null && String(normalized.desconto_porcentagem).trim() !== '') {
    normalized.desconto_porcentagem = normalizeMoneyValue(normalized.desconto_porcentagem);
  }

  return recalcPagamentos(applySmallRoundingDiscount(normalized));
}

// O GestãoClick SÓ registra as linhas e recalcula o valor_total em PUT quando
// produtos/serviços são enviados em formato PLANO (sem o wrapper produto/servico).
// Se enviados aninhados ({ produto: {...} }), o GC zera o valor do pedido (0,00).
function flattenLinesForGC(payload: Record<string, any>): Record<string, any> {
  const out = { ...payload };
  if (Array.isArray(payload.produtos)) {
    out.produtos = payload.produtos.map((e: any) =>
      e && typeof e.produto === 'object' && e.produto ? e.produto : e
    );
  }
  if (Array.isArray(payload.servicos)) {
    out.servicos = payload.servicos.map((e: any) =>
      e && typeof e.servico === 'object' && e.servico ? e.servico : e
    );
  }
  return out;
}

async function putStatusWithRetry(path: string, payload: Record<string, any>): Promise<GCUpdateResponse> {
  const fixedPayload = flattenLinesForGC(withInstallmentPrecisionFallback(payload));

  try {
    return await apiRequest<GCUpdateResponse>(path, {
      method: 'PUT',
      body: JSON.stringify(fixedPayload),
    });
  } catch (error) {
    if (!isInstallmentMismatchError(error)) throw error;

    console.warn('[GC] Installment mismatch detected. Retrying with normalized financial payload.');
    return apiRequest<GCUpdateResponse>(path, {
      method: 'PUT',
      body: JSON.stringify(flattenLinesForGC(withInstallmentPrecisionFallback(fixedPayload))),
    });
  }
}

function shouldFallbackToFullStatusPayload(error: unknown): boolean {
  // O PUT mínimo do GC ainda valida o financeiro existente. Quando ele reclama
  // de parcelas, reenviamos o documento completo normalizado em centavos,
  // usando `valor_total` das linhas como fonte — sem recalcular por quantidade
  // com 3 casas decimais.
  if (isInstallmentMismatchError(error)) return true;

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    message.includes('obrigat') ||
    message.includes('required') ||
    message.includes('necess') ||
    message.includes('inválid') ||
    message.includes('invalid') ||
    message.includes('não informado') ||
    message.includes('nao informado')
  );
}

async function putStatusOnlyWithFallback(
  path: string,
  minimalPayload: Record<string, any>,
  fullPayload: Record<string, any>
): Promise<GCUpdateResponse> {
  try {
    return await apiRequest<GCUpdateResponse>(path, {
      method: 'PUT',
      body: JSON.stringify(flattenLinesForGC(withInstallmentPrecisionFallback(minimalPayload))),
    });
  } catch (error) {
    if (!shouldFallbackToFullStatusPayload(error)) throw error;

    console.warn('[GC] PUT mínimo de status recusado. Reenviando payload completo preservado.');
    return putStatusWithRetry(path, fullPayload);
  }
}

export async function updateOSStatus(id: string, rawOrder: GCOrdemServico, newStatusId: string, operatorName?: string, gcUsuarioId?: string, customNote?: string): Promise<void> {
  if (isUsingMock()) {
    await mockDelay();
    return;
  }

  const latestOrder = await fetchLatestForStatusUpdate<GCOrdemServico & Record<string, any>>(
    `/api/ordens_servicos/${id}`,
    rawOrder as GCOrdemServico & Record<string, any>
  );

  const obsInterna = latestOrder.observacoes_interna || rawOrder.observacoes_interna || '';
  const separator = obsInterna.trim() ? '\n' : '';
  const now = new Date().toLocaleString('pt-BR');
  const operatorNote = customNote
    ? `${separator}[WeDo Checkout] ${customNote} em ${now}`
    : operatorName
    ? `${separator}[WeDo Checkout] Separação realizada por: ${operatorName} em ${now}`
    : '';

  const obs = latestOrder.observacoes || rawOrder.observacoes || '';
  const obsSeparator = obs.trim() ? '\n' : '';
  const obsNote = customNote
    ? `${obsSeparator}[WeDo Checkout] ${customNote} em ${now}`
    : operatorName
    ? `${obsSeparator}[WeDo Checkout] Separação por: ${operatorName} em ${now}`
    : '';

  const payload: Record<string, any> = {
    cliente_id: latestOrder.cliente_id ?? rawOrder.cliente_id,
    codigo: latestOrder.codigo ?? rawOrder.codigo,
    data: latestOrder.data_entrada || latestOrder.data || rawOrder.data_entrada || rawOrder.data,
    situacao_id: newStatusId,
    vendedor_id: latestOrder.vendedor_id ?? rawOrder.vendedor_id,
    observacoes: obs + obsNote,
    observacoes_interna: obsInterna + operatorNote,
    valor_total: latestOrder.valor_total ?? rawOrder.valor_total,
    valor_frete: latestOrder.valor_frete || rawOrder.valor_frete || '0.00',
    condicao_pagamento: latestOrder.condicao_pagamento || rawOrder.condicao_pagamento || 'a_vista',
    produtos: latestOrder.produtos || rawOrder.produtos,
    servicos: latestOrder.servicos || rawOrder.servicos || [],
    atributos: latestOrder.atributos || rawOrder.atributos || [],
    equipamentos: latestOrder.equipamentos || rawOrder.equipamentos || [],
  };

  // Preserve pagamentos + desconto to avoid total vs parcelas mismatch
  if (latestOrder.pagamentos?.length) payload.pagamentos = latestOrder.pagamentos;
  else if (rawOrder.pagamentos?.length) payload.pagamentos = rawOrder.pagamentos;
  if (latestOrder.desconto_valor != null) payload.desconto_valor = latestOrder.desconto_valor;
  if (latestOrder.desconto_porcentagem != null) payload.desconto_porcentagem = latestOrder.desconto_porcentagem;

  // Sempre atribui ao usuário API GC (guilherme.pedrosa@outlook.com), não ao humano logado
  payload.usuario_id = '1320473';

  const minimalPayload: Record<string, any> = {
    // GC reseta o cliente para "Consumidor" quando o PUT não informa cliente_id.
    cliente_id: latestOrder.cliente_id ?? rawOrder.cliente_id,
    situacao_id: newStatusId,
    observacoes: obs + obsNote,
    observacoes_interna: obsInterna + operatorNote,
    // GC zera o valor do pedido (0,00) quando o PUT não reenvia as linhas/valores.
    valor_total: payload.valor_total,
    valor_frete: payload.valor_frete,
    condicao_pagamento: payload.condicao_pagamento,
    produtos: payload.produtos,
    servicos: payload.servicos,
  };
  if (payload.pagamentos) minimalPayload.pagamentos = payload.pagamentos;
  if (payload.desconto_valor != null) minimalPayload.desconto_valor = payload.desconto_valor;
  if (payload.desconto_porcentagem != null) minimalPayload.desconto_porcentagem = payload.desconto_porcentagem;
  minimalPayload.usuario_id = '1320473';

  const putResponse = await putStatusOnlyWithFallback(`/api/ordens_servicos/${id}`, minimalPayload, payload);

  const expectedStatus = normalizeStatusId(newStatusId);
  const returnedStatus = normalizeStatusId(putResponse?.data?.situacao_id ?? putResponse?.situacao_id);

  if (returnedStatus && returnedStatus !== expectedStatus) {
    throw new Error('STATUS_NOT_APPLIED');
  }

  const confirmed = await confirmStatusApplied('os', id, expectedStatus);
  if (!confirmed) {
    throw new Error('STATUS_NOT_APPLIED');
  }
}

export async function updateVendaStatus(id: string, rawOrder: GCVenda, newStatusId: string, operatorName?: string, gcUsuarioId?: string, customNote?: string): Promise<void> {
  if (isUsingMock()) {
    await mockDelay();
    return;
  }

  const latestOrder = await fetchLatestForStatusUpdate<GCVenda & Record<string, any>>(
    `/api/vendas/${id}`,
    rawOrder as GCVenda & Record<string, any>
  );

  const obsInterna = latestOrder.observacoes_interna || (rawOrder as any).observacoes_interna || '';
  const separator = obsInterna.trim() ? '\n' : '';
  const now = new Date().toLocaleString('pt-BR');
  const operatorNote = customNote
    ? `${separator}[WeDo Checkout] ${customNote} em ${now}`
    : operatorName
    ? `${separator}[WeDo Checkout] Separação realizada por: ${operatorName} em ${now}`
    : '';

  const obs = latestOrder.observacoes || (rawOrder as any).observacoes || '';
  const obsSeparator = obs.trim() ? '\n' : '';
  const obsNote = customNote
    ? `${obsSeparator}[WeDo Checkout] ${customNote} em ${now}`
    : operatorName
    ? `${obsSeparator}[WeDo Checkout] Separação por: ${operatorName} em ${now}`
    : '';

  const payload: Record<string, any> = {
    tipo: latestOrder.tipo || (rawOrder as any).tipo || 'produto',
    cliente_id: latestOrder.cliente_id ?? rawOrder.cliente_id,
    codigo: latestOrder.codigo ?? rawOrder.codigo,
    data: latestOrder.data || rawOrder.data,
    situacao_id: newStatusId,
    vendedor_id: latestOrder.vendedor_id ?? rawOrder.vendedor_id,
    observacoes: obs + obsNote,
    observacoes_interna: obsInterna + operatorNote,
    valor_total: latestOrder.valor_total ?? rawOrder.valor_total,
    valor_frete: latestOrder.valor_frete || rawOrder.valor_frete || '0.00',
    condicao_pagamento: latestOrder.condicao_pagamento || rawOrder.condicao_pagamento || 'a_vista',
    produtos: latestOrder.produtos || rawOrder.produtos,
    servicos: latestOrder.servicos || rawOrder.servicos || [],
  };

  // Preserve pagamentos + desconto to avoid total vs parcelas mismatch
  if (latestOrder.pagamentos?.length) payload.pagamentos = latestOrder.pagamentos;
  else if (rawOrder.pagamentos?.length) payload.pagamentos = rawOrder.pagamentos;
  if (latestOrder.desconto_valor != null) payload.desconto_valor = latestOrder.desconto_valor;
  if (latestOrder.desconto_porcentagem != null) payload.desconto_porcentagem = latestOrder.desconto_porcentagem;

  // Sempre atribui ao usuário API GC (guilherme.pedrosa@outlook.com), não ao humano logado
  payload.usuario_id = '1320473';

  const minimalPayload: Record<string, any> = {
    tipo: payload.tipo,
    // GC reseta o cliente para "Consumidor" quando o PUT não informa cliente_id.
    cliente_id: latestOrder.cliente_id ?? rawOrder.cliente_id,
    situacao_id: newStatusId,
    observacoes: obs + obsNote,
    observacoes_interna: obsInterna + operatorNote,
    // GC zera o valor do pedido (0,00) quando o PUT não reenvia as linhas/valores.
    valor_total: payload.valor_total,
    valor_frete: payload.valor_frete,
    condicao_pagamento: payload.condicao_pagamento,
    produtos: payload.produtos,
    servicos: payload.servicos,
  };
  if (payload.pagamentos) minimalPayload.pagamentos = payload.pagamentos;
  if (payload.desconto_valor != null) minimalPayload.desconto_valor = payload.desconto_valor;
  if (payload.desconto_porcentagem != null) minimalPayload.desconto_porcentagem = payload.desconto_porcentagem;
  minimalPayload.usuario_id = '1320473';

  const putResponse = await putStatusOnlyWithFallback(`/api/vendas/${id}`, minimalPayload, payload);

  const expectedStatus = normalizeStatusId(newStatusId);
  const returnedStatus = normalizeStatusId(putResponse?.data?.situacao_id ?? putResponse?.situacao_id);

  if (returnedStatus && returnedStatus !== expectedStatus) {
    throw new Error('STATUS_NOT_APPLIED');
  }

  const confirmed = await confirmStatusApplied('venda', id, expectedStatus);
  if (!confirmed) {
    throw new Error('STATUS_NOT_APPLIED');
  }
}

// --- STOCK CHECK ---
export interface ProductStockInfo {
  produto_id: string;
  estoque: number;
  valor_custo: number;
}

export interface StockConflictPO {
  codigo: string;
  nome_fornecedor: string;
  qtd: number;
  situacao: string;
}

export interface StockConflict {
  nome_produto: string;
  produto_id: string;
  estoque: number;
  demanda_total: number;
  pedidos: Array<{ codigo: string; nome_cliente: string; qtd: number }>;
  pedidos_compra: StockConflictPO[];
}

export interface BelowCostWarning {
  produto_id: string;
  nome_produto: string;
  valor_custo: number;
  custo_com_imposto: number;
  valor_venda: number;
  pedidos: Array<{ codigo: string; nome_cliente: string; qtd: number }>;
}

export interface StockScanResult {
  fullStockOrders: Set<string>;
  conflicts: StockConflict[];
  belowCostWarnings: BelowCostWarning[];
}

export async function getProductStock(produtoId: string, variacaoId?: string): Promise<ProductStockInfo | null> {
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await apiRequest<{
        data: {
          id: string;
          estoque: string | number;
          valor_custo?: string | number;
          variacoes?: Array<{ variacao: { id: string | number; estoque: string | number } }>;
        };
      }>(`/api/produtos/${produtoId}`);

      const data = res?.data;
      if (!data) throw new Error('EMPTY_RESPONSE');

      // Prefer variation stock when variacao_id is given (or when product has a single variation
      // that holds the real stock instead of the parent — common GC quirk)
      let estoqueRaw: string | number = data.estoque ?? 0;
      const variacoes = data.variacoes ?? [];
      if (variacoes.length > 0) {
        const vid = variacaoId ? String(variacaoId) : '';
        const byId = vid ? variacoes.find(v => String(v.variacao?.id) === vid) : undefined;
        const single = !byId && variacoes.length === 1 ? variacoes[0] : undefined;
        const chosen = byId ?? single;
        if (chosen) estoqueRaw = chosen.variacao.estoque ?? estoqueRaw;
      }

      const estoque = typeof estoqueRaw === 'number' ? estoqueRaw : parseFloat(String(estoqueRaw).replace(',', '.') || '0');
      const valorCusto = typeof data.valor_custo === 'number'
        ? data.valor_custo
        : parseFloat(String(data.valor_custo ?? '0').replace(',', '.') || '0');
      return { produto_id: String(data.id ?? produtoId), estoque: isNaN(estoque) ? 0 : estoque, valor_custo: isNaN(valorCusto) ? 0 : valorCusto };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /Failed to send|NETWORK|TIMEOUT|RATE_LIMIT|fetch/i.test(msg);
      if (!retryable || attempt === MAX_ATTEMPTS - 1) break;
      await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  console.warn(`[STOCK] Failed to fetch stock for product ${produtoId}:`, lastErr instanceof Error ? lastErr.message : lastErr);
  return null;
}

/** Check stock for a list of orders. Returns Set of order IDs that have full stock + conflicts. */
export async function checkStockForOrders(
  orders: Array<GCOrdemServico | GCVenda>,
  onProgress?: (checked: number, total: number) => void,
): Promise<StockScanResult> {
  // Collect all unique produto_ids across all orders (track variacao_id seen for each pid)
  const productOrderMap = new Map<string, { orderId: string; orderCodigo: string; orderCliente: string; qty: number; nome: string }[]>();
  const variacaoIdByPid = new Map<string, string>();

  for (const order of orders) {
    for (const p of order.produtos || []) {
      const pid = p.produto.produto_id;
      const vid = String((p.produto as any).variacao_id ?? '').trim();
      if (vid && !variacaoIdByPid.has(pid)) variacaoIdByPid.set(pid, vid);
      const qty = typeof p.produto.quantidade === 'number' ? p.produto.quantidade : parseFloat(String(p.produto.quantidade)) || 0;
      if (!productOrderMap.has(pid)) productOrderMap.set(pid, []);
      productOrderMap.get(pid)!.push({
        orderId: order.id,
        orderCodigo: order.codigo,
        orderCliente: order.nome_cliente,
        qty,
        nome: p.produto.nome_produto,
      });
    }
  }

  const uniqueIds = [...productOrderMap.keys()];
  const stockMap = new Map<string, number>();
  const costMap = new Map<string, number>();
  const total = uniqueIds.length;
  let checked = 0;

  // Fetch 3 at a time (rate limit)
  for (let i = 0; i < uniqueIds.length; i += 3) {
    const batch = uniqueIds.slice(i, i + 3);
    const results = await Promise.all(batch.map(id => getProductStock(id, variacaoIdByPid.get(id))));
    batch.forEach((id, idx) => {
      const r = results[idx];
      if (r) {
        stockMap.set(id, r.estoque);
        costMap.set(id, r.valor_custo);
      }
    });
    checked += batch.length;
    onProgress?.(checked, total);
    if (i + 3 < uniqueIds.length) {
      await new Promise(r => setTimeout(r, 1100)); // respect rate limit
    }
  }

  // Determine which orders have full stock
  const fullStockOrders = new Set<string>();
  for (const order of orders) {
    const allInStock = (order.produtos || []).every(p => {
      const pid = p.produto.produto_id;
      const qty = typeof p.produto.quantidade === 'number' ? p.produto.quantidade : parseFloat(String(p.produto.quantidade)) || 0;
      const available = stockMap.get(pid) ?? 0;
      return available >= qty;
    });
    if (allInStock) fullStockOrders.add(order.id);
  }

  // Detect conflicts: products where total demand across orders > stock
  const conflicts: StockConflict[] = [];
  const conflictPids = new Set<string>();
  for (const [pid, entries] of productOrderMap) {
    const stock = stockMap.get(pid) ?? 0;
    const totalDemand = entries.reduce((s, e) => s + e.qty, 0);
    if (totalDemand > stock && entries.length > 1) {
      conflictPids.add(pid);
      conflicts.push({
        produto_id: pid,
        nome_produto: entries[0].nome,
        estoque: stock,
        demanda_total: totalDemand,
        pedidos: entries.map(e => ({ codigo: e.orderCodigo, nome_cliente: e.orderCliente, qtd: e.qty })),
        pedidos_compra: [],
      });
    }
  }

  // If there are conflicts, fetch purchase orders to check coverage
  if (conflicts.length > 0) {
    try {
      onProgress?.(checked, total); // signal we're checking POs
      const poMap = new Map<string, StockConflictPO[]>();
      let page = 1;
      while (true) {
        const res = await listOrdensCompra(undefined, page);
        for (const po of res.data) {
          for (const p of po.produtos || []) {
            const pid = p.produto.produto_id;
            if (conflictPids.has(pid)) {
              const qty = typeof p.produto.quantidade === 'number' ? p.produto.quantidade : parseFloat(String(p.produto.quantidade)) || 0;
              if (!poMap.has(pid)) poMap.set(pid, []);
              poMap.get(pid)!.push({
                codigo: po.codigo,
                nome_fornecedor: po.nome_fornecedor,
                qtd: qty,
                situacao: po.nome_situacao,
              });
            }
          }
        }
        if (page >= res.meta.total_paginas) break;
        page++;
      }
      // Attach PO data to conflicts
      for (const c of conflicts) {
        c.pedidos_compra = poMap.get(c.produto_id) || [];
      }
    } catch (e) {
      console.warn('[STOCK SCAN] Failed to fetch purchase orders for conflicts:', e);
    }
  }

  // Detect below-cost warnings: items where valor_venda < valor_custo + 16% tax
  // Exclude consignment clients (e.g. Ecolab) — their pricing follows different rules
  const CONSIGNMENT_CLIENT_PATTERNS = ['ecolab'];
  const TAX_RATE = 0.16;
  const belowCostWarnings: BelowCostWarning[] = [];
  const belowCostMap = new Map<string, BelowCostWarning>();

  for (const order of orders) {
    // Skip consignment clients
    const clientLower = order.nome_cliente.toLowerCase();
    if (CONSIGNMENT_CLIENT_PATTERNS.some(p => clientLower.includes(p))) continue;

    for (const p of order.produtos || []) {
      const pid = p.produto.produto_id;
      const custo = costMap.get(pid) ?? 0;
      if (custo <= 0) continue;

      const valorVendaRaw = String(p.produto.valor_venda ?? '');
      let valorVenda = 0;
      if (valorVendaRaw.includes(',') && valorVendaRaw.includes('.')) {
        valorVenda = parseFloat(valorVendaRaw.replace(/\./g, '').replace(',', '.')) || 0;
      } else if (valorVendaRaw.includes(',')) {
        valorVenda = parseFloat(valorVendaRaw.replace(',', '.')) || 0;
      } else {
        valorVenda = parseFloat(valorVendaRaw) || 0;
      }

      const custoComImposto = custo * (1 + TAX_RATE);
      const qty = typeof p.produto.quantidade === 'number' ? p.produto.quantidade : parseFloat(String(p.produto.quantidade)) || 0;

      if (valorVenda > 0 && valorVenda < custoComImposto) {
        const existing = belowCostMap.get(pid);
        if (existing) {
          if (!existing.pedidos.some(pe => pe.codigo === order.codigo)) {
            existing.pedidos.push({ codigo: order.codigo, nome_cliente: order.nome_cliente, qtd: qty });
          }
        } else {
          const warning: BelowCostWarning = {
            produto_id: pid,
            nome_produto: p.produto.nome_produto,
            valor_custo: custo,
            custo_com_imposto: custoComImposto,
            valor_venda: valorVenda,
            pedidos: [{ codigo: order.codigo, nome_cliente: order.nome_cliente, qtd: qty }],
          };
          belowCostMap.set(pid, warning);
          belowCostWarnings.push(warning);
        }
      }
    }
  }

  return { fullStockOrders, conflicts, belowCostWarnings };
}

// --- PRODUCT DETAILS (for barcode enrichment) ---
interface GCProductExtraField {
  id: string;
  atributo_id: string;
  descricao: string;
  conteudo: string;
  tipo?: string;
}

interface GCProductDetail {
  id: string;
  codigo_barra: string;
  codigo_interno: string;
  nome: string;
  variacoes?: Array<{ variacao: { id: string; codigo: string } }>;
  campos_extras?: GCProductExtraField[];
  atributos?: Array<{ atributo: GCProductExtraField }>;
}

async function getProductDetail(produtoId: string): Promise<GCProductDetail | null> {
  try {
    const res = await apiRequest<{ data: GCProductDetail }>(`/api/produtos/${produtoId}`);
    return res.data;
  } catch {
    return null;
  }
}

export async function enrichOrderProducts(
  produtos: Array<{ produto: GCProdutoItem }>
): Promise<Array<{ produto: GCProdutoItem }>> {
  if (isUsingMock() || !produtos?.length) return produtos;

  // Deduplicate produto_ids
  const uniqueIds = [...new Set(produtos.map(p => p.produto.produto_id))];
  
  // Fetch product details in batches of 3 (respect API rate limit of 3 req/s)
  const detailMap = new Map<string, GCProductDetail>();
  for (let i = 0; i < uniqueIds.length; i += 3) {
    const batch = uniqueIds.slice(i, i + 3);
    const results = await Promise.all(batch.map(id => getProductDetail(id)));
    results.forEach(d => { if (d) detailMap.set(d.id, d); });
    if (i + 3 < uniqueIds.length) {
      await new Promise(r => setTimeout(r, 1100)); // respect rate limit
    }
  }

  return produtos.map(({ produto }) => {
    const detail = detailMap.get(produto.produto_id);
    if (!detail) return { produto };

    // Find variation code if applicable
    let codigoBarras = detail.codigo_barra || '';
    const codigoProduto = detail.codigo_interno || '';

    if (produto.variacao_id && detail.variacoes) {
      const variacao = detail.variacoes.find(v => v.variacao.id === produto.variacao_id);
      if (variacao?.variacao.codigo) {
        if (!codigoBarras) codigoBarras = '';
      }
    }

    // Extract location fields from atributos (API returns atributos with nested atributo objects)
    let localizacao_fisica = '';
    let localizacao_rational = '';
    
    // Try atributos first (actual API format)
    if (detail.atributos && Array.isArray(detail.atributos)) {
      for (const item of detail.atributos) {
        const campo: GCProductExtraField = 'atributo' in item ? item.atributo : item as any;
        const desc = (campo.descricao || '').toLowerCase().trim();
        if (desc.includes('localização física') || desc.includes('localizacao fisica')) {
          localizacao_fisica = campo.conteudo || '';
        } else if (desc.includes('localização rational') || desc.includes('localizacao rational')) {
          localizacao_rational = campo.conteudo || '';
        }
      }
    }
    // Fallback to campos_extras if present
    if (!localizacao_fisica && !localizacao_rational && detail.campos_extras && Array.isArray(detail.campos_extras)) {
      for (const campo of detail.campos_extras) {
        const desc = (campo.descricao || '').toLowerCase().trim();
        if (desc.includes('localização física') || desc.includes('localizacao fisica')) {
          localizacao_fisica = campo.conteudo || '';
        } else if (desc.includes('localização rational') || desc.includes('localizacao rational')) {
          localizacao_rational = campo.conteudo || '';
        }
      }
    }

    return {
      produto: {
        ...produto,
        codigo_produto: codigoProduto,
        codigo_barras: codigoBarras,
        localizacao_fisica: localizacao_fisica || undefined,
        localizacao_rational: localizacao_rational || undefined,
      },
    };
  });
}
