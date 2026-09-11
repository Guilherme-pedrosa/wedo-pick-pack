import { readFileSync, writeFileSync } from 'node:fs';
import { scanPurchases, BUDGET_STATUS_NAMES, PURCHASE_STATUS_NAMES } from '../supabase/functions/_shared/purchaseScan.ts';
import { normalizedStatus } from '../supabase/functions/_shared/partialExecution.ts';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')];
}));
const token = process.env.PARTIAL_EXECUTION_TOKEN;
if (!token) throw Error('Segredo da rotina não configurado.');
const headers = { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' };
const api = async (action, payload = {}) => {
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/compras_worker_api`, { method: 'POST', headers,
    body: JSON.stringify({ p_token: token, p_action: action, p_payload: payload }), signal: AbortSignal.timeout(60000) });
  const data = await res.json(); if (!res.ok) throw Error(`Banco: ${data.message || res.status}`); return data;
};
const gc = async path => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/gc-proxy`, { method: 'POST', headers,
      body: JSON.stringify({ path, method: 'GET' }), signal: AbortSignal.timeout(60000) });
    const data = await res.json();
    if (res.ok && data?._proxy?.ok) return data;
    if ((res.status === 429 || data?._proxy?.gc_http_status === 429) && attempt < 3) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue;
    }
    throw Error(`GC GET ${path}: ${data?._proxy?.gc_http_status || res.status}`);
  }
};
const statuses = async (path, names) => {
  const res = await gc(path);
  if (!Array.isArray(res.data)) throw Error('Situações do GC não informadas.');
  const ids = res.data.map(s => s.Situacao || s.situacao || s).filter(s => names.some(n => normalizedStatus(n) === normalizedStatus(s.nome))).map(s => String(s.id));
  if (!ids.length) throw Error('Situações configuradas não localizadas.');
  return ids;
};
const started = Date.now();
const budgetIds = await statuses('/api/situacoes_orcamentos?limite=100', BUDGET_STATUS_NAMES);
const purchaseIds = await statuses('/api/situacoes_compras?limite=100', PURCHASE_STATUS_NAMES);
let revision;
const result = await scanPurchases({ gc, partials: async () => {
  const state = await api('partials'); revision = state.revision; return state.operations;
}, progress: (step, checked, total) => { if (checked === total || checked % 10 === 0) console.log(step); } }, budgetIds, purchaseIds);
if (process.env.PURCHASE_SCAN_EVIDENCE) writeFileSync(process.env.PURCHASE_SCAN_EVIDENCE, JSON.stringify(result, null, 2));
if (!process.argv.includes('--dry-run')) {
  const saved = await api('save', { revision, result, duration_ms: Date.now() - started, config: {
    budget_statuses: BUDGET_STATUS_NAMES, purchase_statuses: PURCHASE_STATUS_NAMES, budget_status_ids: budgetIds, purchase_status_ids: purchaseIds,
  } });
  console.log(`Snapshot salvo: ${saved.id}`);
}
console.log(JSON.stringify({ aComprar: result.totalProdutosSemEstoque, cobertosPorPedido: result.totalItensCobertosporPedido,
  baixasParciais: result.partialOperationsIncluded, documentos: result.totalOrcamentos,
  saldosParciais: [...result.itensList, ...result.itensCobertosporPedido, ...result.itensOkList].filter(i => i.orcamentos.some(o => o.partial_operation_id))
    .map(i => ({ produto: i.nome_produto, necessario: i.qtd_necessaria, estoque: i.estoque_atual, pedido: i.qtd_ja_em_compra, comprar: i.qtd_efetiva_a_comprar,
      origens: i.orcamentos.map(o => ({ codigo: o.codigo, qtd: o.qtd })) })) }));
