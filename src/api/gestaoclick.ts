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
        const msg = error.message || 'Erro de conexÃ£o com o servidor';
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
        throw new Error(gcMsg || `Erro ${statusCode} no GestÃ£oClick`);
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
      throw err instanceof Error ? err : new Error('Erro de conexÃ£o com o servidor');
    }
  }

  throw new Error('Erro de conexÃ£o com o servidor');
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

  // MantÃ©m a fila com os cÃ³digos mais novos no topo (ex.: OS 9090)
  params.set('ordenacao', 'codigo');
  params.set('direcao', 'desc');

  if (term) {
    if (/^\d+$/.test(term)) {
      params.set('codigo', term);
      params.set('limite', '100');
    }
    // Text search (client name) is handled client-side â€” GC 'nome' param
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

  // GestÃ£oClick validates PUTs using the gross unit price (before line discounts).
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
 * Only fixes the specific double-discount bug where GestÃ£oClick GET returns
 * `valor_venda = 0` (or near zero) on a line that has a `desconto_valor > 0`.
 * In that case, sending the payload back as-is causes the ERP to subtract the
 * discount a second time.
 *
 * In all other cases â€” including normal lines with discounts â€” we leave
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

    // Fix small rounding drift from fractional quantities without changiçÎw¶‰ËkºwµçAé•É„¼Ù…±½È‘¼Á•‘¥‘¼€ À°ÀÀ¤ÅÕ…¹‘¼¼AUP»¼É••¹Ù¥„…Ì±¥¹¡…Ì½Ù…±½É•Ì¸4(€€€Ù…±½É}Ñ½Ñ…°èÁ…å±½…¹Ù…±½É}Ñ½Ñ…°°4(€€€Ù…±½É}™É•Ñ”èÁ…å±½…¹Ù…±½É}™É•Ñ”°4(€€€½¹‘¥…½}Á……µ•¹Ñ¼èÁ…å±½…¹½¹‘¥…½}Á……µ•¹Ñ¼°4(€€€ÁÉ½‘ÕÑ½ÌèÁ…å±½…¹ÁÉ½‘ÕÑ½Ì°4(€€€Í•ÉÙ¥½ÌèÁ…å±½…¹Í•ÉÙ¥½Ì°4(€ôì4(€¥˜€¡Á…å±½…¹Á……µ•¹Ñ½Ì¤µ¥¹¥µ…±A…å±½…¹Á……µ•¹Ñ½Ì€ôÁ…å±½…¹Á……µ•¹Ñ½Ìì4(€¥˜€¡Á…å±½…¹‘•Í½¹Ñ½}Ù…±½È€„ô¹Õ±°¤µ¥¹¥µ…±A…å±½…¹‘•Í½¹Ñ½}Ù…±½È€ôÁ…å±½…¹‘•Í½¹Ñ½}Ù…±½Èì4(€¥˜€¡Á…å±½…¹‘•Í½¹Ñ½}Á½É•¹Ñ…•´€„ô¹Õ±°¤µ¥¹¥µ…±A…å±½…¹‘•Í½¹Ñ½}Á½É•¹Ñ…•´€ôÁ…å±½…¹‘•Í½¹Ñ½}Á½É•¹Ñ…•´ì4(€¥˜€¡UÍÕ…É¥½%¤µ¥¹¥µ…±A…å±½…¹ÕÍÕ…É¥½}¥€ôUÍÕ…É¥½%ì4(4(€½¹ÍĞÁÕÑI•ÍÁ½¹Í”€ô…İ…¥ĞÁÕÑMÑ…ÑÕÍ=¹±å]¥Ñ¡…±±‰…¬¡€½…Á¤½Ù•¹‘…Ì¼‘í¥‘õ€°µ¥¹¥µ…±A…å±½…°Á…å±½…¤ì4(4(€½¹ÍĞ•áÁ•Ñ•‘MÑ…ÑÕÌ€ô¹½Éµ…±¥é•MÑ…ÑÕÍ%¡¹•İMÑ…ÑÕÍ%¤ì4(€½¹ÍĞÉ•ÑÕÉ¹•‘MÑ…ÑÕÌ€ô¹½Éµ…±¥é•MÑ…ÑÕÍ%¡ÁÕÑI•ÍÁ½¹Í”ü¹‘…Ñ„ü¹Í¥ÑÕ……½}¥€üüÁÕÑI•ÍÁ½¹Í”ü¹Í¥ÑÕ……½}¥¤ì4(4(€¥˜€¡É•ÑÕÉ¹•‘MÑ…ÑÕÌ€˜˜É•ÑÕÉ¹•‘MÑ…ÑÕÌ€„ôô•áÁ•Ñ•‘MÑ…ÑÕÌ¤ì4(€€€Ñ¡É½Ü¹•ÜÉÉ½È MQQUM}9=Q}AA1%œ¤ì4(€ô4(4(€½¹ÍĞ½¹™¥Éµ•€ô…İ…¥Ğ½¹™¥ÉµMÑ…ÑÕÍÁÁ±¥• Ù•¹‘„œ°¥°•áÁ•Ñ•‘MÑ…ÑÕÌ¤ì4(€¥˜€ …½¹™¥Éµ•¤ì4(€€€Ñ¡É½Ü¹•ÜÉÉ½È MQQUM}9=Q}AA1%œ¤ì4(€ô4)ô4(4(¼¼€´´´MQ=,!,€´´´4)•áÁ½ÉĞ¥¹Ñ•É™…”AÉ½‘ÕÑMÑ½­%¹™¼ì4(€ÁÉ½‘ÕÑ½}¥èÍÑÉ¥¹œì4(€•ÍÑ½ÅÕ”è¹Õµ‰•Èì4(€Ù…±½É}ÕÍÑ¼è¹Õµ‰•Èì4)ô4(4)•áÁ½ÉĞ¥¹Ñ•É™…”MÑ½­½¹™±¥ÑA<ì4(€½‘¥¼èÍÑÉ¥¹œì4(€¹½µ•}™½É¹••‘½ÈèÍÑÉ¥¹œì4(€ÅÑè¹Õµ‰•Èì4(€Í¥ÑÕ……¼èÍÑÉ¥¹œì4)ô4(4)•áÁ½ÉĞ¥¹Ñ•É™…”MÑ½­½¹™±¥Ğì4(€¹½µ•}ÁÉ½‘ÕÑ¼èÍÑÉ¥¹œì4(€ÁÉ½‘ÕÑ½}¥èÍÑÉ¥¹œì4(€•ÍÑ½ÅÕ”è¹Õµ‰•Èì4(€‘•µ…¹‘…}Ñ½Ñ…°è¹Õµ‰•Èì4(€Á•‘¥‘½ÌèÉÉ…äñì½‘¥¼èÍÑÉ¥¹œì¹½µ•}±¥•¹Ñ”èÍÑÉ¥¹œìÅÑè¹Õµ‰•Èôøì4(€Á•‘¥‘½Í}½µÁÉ„èMÑ½­½¹™±¥ÑA=mtì4)ô4(4)•áÁ½ÉĞ¥¹Ñ•É™…”	•±½İ½ÍÑ]…É¹¥¹œì4(€ÁÉ½‘ÕÑ½}¥èÍÑÉ¥¹œì4(€¹½µ•}ÁÉ½‘ÕÑ¼èÍÑÉ¥¹œì4(€Ù…±½É}ÕÍÑ¼è¹Õµ‰•Èì4(€ÕÍÑ½}½µ}¥µÁ½ÍÑ¼è¹Õµ‰•Èì4(€Ù…±½É}Ù•¹‘„è¹Õµ‰•Èì4(€Á•‘¥‘½ÌèÉÉ…äñì½‘¥¼èÍÑÉ¥¹œì¹½µ•}±¥•¹Ñ”èÍÑÉ¥¹œìÅÑè¹Õµ‰•Èôøì4)ô4(4)•áÁ½ÉĞ¥¹Ñ•É™…”MÑ½­M…¹I•ÍÕ±Ğì4(€™Õ±±MÑ½­=É‘•ÉÌèM•ĞñÍÑÉ¥¹œøì4(€½¹™±¥ÑÌèMÑ½­½¹™±¥Ñmtì4(€‰•±½İ½ÍÑ]…É¹¥¹Ìè	•±½İ½ÍÑ]…É¹¥¹mtì4)ô4(4)•áÁ½ÉĞ…Íå¹Œ™Õ¹Ñ¥½¸•ÑAÉ½‘ÕÑMÑ½¬¡ÁÉ½‘ÕÑ½%èÍÑÉ¥¹œ°Ù…É¥……½%üèÍÑÉ¥¹œ¤èAÉ½µ¥Í”ñAÉ½‘ÕÑMÑ½­%¹™¼ğ¹Õ±°øì4(€½¹ÍĞ5a}QQ5AQL€ô€Ìì4(€±•Ğ±…ÍÑÉÈèÕ¹­¹½İ¸€ô¹Õ±°ì4(€™½È€¡±•Ğ…ÑÑ•µÁĞ€ô€Àì…ÑÑ•µÁĞ€ğ5a}QQ5AQLì…ÑÑ•µÁĞ¬¬¤ì4(€€€ÑÉäì4(€€€€€½¹ÍĞÉ•Ì€ô…İ…¥Ğ…Á¥I•ÅÕ•ÍĞñì4(€€€€€€€‘…Ñ„èì4(€€€€€€€€€¥èÍÑÉ¥¹œì4(€€€€€€€€€•ÍÑ½ÅÕ”èÍÑÉ¥¹œğ¹Õµ‰•Èì4(€€€€€€€€€Ù…±½É}ÕÍÑ¼üèÍÑÉ¥¹œğ¹Õµ‰•Èì4(€€€€€€€€€Ù…É¥…½•ÌüèÉÉ…äñìÙ…É¥……¼èì¥èÍÑÉ¥¹œğ¹Õµ‰•Èì•ÍÑ½ÅÕ”èÍÑÉ¥¹œğ¹Õµ‰•Èôôøì4(€€€€€€€ôì4(€€€€€ôø¡€½…Á¤½ÁÉ½‘ÕÑ½Ì¼‘íÁÉ½‘ÕÑ½%‘õ€¤ì4(4(€€€€€½¹ÍĞ‘…Ñ„€ôÉ•Ìü¹‘…Ñ„ì4(€€€€€¥˜€ …‘…Ñ„¤Ñ¡É½Ü¹•ÜÉÉ½È 5AQe}IMA=9Mœ¤ì4(4(€€€€€€¼¼AÉ•™•ÈÙ…É¥…Ñ¥½¸ÍÑ½¬İ¡•¸Ù…É¥……½}¥¥Ì¥Ù•¸€¡½Èİ¡•¸ÁÉ½‘ÕĞ¡…Ì„Í¥¹±”Ù…É¥…Ñ¥½¸4(€€€€€€¼¼Ñ¡…Ğ¡½±‘ÌÑ¡”É•…°ÍÑ½¬¥¹ÍÑ•…½˜Ñ¡”Á…É•¹ĞƒŠP½µµ½¸ÅÕ¥É¬¤4(€€€€€±•Ğ•ÍÑ½ÅÕ•I…ÜèÍÑÉ¥¹œğ¹Õµ‰•È€ô‘…Ñ„¹•ÍÑ½ÅÕ”€üü€Àì4(€€€€€½¹ÍĞÙ…É¥…½•Ì€ô‘…Ñ„¹Ù…É¥…½•Ì€üümtì4(€€€€€¥˜€¡Ù…É¥…½•Ì¹±•¹Ñ €ø€À¤ì4(€€€€€€€½¹ÍĞÙ¥€ôÙ…É¥……½%€üMÑÉ¥¹œ¡Ù…É¥……½%¤€è€œœì4(€€€€€€€½¹ÍĞ‰å%€ôÙ¥€üÙ…É¥…½•Ì¹™¥¹¡Ø€ôøMÑÉ¥¹œ¡Ø¹Ù…É¥……¼ü¹¥¤€ôôôÙ¥¤€èÕ¹‘•™¥¹•ì4(€€€€€€€½¹ÍĞÍ¥¹±”€ô€…‰å%€˜˜Ù…É¥…½•Ì¹±•¹Ñ €ôôô€Ä€üÙ…É¥…½•ÍlÁt€èÕ¹‘•™¥¹•ì4(€€€€€€€½¹ÍĞ¡½Í•¸€ô‰å%€üüÍ¥¹±”ì4(€€€€€€€¥˜€¡¡½Í•¸¤•ÍÑ½ÅÕ•I…Ü€ô¡½Í•¸¹Ù…É¥……¼¹•ÍÑ½ÅÕ”€üü•ÍÑ½ÅÕ•I…Üì4(€€€€€ô4(4(€€€€€½¹ÍĞ•ÍÑ½ÅÕ”€ôÑåÁ•½˜•ÍÑ½ÅÕ•I…Ü€ôôô€¹Õµ‰•Èœ€ü•ÍÑ½ÅÕ•I…Ü€èÁ…ÉÍ•±½…Ğ¡MÑÉ¥¹œ¡•ÍÑ½ÅÕ•I…Ü¤¹É•Á±…” œ°œ°€œ¸œ¤ñğ€œÀœ¤ì4(€€€€€½¹ÍĞÙ…±½ÉÕÍÑ¼€ôÑåÁ•½˜‘…Ñ„¹Ù…±½É}ÕÍÑ¼€ôôô€¹Õµ‰•Èœ4(€€€€€€€€ü‘…Ñ„¹Ù…±½É}ÕÍÑ¼4(€€€€€€€€èÁ…ÉÍ•±½…Ğ¡MÑÉ¥¹œ¡‘…Ñ„¹Ù…±½É}ÕÍÑ¼€üü€œÀœ¤¹É•Á±…” œ°œ°€œ¸œ¤ñğ€œÀœ¤ì4(€€€€€É•ÑÕÉ¸ìÁÉ½‘ÕÑ½}¥èMÑÉ¥¹œ¡‘…Ñ„¹¥€üüÁÉ½‘ÕÑ½%¤°•ÍÑ½ÅÕ”è¥Í9…8¡•ÍÑ½ÅÕ”¤€ü€À€è•ÍÑ½ÅÕ”°Ù…±½É}ÕÍÑ¼è¥Í9…8¡Ù…±½ÉÕÍÑ¼¤€ü€À€èÙ…±½ÉÕÍÑ¼ôì4(€€€ô…Ñ €¡•ÉÈ¤ì4(€€€€€±…ÍÑÉÈ€ô•ÉÈì4(€€€€€½¹ÍĞµÍœ€ô•ÉÈ¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÈ¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÈ¤ì4(€€€€€½¹ÍĞÉ•ÑÉå…‰±”€ô€½…¥±•Ñ¼Í•¹‘ñ9Q]=I-ñQ%5=UQñIQ}1%5%Qñ™•Ñ ½¤¹Ñ•ÍĞ¡µÍœ¤ì4(€€€€€¥˜€ …É•ÑÉå…‰±”ñğ…ÑÑ•µÁĞ€ôôô5a}QQ5AQL€´€Ä¤‰É•…¬ì4(€€€€€…İ…¥Ğ¹•ÜAÉ½µ¥Í”¡È€ôøÍ•ÑQ¥µ•½ÕĞ¡È°€ÜÀÀ€¨€¡…ÑÑ•µÁĞ€¬€Ä¤¤¤ì4(€€€ô4(€ô4(€½¹Í½±”¹İ…É¸¡mMQ=-t…¥±•Ñ¼™•Ñ ÍÑ½¬™½ÈÁÉ½‘ÕĞ€‘íÁÉ½‘ÕÑ½%‘ôé€°±…ÍÑÉÈ¥¹ÍÑ…¹•½˜ÉÉ½È€ü±…ÍÑÉÈ¹µ•ÍÍ…”€è±…ÍÑÉÈ¤ì4(€É•ÑÕÉ¸¹Õ±°ì4)ô4(4(¼¨¨¡•¬ÍÑ½¬™½È„±¥ÍĞ½˜½É‘•ÉÌ¸I•ÑÕÉ¹ÌM•Ğ½˜½É‘•È%ÌÑ¡…Ğ¡…Ù”™Õ±°ÍÑ½¬€¬½¹™±¥ÑÌ¸€¨¼4)•áÁ½ÉĞ…Íå¹Œ™Õ¹Ñ¥½¸¡•­MÑ½­½É=É‘•ÉÌ 4(€½É‘•ÉÌèÉÉ…äñ=É‘•µM•ÉÙ¥¼ğY•¹‘„ø°4(€½¹AÉ½É•ÍÌüè€¡¡•­•è¹Õµ‰•È°Ñ½Ñ…°è¹Õµ‰•È¤€ôøÙ½¥°4(¤èAÉ½µ¥Í”ñMÑ½­M…¹I•ÍÕ±Ğøì4(€€¼¼½±±•Ğ…±°Õ¹¥ÅÕ”ÁÉ½‘ÕÑ½}¥‘Ì…É½ÍÌ…±°½É‘•ÉÌ€¡ÑÉ…¬Ù…É¥……½}¥Í••¸™½È•… Á¥¤4(€½¹ÍĞÁÉ½‘ÕÑ=É‘•É5…À€ô¹•Ü5…ÀñÍÑÉ¥¹œ°ì½É‘•É%èÍÑÉ¥¹œì½É‘•É½‘¥¼èÍÑÉ¥¹œì½É‘•É±¥•¹Ñ”èÍÑÉ¥¹œìÅÑäè¹Õµ‰•Èì¹½µ”èÍÑÉ¥¹œõmtø ¤ì4(€½¹ÍĞÙ…É¥……½%‘	åA¥€ô¹•Ü5…ÀñÍÑÉ¥¹œ°ÍÑÉ¥¹œø ¤ì4(4(€™½È€¡½¹ÍĞ½É‘•È½˜½É‘•ÉÌ¤ì4(€€€™½È€¡½¹ÍĞÀ½˜½É‘•È¹ÁÉ½‘ÕÑ½Ìñğmt¤ì4(€€€€€½¹ÍĞÁ¥€ôÀ¹ÁÉ½‘ÕÑ¼¹ÁÉ½‘ÕÑ½}¥ì4(€€€€€½¹ÍĞÙ¥€ôMÑÉ¥¹œ ¡À¹ÁÉ½‘ÕÑ¼…Ì…¹ä¤¹Ù…É¥……½}¥€üü€œœ¤¹ÑÉ¥´ ¤ì4(€€€€€¥˜€¡Ù¥€˜˜€…Ù…É¥……½%‘	åA¥¹¡…Ì¡Á¥¤¤Ù…É¥……½%‘	åA¥¹Í•Ğ¡Á¥°Ù¥¤ì4(€€€€€½¹ÍĞÅÑä€ôÑåÁ•½˜À¹ÁÉ½‘ÕÑ¼¹ÅÕ…¹Ñ¥‘…‘”€ôôô€¹Õµ‰•Èœ€üÀ¹ÁÉ½‘ÕÑ¼¹ÅÕ…¹Ñ¥‘…‘”€èÁ…ÉÍ•±½…Ğ¡MÑÉ¥¹œ¡À¹ÁÉ½‘ÕÑ¼¹ÅÕ…¹Ñ¥‘…‘”¤¤ñğ€Àì4(€€€€€¥˜€ …ÁÉ½‘ÕÑ=É‘•É5…À¹¡…Ì¡Á¥¤¤ÁÉ½‘ÕÑ=É‘•É5…À¹Í•Ğ¡Á¥°mt¤ì4(€€€€€ÁÉ½‘ÕÑ=É‘•É5…À¹•Ğ¡Á¥¤„¹ÁÕÍ ¡ì4(€€€€€€€½É‘•É%è½É‘•È¹¥°4(€€€€€€€½É‘•É½‘¥¼è½É‘•È¹½‘¥¼°4(€€€€€€€½É‘•É±¥•¹Ñ”è½É‘•È¹¹½µ•}±¥•¹Ñ”°4(€€€€€€€ÅÑä°4(€€€€€€€¹½µ”èÀ¹ÁÉ½‘ÕÑ¼¹¹½µ•}ÁÉ½‘ÕÑ¼°4(€€€€€ô¤ì4(€€€ô4(€ô4(4(€½¹ÍĞÕ¹¥ÅÕ•%‘Ì€ôl¸¸¹ÁÉ½‘ÕÑ=É‘•É5…À¹­•åÌ ¥tì4(€½¹ÍĞÍÑ½­5…À€ô¹•Ü5…ÀñÍÑÉ¥¹œ°¹Õµ‰•Èø ¤ì4(€½¹ÍĞ½ÍÑ5…À€ô¹•Ü5…ÀñÍÑÉ¥¹œ°¹Õµ‰•Èø ¤ì4(€½¹ÍĞÑ½Ñ…°€ôÕ¹¥ÅÕ•%‘Ì¹±•¹Ñ ì4(€±•Ğ¡•­•€ô€Àì4(4(€€¼¼•Ñ €Ì…Ğ„Ñ¥µ”€¡É…Ñ”±¥µ¥Ğ¤4(€™½È€¡±•Ğ¤€ô€Àì¤€ğÕ¹¥ÅÕ•%‘Ì¹±•¹Ñ ì¤€¬ô€Ì¤ì4(€€€½¹ÍĞ‰…Ñ €ôÕ¹¥ÅÕ•%‘Ì¹Í±¥”¡¤°¤€¬€Ì¤ì4(€€€½¹ÍĞÉ•ÍÕ±ÑÌ€ô…İ…¥ĞAÉ½µ¥Í”¹…±°¡‰…Ñ ¹µ…À¡¥€ôø•ÑAÉ½‘ÕÑMÑ½¬¡¥°Ù…É¥……½%‘	åA¥¹•Ğ¡¥¤¤¤¤ì4(€€€‰…Ñ ¹™½É…  ¡¥°¥‘à¤€ôøì4(€€€€€½¹ÍĞÈ€ôÉ•ÍÕ±ÑÍm¥‘átì4(€€€€€¥˜€¡È¤ì4(€€€€€€€ÍÑ½­5…À¹Í•Ğ¡¥°È¹•ÍÑ½ÅÕ”¤ì4(€€€€€€€½ÍÑ5…À¹Í•Ğ¡¥°È¹Ù…±½É}ÕÍÑ¼¤ì4(€€€€€ô4(€€€ô¤ì4(€€€¡•­•€¬ô‰…Ñ ¹±•¹Ñ ì4(€€€½¹AÉ½É•ÍÌü¸¡¡•­•°Ñ½Ñ…°¤ì4(€€€¥˜€¡¤€¬€Ì€ğÕ¹¥ÅÕ•%‘Ì¹±•¹Ñ ¤ì4(€€€€€…İ…¥Ğ¹•ÜAÉ½µ¥Í”¡È€ôøÍ•ÑQ¥µ•½ÕĞ¡È°€ÄÄÀÀ¤¤ì€¼¼É•ÍÁ•ĞÉ…Ñ”±¥µ¥Ğ4(€€€ô4(€ô4(4(€€¼¼•Ñ•Éµ¥¹”İ¡¥ ½É‘•ÉÌ¡…Ù”™Õ±°ÍÑ½¬4(€½¹ÍĞ™Õ±±MÑ½­=É‘•ÉÌ€ô¹•ÜM•ĞñÍÑÉ¥¹œø ¤ì4(€™½È€¡½¹ÍĞ½É‘•È½˜½É‘•ÉÌ¤ì4(€€€½¹ÍĞ…±±%¹MÑ½¬€ô€¡½É‘•È¹ÁÉ½‘ÕÑ½Ìñğmt¤¹•Ù•Éä¡À€ôøì4(€€€€€½¹ÍĞÁ¥€ôÀ¹ÁÉ½‘ÕÑ¼¹ÁÉ½‘ÕÑ½}¥ì4(€€€€€½¹ÍĞÅÑä€ôÑåÁ•½˜À¹ÁÉ½‘ÕÑ¼¹ÅÕ…¹Ñ¥‘…‘”€ôôô€¹Õµ‰•Èœ€üÀ¹ÁÉ½‘ÕÑ¼¹ÅÕ…¹Ñ¥‘…‘”€èÁ…ÉÍ•±½…Ğ¡MÑÉ¥¹œ¡À¹ÁÉ½‘ÕÑ¼¹ÅÕ…¹Ñ¥‘…‘”¤¤ñğ€Àì4(€€€€€½¹ÍĞ…Ù…¥±…‰±”€ôÍÑ½­5…À¹•Ğ¡Á¥¤€üü€Àì4(€€€€€É•ÑÕÉ¸…Ù…¥±…‰±”€øôÅÑäì4(€€€ô¤ì4(€€€¥˜€¡…±±%¹MÑ½¬¤™Õ±±MÑ½­=É‘•ÉÌ¹…‘¡½É‘•È¹¥¤ì4(€ô4(4(€€¼¼•Ñ•Ğ½¹™±¥ÑÌèÁÉ½‘ÕÑÌİ¡•É”Ñ½Ñ…°‘•µ…¹…É½ÍÌ½É‘•ÉÌ€øÍÑ½¬4(€½¹ÍĞ½¹™±¥ÑÌèMÑ½­½¹™±¥Ñmt€ômtì4(€½¹ÍĞ½¹™±¥ÑA¥‘Ì€ô¹•ÜM•ĞñÍÑÉ¥¹œø ¤ì4(€™½È€¡½¹ÍĞmÁ¥°•¹ÑÉ¥•Ít½˜ÁÉ½‘ÕÑ=É‘•É5…À¤ì4(€€€½¹ÍĞÍÑ½¬€ôÍÑ½­5…À¹•Ğ¡Á¥¤€üü€Àì4(€€€½¹ÍĞÑ½Ñ…±•µ…¹€ô•¹ÑÉ¥•Ì¹É•‘Õ” ¡Ì°”¤€ôøÌ€¬”¹ÅÑä°€À¤ì4(€€€¥˜€¡Ñ½Ñ…±•µ…¹€øÍÑ½¬€˜˜•¹ÑÉ¥•Ì¹±•¹Ñ €ø€Ä¤ì4(€€€€€½¹™±¥ÑA¥‘Ì¹…‘¡Á¥¤ì4(€€€€€½¹™±¥ÑÌ¹ÁÕÍ ¡ì4(€€€€€€€ÁÉ½‘ÕÑ½}¥èÁ¥°4(€€€€€€€¹½µ•}ÁÉ½‘ÕÑ¼è•¹ÑÉ¥•ÍlÁt¹¹½µ”°4(€€€€€€€•ÍÑ½ÅÕ”èÍÑ½¬°4(€€€€€€€‘•µ…¹‘…}Ñ½Ñ…°èÑ½Ñ…±•µ…¹°4(€€€€€€€Á•‘¥‘½Ìè•¹ÑÉ¥•Ì¹µ…À¡”€ôø€¡ì½‘¥¼è”¹½É‘•É½‘¥¼°¹½µ•}±¥•¹Ñ”è”¹½É‘•É±¥•¹Ñ”°ÅÑè”¹ÅÑäô¤¤°4(€€€€€€€Á•‘¥‘½Í}½µÁÉ„èmt°4(€€€€€ô¤ì4(€€€ô4(€ô4(4(€€¼¼%˜Ñ¡•É”…É”½¹™±¥ÑÌ°™•Ñ ÁÕÉ¡…Í”½É‘•ÉÌÑ¼¡•¬½Ù•É…”4(€¥˜€¡½¹™±¥ÑÌ¹±•¹Ñ €ø€À¤ì4(€€€ÑÉäì4(€€€€€½¹AÉ½É•ÍÌü¸¡¡•­•°Ñ½Ñ…°¤ì€¼¼Í¥¹…°İ”É”¡•­¥¹œA=Ì4(€€€€€½¹ÍĞÁ½5…À€ô¹•Ü5…ÀñÍÑÉ¥¹œ°MÑ½­½¹™±¥ÑA=mtø ¤ì4(€€€€€±•ĞÁ…”€ô€Äì4(€€€€€İ¡¥±”€¡ÑÉÕ”¤ì4(€€€€€€€½¹ÍĞÉ•Ì€ô…İ…¥Ğ±¥ÍÑ=É‘•¹Í½µÁÉ„¡Õ¹‘•™¥¹•°Á…”¤ì4(€€€€€€€™½È€¡½¹ÍĞÁ¼½˜É•Ì¹‘…Ñ„¤ì4(€€€€€€€€€™½È€¡½¹ÍĞÀ½˜Á¼¹ÁÉ½‘ÕÑ½Ìñğmt¤ì4(€€€€€€€€€€€½¹ÍĞÁ¥€ôÀ¹ÁÉ½‘ÕÑ¼¹ÁÉ½‘ÕÑ½}¥ì4(€€€€€€€€€€€¥˜€¡½¹™±¥ÑA¥‘Ì¹¡…Ì¡Á¥¤¤ì4(€€€€€€€€€€€€€½¹ÍĞÅÑä€ôÑåÁ•½˜À¹ÁÉ½‘ÕÑ¼¹ÅÕ…¹Ñ¥‘…‘”€ôôô€¹Õµ‰•Èœ€üÀ¹ÁÉ½‘ÕÑ¼¹ÅÕ…¹Ñ¥‘…‘”€èÁ…ÉÍ•±½…Ğ¡MÑÉ¥¹œ¡À¹ÁÉ½‘ÕÑ¼¹ÅÕ…¹Ñ¥‘…‘”¤¤ñğ€Àì4(€€€€€€€€€€€€€¥˜€ …Á½5…À¹¡…Ì¡Á¥¤¤Á½5…À¹Í•Ğ¡Á¥°mt¤ì4(€€€€€€€€€€€€€Á½5…À¹•Ğ¡Á¥¤„¹ÁÕÍ ¡ì4(€€€€€€€€€€€€€€€½‘¥¼èÁ¼¹½‘¥¼°4(€€€€€€€€€€€€€€€¹½µ•}™½É¹••‘½ÈèÁ¼¹¹½µ•}™½É¹••‘½È°4(€€€€€€€€€€€€€€€ÅÑèÅÑä°4(€€€€€€€€€€€€€€€Í¥ÑÕ……¼èÁ¼¹¹½µ•}Í¥ÑÕ……¼°4(€€€€€€€€€€€€€ô¤ì4(€€€€€€€€€€€ô4(€€€€€€€€€ô4(€€€€€€€ô4(€€€€€€€¥˜€¡Á…”€øôÉ•Ì¹µ•Ñ„¹Ñ½Ñ…±}Á…¥¹…Ì¤‰É•…¬ì4(€€€€€€€Á…”¬¬ì4(€€€€€ô4(€€€€€€¼¼ÑÑ… A<‘…Ñ„Ñ¼½¹™±¥ÑÌ4(€€€€€™½È€¡½¹ÍĞŒ½˜½¹™±¥ÑÌ¤ì4(€€€€€€€Œ¹Á•‘¥‘½Í}½µÁÉ„€ôÁ½5…À¹•Ğ¡Œ¹ÁÉ½‘ÕÑ½}¥¤ñğmtì4(€€€€€ô4(€€€ô…Ñ €¡”¤ì4(€€€€€½¹Í½±”¹İ…É¸ mMQ=,M9t…¥±•Ñ¼™•Ñ ÁÕÉ¡…Í”½É‘•ÉÌ™½È½¹™±¥ÑÌèœ°”¤ì4(€€€ô4(€ô4(4(€€¼¼•Ñ•Ğ‰•±½Üµ½ÍĞİ…É¹¥¹Ìè¥Ñ•µÌİ¡•É”Ù…±½É}Ù•¹‘„€ğÙ…±½É}ÕÍÑ¼€¬€ÄØ”Ñ…à4(€€¼¼á±Õ‘”½¹Í¥¹µ•¹Ğ±¥•¹ÑÌ€¡”¹œ¸½±…ˆ¤ƒŠPÑ¡•¥ÈÁÉ¥¥¹œ™½±±½İÌ‘¥™™•É•¹ĞÉÕ±•Ì4(€½¹ÍĞ=9M%959Q}1%9Q}AQQI9L€ôl•½±…ˆtì4(€½¹ÍĞQa}IQ€ô€À¸ÄØì4(€½¹ÍĞ‰•±½İ½ÍÑ]…É¹¥¹Ìè	•±½İ½ÍÑ]…É¹¥¹mt€ômtì4(€½¹ÍĞ‰•±½İ½ÍÑ5…À€ô¹•Ü5…ÀñÍÑÉ¥¹œ°	•±½İ½ÍÑ]…É¹¥¹œø ¤ì4(4(€™½È€¡½¹ÍĞ½É‘•È½˜½É‘•ÉÌ¤ì4(€€€€¼¼M­¥À½¹Í¥¹µ•¹Ğ±¥•¹ÑÌ4(€€€½¹ÍĞ±¥•¹Ñ1½İ•È€ô½É‘•È¹¹½µ•}±¥•¹Ñ”¹Ñ½1½İ•É…Í” ¤ì4(€€€¥˜€¡=9M%959Q}1%9Q}AQQI9L¹Í½µ”¡À€ôø±¥•¹Ñ1½İ•È¹¥¹±Õ‘•Ì¡À¤¤¤½¹Ñ¥¹Õ”ì4(4(€€€™½È€¡½¹ÍĞÀ½˜½É‘•È¹ÁÉ½‘ÕÑ½Ìñğmt¤ì4(€€€€€½¹ÍĞÁ¥€ôÀ¹ÁÉ½‘ÕÑ¼¹ÁÉ½‘ÕÑ½}¥ì4(€€€€€½¹ÍĞÕÍÑ¼€ô½ÍÑ5…À¹•Ğ¡Á¥¤€üü€Àì4(€€€€€¥˜€¡ÕÍÑ¼€ğô€À¤½¹Ñ¥¹Õ”ì4(4(€€€€€½¹ÍĞÙ…±½ÉY•¹‘…I…Ü€ôMÑÉ¥¹œ¡À¹ÁÉ½‘ÕÑ¼¹Ù…±½É}Ù•¹‘„€üü€œœ¤ì4(€€€€€±•ĞÙ…±½ÉY•¹‘„€ô€Àì4(€€€€€¥˜€¡Ù…±½ÉY•¹‘…I…Ü¹¥¹±Õ‘•Ì œ°œ¤€˜˜Ù…±½ÉY•¹‘…I…Ü¹¥¹±Õ‘•Ì œ¸œ¤¤ì4(€€€€€€€Ù…±½ÉY•¹‘„€ôÁ…ÉÍ•±½…Ğ¡Ù…±½ÉY•¹‘…I…Ü¹É•Á±…” ½p¸½œ°€œœ¤¹É•Á±…” œ°œ°€œ¸œ¤¤ñğ€Àì4(€€€€€ô•±Í”¥˜€¡Ù…±½ÉY•¹‘…I…Ü¹¥¹±Õ‘•Ì œ°œ¤¤ì4(€€€€€€€Ù…±½ÉY•¹‘„€ôÁ…ÉÍ•±½…Ğ¡Ù…±½ÉY•¹‘…I…Ü¹É•Á±…” œ°œ°€œ¸œ¤¤ñğ€Àì4(€€€€€ô•±Í”ì4(€€€€€€€Ù…±½ÉY•¹‘„€ôÁ…ÉÍ•±½…Ğ¡Ù…±½ÉY•¹‘…I…Ü¤ñğ€Àì4(€€€€€ô4(4(€€€€€½¹ÍĞÕÍÑ½½µ%µÁ½ÍÑ¼€ôÕÍÑ¼€¨€ Ä€¬Qa}IQ¤ì4(€€€€€½¹ÍĞÅÑä€ôÑåÁ•½˜À¹ÁÉ½‘ÕÑ¼¹ÅÕ…¹Ñ¥‘…‘”€ôôô€¹Õµ‰•Èœ€üÀ¹ÁÉ½‘ÕÑ¼¹ÅÕ…¹Ñ¥‘…‘”€èÁ…ÉÍ•±½…Ğ¡MÑÉ¥¹œ¡À¹ÁÉ½‘ÕÑ¼¹ÅÕ…¹Ñ¥‘…‘”¤¤ñğ€Àì4(4(€€€€€¥˜€¡Ù…±½ÉY•¹‘„€ø€À€˜˜Ù…±½ÉY•¹‘„€ğÕÍÑ½½µ%µÁ½ÍÑ¼¤ì4(€€€€€€€½¹ÍĞ•á¥ÍÑ¥¹œ€ô‰•±½İ½ÍÑ5…À¹•Ğ¡Á¥¤ì4(€€€€€€€¥˜€¡•á¥ÍÑ¥¹œ¤ì4(€€€€€€€€€¥˜€ …•á¥ÍÑ¥¹œ¹Á•‘¥‘½Ì¹Í½µ”¡Á”€ôøÁ”¹½‘¥¼€ôôô½É‘•È¹½‘¥¼¤¤ì4(€€€€€€€€€€€•á¥ÍÑ¥¹œ¹Á•‘¥‘½Ì¹ÁÕÍ ¡ì½‘¥¼è½É‘•È¹½‘¥¼°¹½µ•}±¥•¹Ñ”è½É‘•È¹¹½µ•}±¥•¹Ñ”°ÅÑèÅÑäô¤ì4(€€€€€€€€€ô4(€€€€€€€ô•±Í”ì4(€€€€€€€€€½¹ÍĞİ…É¹¥¹œè	•±½İ½ÍÑ]…É¹¥¹œ€ôì4(€€€€€€€€€€€ÁÉ½‘ÕÑ½}¥èÁ¥°4(€€€€€€€€€€€¹½µ•}ÁÉ½‘ÕÑ¼èÀ¹ÁÉ½‘ÕÑ¼¹¹½µ•}ÁÉ½‘ÕÑ¼°4(€€€€€€€€€€€Ù…±½É}ÕÍÑ¼èÕÍÑ¼°4(€€€€€€€€€€€ÕÍÑ½}½µ}¥µÁ½ÍÑ¼èÕÍÑ½½µ%µÁ½ÍÑ¼°4(€€€€€€€€€€€Ù…±½É}Ù•¹‘„èÙ…±½ÉY•¹‘„°4(€€€€€€€€€€€Á•‘¥‘½Ìèmì½‘¥¼è½É‘•È¹½‘¥¼°¹½µ•}±¥•¹Ñ”è½É‘•È¹¹½µ•}±¥•¹Ñ”°ÅÑèÅÑäõt°4(€€€€€€€€€ôì4(€€€€€€€€€‰•±½İ½ÍÑ5…À¹Í•Ğ¡Á¥°İ…É¹¥¹œ¤ì4(€€€€€€€€€‰•±½İ½ÍÑ]…É¹¥¹Ì¹ÁÕÍ ¡İ…É¹¥¹œ¤ì4(€€€€€€€ô4(€€€€€ô4(€€€ô4(€ô4(4(€É•ÑÕÉ¸ì™Õ±±MÑ½­=É‘•ÉÌ°½¹™±¥ÑÌ°‰•±½İ½ÍÑ]…É¹¥¹Ìôì4)ô4(4(¼¼€´´´AI=UPQ%1L€¡™½È‰…É½‘”•¹É¥¡µ•¹Ğ¤€´´´4)¥¹Ñ•É™…”AÉ½‘ÕÑáÑÉ…¥•±ì4(€¥èÍÑÉ¥¹œì4(€…ÑÉ¥‰ÕÑ½}¥èÍÑÉ¥¹œì4(€‘•ÍÉ¥…¼èÍÑÉ¥¹œì4(€½¹Ñ•Õ‘¼èÍÑÉ¥¹œì4(€Ñ¥Á¼üèÍÑÉ¥¹œì4)ô4(4)¥¹Ñ•É™…”AÉ½‘ÕÑ•Ñ…¥°ì4(€¥èÍÑÉ¥¹œì4(€½‘¥½}‰…ÉÉ„èÍÑÉ¥¹œì4(€½‘¥½}¥¹Ñ•É¹¼èÍÑÉ¥¹œì4(€¹½µ”èÍÑÉ¥¹œì4(€Ù…É¥…½•ÌüèÉÉ…äñìÙ…É¥……¼èì¥èÍÑÉ¥¹œì½‘¥¼èÍÑÉ¥¹œôôøì4(€…µÁ½Í}•áÑÉ…ÌüèAÉ½‘ÕÑáÑÉ…¥•±‘mtì4(€…ÑÉ¥‰ÕÑ½ÌüèÉÉ…äñì…ÑÉ¥‰ÕÑ¼èAÉ½‘ÕÑáÑÉ…¥•±ôøì4)ô4(4)…Íå¹Œ™Õ¹Ñ¥½¸•ÑAÉ½‘ÕÑ•Ñ…¥°¡ÁÉ½‘ÕÑ½%èÍÑÉ¥¹œ¤èAÉ½µ¥Í”ñAÉ½‘ÕÑ•Ñ…¥°ğ¹Õ±°øì4(€ÑÉäì4(€€€½¹ÍĞÉ•Ì€ô…İ…¥Ğ…Á¥I•ÅÕ•ÍĞñì‘…Ñ„èAÉ½‘ÕÑ•Ñ…¥°ôø¡€½…Á¤½ÁÉ½‘ÕÑ½Ì¼‘íÁÉ½‘ÕÑ½%‘õ€¤ì4(€€€É•ÑÕÉ¸É•Ì¹‘…Ñ„ì4(€ô…Ñ ì4(€€€É•ÑÕÉ¸¹Õ±°ì4(€ô4)ô4(4)•áÁ½ÉĞ…Íå¹Œ™Õ¹Ñ¥½¸•¹É¥¡=É‘•ÉAÉ½‘ÕÑÌ 4(€ÁÉ½‘ÕÑ½ÌèÉÉ…äñìÁÉ½‘ÕÑ¼èAÉ½‘ÕÑ½%Ñ•´ôø4(¤èAÉ½µ¥Í”ñÉÉ…äñìÁÉ½‘ÕÑ¼èAÉ½‘ÕÑ½%Ñ•´ôøøì4(€¥˜€¡¥ÍUÍ¥¹5½¬ ¤ñğ€…ÁÉ½‘ÕÑ½Ìü¹±•¹Ñ ¤É•ÑÕÉ¸ÁÉ½‘ÕÑ½Ìì4(4(€€¼¼•‘ÕÁ±¥…Ñ”ÁÉ½‘ÕÑ½}¥‘Ì4(€½¹ÍĞÕ¹¥ÅÕ•%‘Ì€ôl¸¸¹¹•ÜM•Ğ¡ÁÉ½‘ÕÑ½Ì¹µ…À¡À€ôøÀ¹ÁÉ½‘ÕÑ¼¹ÁÉ½‘ÕÑ½}¥¤¥tì4(€€4(€€¼¼•Ñ ÁÉ½‘ÕĞ‘•Ñ…¥±Ì¥¸‰…Ñ¡•Ì½˜€Ì€¡É•ÍÁ•ĞA$É…Ñ”±¥µ¥Ğ½˜€ÌÉ•Ä½Ì¤4(€½¹ÍĞ‘•Ñ…¥±5…À€ô¹•Ü5…ÀñÍÑÉ¥¹œ°AÉ½‘ÕÑ•Ñ…¥°ø ¤ì4(€™½È€¡±•Ğ¤€ô€Àì¤€ğÕ¹¥ÅÕ•%‘Ì¹±•¹Ñ ì¤€¬ô€Ì¤ì4(€€€½¹ÍĞ‰…Ñ €ôÕ¹¥ÅÕ•%‘Ì¹Í±¥”¡¤°¤€¬€Ì¤ì4(€€€½¹ÍĞÉ•ÍÕ±ÑÌ€ô…İ…¥ĞAÉ½µ¥Í”¹…±°¡‰…Ñ ¹µ…À¡¥€ôø•ÑAÉ½‘ÕÑ•Ñ…¥°¡¥¤¤¤ì4(€€€É•ÍÕ±ÑÌ¹™½É… ¡€ôøì¥˜€¡¤‘•Ñ…¥±5…À¹Í•Ğ¡¹¥°¤ìô¤ì4(€€€¥˜€¡¤€¬€Ì€ğÕ¹¥ÅÕ•%‘Ì¹±•¹Ñ ¤ì4(€€€€€…İ…¥Ğ¹•ÜAÉ½µ¥Í”¡È€ôøÍ•ÑQ¥µ•½ÕĞ¡È°€ÄÄÀÀ¤¤ì€¼¼É•ÍÁ•ĞÉ…Ñ”±¥µ¥Ğ4(€€€ô4(€ô4(4(€É•ÑÕÉ¸ÁÉ½‘ÕÑ½Ì¹µ…À ¡ìÁÉ½‘ÕÑ¼ô¤€ôøì4(€€€½¹ÍĞ‘•Ñ…¥°€ô‘•Ñ…¥±5…À¹•Ğ¡ÁÉ½‘ÕÑ¼¹ÁÉ½‘ÕÑ½}¥¤ì4(€€€¥˜€ …‘•Ñ…¥°¤É•ÑÕÉ¸ìÁÉ½‘ÕÑ¼ôì4(4(€€€€¼¼¥¹Ù…É¥…Ñ¥½¸½‘”¥˜…ÁÁ±¥…‰±”4(€€€±•Ğ½‘¥½	…ÉÉ…Ì€ô‘•Ñ…¥°¹½‘¥½}‰…ÉÉ„ñğ€œœì4(€€€½¹ÍĞ½‘¥½AÉ½‘ÕÑ¼€ô‘•Ñ…¥°¹½‘¥½}¥¹Ñ•É¹¼ñğ€œœì4(4(€€€¥˜€¡ÁÉ½‘ÕÑ¼¹Ù…É¥……½}¥€˜˜‘•Ñ…¥°¹Ù…É¥…½•Ì¤ì4(€€€€€½¹ÍĞÙ…É¥……¼€ô‘•Ñ…¥°¹Ù…É¥…½•Ì¹™¥¹¡Ø€ôøØ¹Ù…É¥……¼¹¥€ôôôÁÉ½‘ÕÑ¼¹Ù…É¥……½}¥¤ì4(€€€€€¥˜€¡Ù…É¥……¼ü¹Ù…É¥……¼¹½‘¥¼¤ì4(€€€€€€€¥˜€ …½‘¥½	…ÉÉ…Ì¤½‘¥½	…ÉÉ…Ì€ô€œœì4(€€€€€ô4(€€€ô4(4(€€€€¼¼áÑÉ…Ğ±½…Ñ¥½¸™¥•±‘Ì™É½´…ÑÉ¥‰ÕÑ½Ì€¡A$É•ÑÕÉ¹Ì…ÑÉ¥‰ÕÑ½Ìİ¥Ñ ¹•ÍÑ•…ÑÉ¥‰ÕÑ¼½‰©•ÑÌ¤4(€€€±•Ğ±½…±¥é……½}™¥Í¥„€ô€œœì4(€€€±•Ğ±½…±¥é……½}É…Ñ¥½¹…°€ô€œœì4(€€€€4(€€€€¼¼QÉä…ÑÉ¥‰ÕÑ½Ì™¥ÉÍĞ€¡…ÑÕ…°A$™½Éµ…Ğ¤4(€€€¥˜€¡‘•Ñ…¥°¹…ÑÉ¥‰ÕÑ½Ì€˜˜ÉÉ…ä¹¥ÍÉÉ…ä¡‘•Ñ…¥°¹…ÑÉ¥‰ÕÑ½Ì¤¤ì4(€€€€€™½È€¡½¹ÍĞ¥Ñ•´½˜‘•Ñ…¥°¹…ÑÉ¥‰ÕÑ½Ì¤ì4(€€€€€€€½¹ÍĞ…µÁ¼èAÉ½‘ÕÑáÑÉ…¥•±€ô€…ÑÉ¥‰ÕÑ¼œ¥¸¥Ñ•´€ü¥Ñ•´¹…ÑÉ¥‰ÕÑ¼€è¥Ñ•´…Ì…¹äì4(€€€€€€€½¹ÍĞ‘•ÍŒ€ô€¡…µÁ¼¹‘•ÍÉ¥…¼ñğ€œœ¤¹Ñ½1½İ•É…Í” ¤¹ÑÉ¥´ ¤ì4(€€€€€€€¥˜€¡‘•ÍŒ¹¥¹±Õ‘•Ì ±½…±¥é‡Ÿ¼›µÍ¥„œ¤ñğ‘•ÍŒ¹¥¹±Õ‘•Ì ±½…±¥é……¼™¥Í¥„œ¤¤ì4(€€€€€€€€€±½…±¥é……½}™¥Í¥„€ô…µÁ¼¹½¹Ñ•Õ‘¼ñğ€œœì4(€€€€€€€ô•±Í”¥˜€¡‘•ÍŒ¹¥¹±Õ‘•Ì ±½…±¥é‡Ÿ¼É…Ñ¥½¹…°œ¤ñğ‘•ÍŒ¹¥¹±Õ‘•Ì ±½…±¥é……¼É…Ñ¥½¹…°œ¤¤ì4(€€€€€€€€€±½…±¥é……½}É…Ñ¥½¹…°€ô…µÁ¼¹½¹Ñ•Õ‘¼ñğ€œœì4(€€€€€€€ô4(€€€€€ô4(€€€ô4(€€€€¼¼…±±‰…¬Ñ¼…µÁ½Í}•áÑÉ…Ì¥˜ÁÉ•Í•¹Ğ4(€€€¥˜€ …±½…±¥é……½}™¥Í¥„€˜˜€…±½…±¥é……½}É…Ñ¥½¹…°€˜˜‘•Ñ…¥°¹…µÁ½Í}•áÑÉ…Ì€˜˜ÉÉ…ä¹¥ÍÉÉ…ä¡‘•Ñ…¥°¹…µÁ½Í}•áÑÉ…Ì¤¤ì4(€€€€€™½È€¡½¹ÍĞ…µÁ¼½˜‘•Ñ…¥°¹…µÁ½Í}•áÑÉ…Ì¤ì4(€€€€€€€½¹ÍĞ‘•ÍŒ€ô€¡…µÁ¼¹‘•ÍÉ¥…¼ñğ€œœ¤¹Ñ½1½İ•É…Í” ¤¹ÑÉ¥´ ¤ì4(€€€€€€€¥˜€¡‘•ÍŒ¹¥¹±Õ‘•Ì ±½…±¥é‡Ÿ¼›µÍ¥„œ¤ñğ‘•ÍŒ¹¥¹±Õ‘•Ì ±½…±¥é……¼™¥Í¥„œ¤¤ì4(€€€€€€€€€±½…±¥é……½}™¥Í¥„€ô…µÁ¼¹½¹Ñ•Õ‘¼ñğ€œœì4(€€€€€€€ô•±Í”¥˜€¡‘•ÍŒ¹¥¹±Õ‘•Ì ±½…±¥é‡Ÿ¼É…Ñ¥½¹…°œ¤ñğ‘•ÍŒ¹¥¹±Õ‘•Ì ±½…±¥é……¼É…Ñ¥½¹…°œ¤¤ì4(€€€€€€€€€±½…±¥é……½}É…Ñ¥½¹…°€ô…µÁ¼¹½¹Ñ•Õ‘¼ñğ€œœì4(€€€€€€€ô4(€€€€€ô4(€€€ô4(4(€€€É•ÑÕÉ¸ì4(€€€€€ÁÉ½‘ÕÑ¼èì4(€€€€€€€€¸¸¹ÁÉ½‘ÕÑ¼°4(€€€€€€€½‘¥½}ÁÉ½‘ÕÑ¼è½‘¥½AÉ½‘ÕÑ¼°4(€€€€€€€½‘¥½}‰…ÉÉ…Ìè½‘¥½	…ÉÉ…Ì°4(€€€€€€€±½…±¥é……½}™¥Í¥„è±½…±¥é……½}™¥Í¥„ñğÕ¹‘•™¥¹•°4(€€€€€€€±½…±¥é……½}É…Ñ¥½¹…°è±½…±¥é……½}É…Ñ¥½¹…°ñğÕ¹‘•™¥¹•°4(€€€€€ô°4(€€€ôì4(€ô¤ì4)ô4(