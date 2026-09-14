import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
import { enrichOrderProducts } from './gestaoclick';

const line = (id: string, quantity: number, variation = '') => ({ produto: {
  produto_id: id, variacao_id: variation, nome_produto: id, quantidade: quantity,
  codigo_produto: `OLD-${id}`, codigo_barras: '', sigla_unidade: 'UN',
} });
const product = (id: string, stock = '3') => ({ data: { _proxy: { ok: true }, data: {
  id, codigo_interno: `CODE-${id}`, codigo_barra: `BAR-${id}`, estoque: stock,
  atributos: [{ atributo: { descricao: 'Localização física', conteudo: `BOX-${id}` } }],
} }, error: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => { vi.useFakeTimers(); mocks.invoke.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('códigos e localizações incrementais do pedido selecionado', () => {
  it('preserva linhas sem ID e nunca transforma uma consulta de produto em catálogo', async () => {
    const original = ['', '  ', null, undefined, 'null', 'undefined', '0', 'valid'].map(id => line(id as any, 2));
    const before = structuredClone(original);
    mocks.invoke.mockResolvedValue(product('valid'));
    const progress = vi.fn();
    const result = await enrichOrderProducts(original, { onProgress: progress });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls[0][1].body.path).toBe('/api/produtos/valid');
    expect(progress).toHaveBeenCalledTimes(1);
    expect(original).toEqual(before);
    expect(result.slice(0, -1)).toEqual(before.slice(0, -1));
    expect(result.at(-1)?.produto).toMatchObject({ produto_id: 'valid', quantidade: 2, codigo_barras: 'BAR-valid' });
  });

  it.each([
    [{ id: 'one', codigo_barra: 'WRONG' }],
    { id: 'another', codigo_barra: 'WRONG' },
  ])('não aplica catálogo nem detalhe de outro produto', async returnedData => {
    mocks.invoke.mockResolvedValue({ data: { _proxy: { ok: true }, data: returnedData }, error: null });
    const original = [line('one', 2)], progress = vi.fn(), warnings = vi.fn();
    const result = await enrichOrderProducts(original, { checkStock: true, onProgress: progress, onStockWarning: warnings });
    expect(result).toEqual(original);
    expect(progress).not.toHaveBeenCalled();
    expect(warnings).toHaveBeenCalledExactlyOnceWith('Saldo não consultado: one.');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it('libera o produto rápido sem esperar o lento e mantém ordem, linhas e quantidades', async () => {
    const slow = deferred<any>();
    mocks.invoke.mockImplementation((_name, { body }) => body.path.includes('/slow') ? slow.promise : Promise.resolve(product('fast')));
    const original = [line('slow', 2), line('fast', 1), line('fast', 3)];
    const before = structuredClone(original);
    const progress = vi.fn(), warnings = vi.fn(), finished = vi.fn();
    const pending = enrichOrderProducts(original, { checkStock: true, onProgress: progress, onStockWarning: warnings }).then(result => { finished(result); return result; });

    await vi.advanceTimersByTimeAsync(0);
    expect(progress).toHaveBeenCalledTimes(1);
    const first = progress.mock.calls[0][0];
    expect(first.map(({ produto }: any) => [produto.produto_id, produto.variacao_id, produto.quantidade])).toEqual([
      ['slow', '', 2], ['fast', '', 1], ['fast', '', 3],
    ]);
    expect(first[0].produto.codigo_barras).toBe('');
    expect(first[1].produto).toMatchObject({ codigo_barras: 'BAR-fast', localizacao_fisica: 'BOX-fast' });
    expect(first[2].produto.codigo_barras).toBe('BAR-fast');
    expect(finished).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);

    slow.resolve(product('slow'));
    const result = await pending;
    expect(progress).toHaveBeenCalledTimes(2);
    expect(result[0].produto).toMatchObject({ quantidade: 2, codigo_barras: 'BAR-slow', localizacao_fisica: 'BOX-slow' });
    expect(warnings).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('fast — solicitado 4, saldo GC 3'));
    expect(original).toEqual(before);
    expect(first[0].produto.codigo_barras).toBe('');
    expect(mocks.invoke.mock.calls.every(([, { body }]) => body.method === 'GET' && body.path.startsWith('/api/produtos/'))).toBe(true);
  });

  it('mantém o limite de três consultas simultâneas e a pausa entre lotes', async () => {
    mocks.invoke.mockImplementation((_name, { body }) => Promise.resolve(product(body.path.match(/produtos\/([^?]+)/)[1])));
    const progress = vi.fn();
    const pending = enrichOrderProducts(['one', 'two', 'three', 'four'].map(id => line(id, 1)), { onProgress: progress });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1099);
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(mocks.invoke).toHaveBeenCalledTimes(4);
    expect(progress).toHaveBeenCalledTimes(4);
    expect(result.map(({ produto }) => produto.quantidade)).toEqual([1, 1, 1, 1]);
  });

  it('preserva o item cujo detalhe falhou e avisa saldo desconhecido ao terminar', async () => {
    mocks.invoke.mockImplementation((_name, { body }) => body.path.includes('/missing')
      ? Promise.resolve({ data: { _proxy: { ok: false, gc_http_status: 404 } }, error: null })
      : Promise.resolve(product('found')));
    const original = [line('missing', 7, 'variant'), line('found', 1)];
    const progress = vi.fn(), warnings = vi.fn();
    const result = await enrichOrderProducts(original, { checkStock: true, onProgress: progress, onStockWarning: warnings });
    expect(progress).toHaveBeenCalledTimes(1);
    expect(result[0]).toEqual(original[0]);
    expect(result[1].produto.codigo_barras).toBe('BAR-found');
    expect(warnings).toHaveBeenCalledExactlyOnceWith('Saldo não consultado: missing.');
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
});
