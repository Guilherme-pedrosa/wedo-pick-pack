// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';

let script: string;
beforeAll(async () => {
  script = (await build({ entryPoints: [resolve('supabase/functions/generate-os/index.ts')], bundle: true,
    write: false, format: 'iife', platform: 'neutral', target: 'es2022' })).outputFiles[0].text;
});

async function generate(service = false, partial = false, inspection = false) {
  const budget = { id: 'budget', codigo: '123', cliente_id: 'client', nome_cliente: 'Cliente', data: '2026-09-11',
    valor_total: service ? '250.00' : '200.00', valor_produtos: '200.00', valor_servicos: service ? '50.00' : '0.00',
    produtos: [{ produto: { produto_id: 'product', nome_produto: 'Peça', quantidade: '2.0000', valor_venda: '100.00', valor_total: '200.00' } }],
    servicos: service ? [{ servico: { servico_id: 'service', nome_servico: 'Serviço', quantidade: '1.0000', valor_venda: '50.00', valor_total: '50.00' } }] : [],
    observacoes: 'Observação original', observacoes_interna: 'Histórico original', vendedor_id: 'seller', atributos: [] };
  const writes: Array<{ path: string; method: string; body: any }> = [];
  let reads = 0;
  let handler: (req: Request) => Promise<Response>;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const fakeFetch = async (input: string | Request, init?: RequestInit) => {
    const req = new Request(input, init); const url = new URL(req.url); const path = url.pathname;
    if (req.method !== 'GET') writes.push({ path, method: req.method, body: JSON.parse(await req.text()) });
    else reads++;
    if (url.hostname === 'test.supabase.co') return json([]);
    if (path === '/v2/login/') return json({ result: { accessToken: 'test-token' } });
    if (path === '/v2/tasks' && req.method === 'PUT') return json({ result: { taskID: 123456 } });
    if (path === '/api/orcamentos/budget') return json({ data: budget });
    if (path.includes('/api/atributos_')) return json({ data: [] });
    if (['/api/vendas', '/api/ordens_servicos'].includes(path) && req.method === 'POST') return json({ data: { id: 'new', codigo: '1000' } });
    throw Error(`Unexpected test request: ${req.method} ${path}`);
  };
  runInNewContext(script, { Request, Response, Headers, URL, fetch: fakeFetch,
    Deno: { env: { get: (key: string) => key === 'SUPABASE_URL' ? 'https://test.supabase.co' : 'test-secret' }, serve: (fn: typeof handler) => { handler = fn; } },
    console: { log() {}, warn() {}, error() {} }, setTimeout: (fn: () => void) => { fn(); } });
  const body = inspection ? { action: 'generation_rules' } : { orcamento: budget, auvo_user_id: 1, auvo_customer_id: 2,
    partial_auxiliaries: partial ? [{ document_type: 'venda', document_id: 'aux', document_code: '900', auvo_task_id: '111', sequence: 1 }] : undefined };
  const response = await handler!(new Request('https://test/function', { method: 'POST', body: JSON.stringify(body) }));
  return { status: response.status, result: await response.json(), writes, reads, budget };
}

describe('vendas de produto geradas pelo Rastreador', () => {
  it('envia os dois status e o questionário corretos nas requisições reais do handler, preservando quantidades e valores', async () => {
    const f = await generate(); expect(f.result.error).toBeUndefined(); expect(f.status).toBe(200);
    expect(f.writes.find(w => w.path === '/v2/tasks')?.body).toMatchObject({ taskType: 200268, questionnaireId: 224444 });
    const sale = f.writes.find(w => w.path === '/api/vendas')!.body;
    const update = f.writes.find(w => w.path === '/api/orcamentos/budget')!.body;
    expect(sale.situacao_id).toBe('9303817'); expect(update.situacao_id).toBe('7706107');
    expect(sale.produtos).toEqual(f.budget.produtos); expect(update.produtos).toEqual(f.budget.produtos);
    expect(update.observacoes).toBe(f.budget.observacoes); expect(update.observacoes_interna).toBe(f.budget.observacoes_interna);
    expect(sale.valor_total).toBe('200.00'); expect(update.valor_total).toBe('200.00');
  });
  it('mantém a geração de OS de serviço com seus vínculos próprios', async () => {
    const f = await generate(true); expect(f.result.error).toBeUndefined(); expect(f.status).toBe(200);
    expect(f.writes.find(w => w.path === '/v2/tasks')?.body).toMatchObject({ taskType: 180177, questionnaireId: 214757 });
    expect(f.writes.find(w => w.path === '/api/ordens_servicos')?.body.situacao_id).toBe('7063581');
    expect(f.writes.find(w => w.path === '/api/orcamentos/budget')?.body.situacao_id).toBe('7109779');
    expect(f.writes.some(w => w.path === '/api/vendas')).toBe(false);
  });
  it('mantém a situação da consolidação de entregas parciais, fora do fluxo do Rastreador', async () => {
    const f = await generate(false, true); expect(f.result.error).toBeUndefined();
    expect(f.writes.find(w => w.path === '/api/vendas')?.body.situacao_id).toBe('8955109');
    expect(f.writes.find(w => w.path === '/api/orcamentos/budget')?.body.situacao_id).toBe('7706107');
  });
  it('permite conferir a versão implantada sem tocar em GC, Auvo ou banco', async () => {
    const f = await generate(false, false, true);
    expect(f.result.version).toBe('2026-09-11-product-sales-v1');
    expect(f.result.rules.venda).toMatchObject({ budgetStatusId: '7706107', documentStatusId: '9303817', questionnaireId: 224444 });
    expect(f.writes).toEqual([]); expect(f.reads).toBe(0);
  });
});
