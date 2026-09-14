import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));
import { getOS, getProductStock, updateOSStatus } from './gestaoclick';

const response = (data: unknown) => ({ data: { _proxy: { ok: true }, data }, error: null });
const networkFailure = { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' } };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.invoke.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('limites e cancelamento das consultas ao GestãoClick', () => {
  it('aborta o GET vencido antes da próxima tentativa e limita um produto a três chamadas', async () => {
    let active = 0;
    let maximumActive = 0;
    const signals: AbortSignal[] = [];
    mocks.invoke.mockImplementation((_name, { signal }) => new Promise(resolve => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      signals.push(signal);
      signal.addEventListener('abort', () => {
        active -= 1;
        resolve(networkFailure);
      }, { once: true });
    }));

    const startedAt = Date.now();
    const pending = getProductStock('product', undefined, { forceFresh: true });
    await vi.runAllTimersAsync();
    expect(await pending).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(maximumActive).toBe(1);
    expect(active).toBe(0);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(64000);
    expect(mocks.invoke.mock.calls.every(([, options]) => options.body.method === 'GET')).toBe(true);
  });

  it('encerra a espera mesmo se o transporte não resolver depois do abort', async () => {
    mocks.invoke.mockImplementation(() => new Promise(() => undefined));
    const result = getOS('order').then(() => 'success', error => error.message);
    await vi.runAllTimersAsync();
    expect(await result).toBe('TIMEOUT');
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(mocks.invoke.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
  });

  it('aplica um único orçamento de retry ao erro de rede retornado pelo SDK', async () => {
    mocks.invoke.mockResolvedValue(networkFailure);
    const pending = getProductStock('product');
    await vi.runAllTimersAsync();
    expect(await pending).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
  });

  it('recupera uma falha transitória sem alterar saldo nem variação', async () => {
    mocks.invoke.mockResolvedValueOnce(networkFailure).mockResolvedValue(response({
      id: 'product', estoque: '20', valor_custo: '10', variacoes: [{ variacao: { id: 'variant', estoque: '4' } }],
    }));
    const pending = getProductStock('product', 'variant', { forceFresh: true });
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ produto_id: 'product', estoque: 4, valor_custo: 10 });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke.mock.calls[0][1].body.path).toMatch(/^\/api\/produtos\/product\?cache_bust=/);
    expect(mocks.invoke.mock.calls.every(([, options]) => options.signal.aborted === false)).toBe(true);
  });

  it.each([
    { data: { _proxy: { ok: false, gc_http_status: 400 }, error: 'Produto inválido' }, error: null },
    response({ id: 'product' }),
  ])('não repete erro definitivo nem transforma saldo desconhecido em zero', async failedResponse => {
    mocks.invoke.mockResolvedValue(failedResponse);
    expect(await getProductStock('product')).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it('jamais repete PUT sem confirmação, mesmo quando o timeout aborta a conexão', async () => {
    const document = { id: 'order', codigo: '10186', situacao_id: 'waiting', cliente_id: 'client',
      produtos: [{ produto: { produto_id: 'product', quantidade: '2' } }], servicos: [], atributos: [] };
    mocks.invoke.mockImplementation((_name, { body, signal }) => {
      if (body.method === 'GET') return Promise.resolve(response(document));
      return new Promise(resolve => signal.addEventListener('abort', () => resolve(networkFailure), { once: true }));
    });
    const result = updateOSStatus('order', document as any, 'withdrawn').then(() => 'success', error => error.message);
    await vi.runAllTimersAsync();
    expect(await result).toBe('TIMEOUT');
    expect(mocks.invoke.mock.calls.map(([, options]) => options.body.method)).toEqual(['GET', 'PUT']);
    expect(mocks.invoke.mock.calls[1][1].signal.aborted).toBe(true);
  });
});
