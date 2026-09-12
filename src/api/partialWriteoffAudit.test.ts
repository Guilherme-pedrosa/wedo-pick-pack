import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), from: vi.fn(), getUser: vi.fn(), stockGuard: vi.fn() }));
vi.mock('./checkoutStockGuard', () => ({ assertCheckoutStock: mock.stockGuard }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: mock.invoke }, rpc: mock.rpc, from: mock.from, auth: { getUser: mock.getUser },
} }));
import { invokePartialWriteoffClient } from './partialWriteoffClient';

const product = { produto: { produto_id: 'p', variacao_id: 'v', quantidade: '2', nome_produto: 'Peça' } };
const original = { id: 'source', codigo: '6276', cliente_id: 'client', situacao_id: '9348312', produtos: [product], servicos: [], valor_total: '100' };
let batch: any, document: any, source: any;
beforeEach(() => {
  vi.clearAllMocks();
  batch = { id: 'batch', operation_id: 'op', sequence: 1, status: 'reconciliation_required', auxiliary_document_type: 'os', auxiliary_document_id: 'doc', auxiliary_document_code: '10224' };
  document = { id: 'doc', codigo: '10224', cliente_id: 'client', situacao_id: 'different', nome_situacao: 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO', situacao_estoque: '1', produtos: [product] };
  source = structuredClone(original);
  mock.getUser.mockResolvedValue({ data: { user: { id: 'user', email: 'operator@example.test' } }, error: null });
  mock.rpc.mockResolvedValue({ data: { already_confirmed: false }, error: null });
  mock.stockGuard.mockResolvedValue(undefined);
  mock.from.mockImplementation((table: string) => {
    const values: Record<string, any> = {
      profiles: { name: 'Operador' },
      partial_writeoff_settings: { os_cancel_status_id: 'cancel', os_stock_status_id: 'stock', os_waiting_status_id: 'waiting' },
      partial_writeoff_operations: { id: 'op', budget_id: 'source', budget_snapshot: original, status: 'awaiting_separation' },
      partial_writeoff_item_balances: [{ id: 'item', product_id: 'p', variation_id: 'v', original_quantity: 2, withdrawn_quantity: 0, reserved_quantity: 2, line_snapshot: product }],
      partial_writeoff_batches: [batch],
      partial_writeoff_batch_items: [{ quantity: 2, partial_writeoff_items: { line_snapshot: product } }],
    };
    if (!(table in values)) throw new Error(`Unexpected table ${table}`);
    const response = { data: values[table], error: null };
    const query: any = { then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject) };
    for (const method of ['select', 'eq', 'order', 'single', 'maybeSingle']) query[method] = () => query;
    if (table === 'partial_writeoff_batches') query.single = () => Promise.resolve({ data: batch, error: null });
    return query;
  });
  mock.invoke.mockImplementation(async (name: string, { body }: any) => {
    expect(name).toBe('gc-proxy');
    expect(body.method).toBe('GET');
    const data = body.path === '/api/ordens_servicos/doc' ? document : body.path === '/api/orcamentos/source' ? source : undefined;
    if (!data) throw new Error(`Unexpected GET ${body.path}`);
    return { data: { _proxy: { ok: true }, data }, error: null };
  });
});

describe('retomada do Checkout após reconciliação', () => {
  const checkout = () => invokePartialWriteoffClient({ action: 'confirm_batch', batch_id: 'batch' });
  it('reconhece a baixa externa sem mandar PUT nem verificar estoque que já saiu', async () => {
    await checkout();
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('partial_writeoff_reconcile_gc_debit', expect.any(Object));
    expect(mock.stockGuard).not.toHaveBeenCalled();
  });
  it('retoma a mesma OS após erro, relê os campos atuais e aplica uma única alteração de situação', async () => {
    document.situacao_estoque = '0';
    document.atributos = [{ atributo: { atributo_id: '73897', conteudo: '26' } }];
    mock.rpc.mockImplementation(async (name: string) => ({ data: name === 'partial_writeoff_retry_confirmation' ? 'confirming' : 'awaiting_balance', error: null }));
    mock.invoke.mockImplementation(async (_name: string, { body }: any) => {
      if (body.method === 'PUT') {
        expect(body.path).toBe('/api/ordens_servicos/doc');
        expect(body.payload.atributos[0].atributo.conteudo).toBe('26');
        expect(body.payload.produtos).toEqual([product]);
        document = { ...document, ...body.payload, situacao_estoque: '1' };
      }
      return { data: { _proxy: { ok: true }, data: body.path === '/api/orcamentos/source' ? source : document }, error: null };
    });
    await checkout();
    expect(mock.stockGuard).toHaveBeenCalledOnce();
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(['partial_writeoff_retry_confirmation', 'partial_writeoff_finish_confirmation']);
    expect(mock.invoke.mock.calls.filter(call => call[1].body.method === 'PUT')).toHaveLength(1);
    expect(mock.invoke.mock.calls.some(call => call[1].body.method === 'POST')).toBe(false);
  });
  it('mantém a trava de estoque antes de reivindicar a retomada', async () => {
    document.situacao_estoque = '0';
    mock.stockGuard.mockRejectedValue(new Error('INSUFFICIENT_COMMITTED_STOCK'));
    await expect(checkout()).rejects.toThrow('INSUFFICIENT_COMMITTED_STOCK');
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('reenvia HORAS TÉCNICAS faltante com as 8 horas da fonte em uma única baixa', async () => {
    document.situacao_estoque = '0';
    source.servicos = [{ servico: { nome_servico: 'HORA TECNICA A', quantidade: '8.0000' } }];
    original.servicos = structuredClone(source.servicos);
    try {
      mock.invoke.mockImplementation(async (_name: string, { body }: any) => {
        if (body.method === 'PUT') {
          expect(body.path).toBe('/api/ordens_servicos/doc');
          expect(body.payload.atributos).toEqual([{ atributo: { atributo_id: '73897', conteudo: '8' } }]);
          expect(body.payload.servicos).toBeUndefined();
          document = { ...document, ...body.payload, situacao_estoque: '1' };
        }
        return { data: { _proxy: { ok: true }, data: body.path === '/api/orcamentos/source' ? source : document }, error: null };
      });
      await checkout();
      expect(mock.invoke.mock.calls.filter(call => call[1].body.method === 'PUT')).toHaveLength(1);
      expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(['partial_writeoff_retry_confirmation', 'partial_writeoff_finish_confirmation']);
    } finally { original.servicos = []; }
  });
});
const audit = async () => (await invokePartialWriteoffClient<{ audits: any[] }>({ action: 'audit_documents', operation_id: 'op' })).audits[0];

describe('confirmação local das baixas já aplicadas no GC', () => {
  it.each(['reconciliation_required', 'awaiting_checkout'])('reconcilia %s por situacao_estoque, relendo o orçamento sem rebaixar', async status => {
    batch.status = status;
    expect(await audit()).toMatchObject({ state: 'ok', batchStatus: 'confirmed' });
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('partial_writeoff_reconcile_gc_debit', {
      p_batch_id: 'batch', p_gc_document: document, p_source_budget: source,
    });
    expect(mock.invoke.mock.calls.map(call => call[1].body.path)).toEqual(['/api/ordens_servicos/doc', '/api/orcamentos/source']);
  });
  it('não confunde nome/situação de retirada com estoque efetivamente baixado', async () => {
    document.situacao_estoque = '0'; document.situacao_id = 'stock';
    batch.error_message = 'HORAS TÉCNICAS (#73897)';
    expect(await audit()).toMatchObject({ state: 'pending_checkout', message: expect.stringContaining('HORAS TÉCNICAS') });
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.invoke.mock.calls.every(call => call[1].body.method === 'GET')).toBe(true);
  });
  it('não reconcilia um documento cancelado', async () => {
    document.situacao_id = 'cancel';
    expect(await audit()).toMatchObject({ state: 'cancelled' });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('não registra novamente lotes já confirmados', async () => {
    batch.status = 'confirmed'; await audit(); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('reconcilia peças devolvidas de lote confirmado sem reenviar baixa ao GC', async () => {
    batch.status = 'confirmed'; document.produtos = [];
    mock.rpc.mockResolvedValue({ data: { returned_quantity: 2, batch_status: 'confirmed' }, error: null });
    expect(await audit()).toMatchObject({ state: 'ok', message: expect.stringContaining('2 unidade(s) voltaram') });
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('partial_writeoff_reconcile_return', { p_batch_id: 'batch', p_gc_document: document });
    expect(mock.invoke.mock.calls.every(c => c[1].body.method === 'GET')).toBe(true);
  });
  it('não afirma sucesso para lote confirmado alterado sem comprovante de devolução', async () => {
    batch.status = 'confirmed'; document.produtos = [];
    mock.rpc.mockResolvedValue({ data: null, error: { message: 'RETURN_RECEIPT_REQUIRED' } });
    expect(await audit()).toMatchObject({ state: 'error', message: expect.stringContaining('RETURN_RECEIPT_REQUIRED') });
  });
  it('bloqueia divergência no orçamento original antes de confirmar saldos', async () => {
    source.produtos[0].produto.quantidade = '3';
    expect(await audit()).toMatchObject({ state: 'error' });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('expõe falha na confirmação local em vez de declarar auditoria OK', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: 'AUXILIARY_ITEMS_CHANGED' } });
    expect(await audit()).toMatchObject({ state: 'error', message: expect.stringContaining('AUXILIARY_ITEMS_CHANGED') });
  });
});
