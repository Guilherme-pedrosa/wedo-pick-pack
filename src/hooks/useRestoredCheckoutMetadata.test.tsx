import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  } });
  return { enrich: vi.fn(), warning: vi.fn(), saved };
});
vi.mock('@/api/gestaoclick', () => ({ enrichOrderProducts: mocks.enrich }));
vi.mock('sonner', () => ({ toast: { warning: mocks.warning } }));
import { useCheckoutStore } from '@/store/checkoutStore';
import { useRestoredCheckoutMetadata } from './useRestoredCheckoutMetadata';
import type { Order } from '@/api/types';

const product = (id: string, quantity = 3) => ({ produto: {
  produto_id: id, variacao_id: 'variant', nome_produto: id, quantidade: quantity,
  codigo_produto: `CODE-${id}`, codigo_barras: '', sigla_unidade: 'UN',
} });
const order = (id = 'order'): Order => ({ id, codigo: id, cliente_id: 'client', nome_cliente: 'Client',
  situacao_id: 'waiting', nome_situacao: 'PEDIDO EM CONFERENCIA', situacao_estoque: '0',
  valor_total: '100', data: '2026-09-14', produtos: [product('one'), product('two')],
} as Order);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

beforeEach(() => {
  mocks.enrich.mockReset(); mocks.warning.mockReset(); mocks.saved.clear();
  useCheckoutStore.setState({ session: null, sessionsByUser: {}, metadataRequestId: null, productMetadataLoading: false });
});
afterEach(cleanup);

async function reloadPersistedSession() {
  const saved = localStorage.getItem('wedo-checkout-store')!;
  useCheckoutStore.setState({ session: null, metadataRequestId: null, productMetadataLoading: false });
  localStorage.setItem('wedo-checkout-store', saved);
  await act(async () => { await useCheckoutStore.persist.rehydrate(); });
}

describe('retomada dos metadados após recarregar o Checkout', () => {
  it('retoma uma só vez no StrictMode preservando vínculo, documento, IDs e conferência', async () => {
    const store = useCheckoutStore.getState();
    store.startSession('os', order(), { operationId: 'operation', batchId: 'batch', budgetCode: '6277', marker: 'marker' });
    store.confirmItem(useCheckoutStore.getState().session!.items[0].id, 1);
    const before = structuredClone(useCheckoutStore.getState().session!);
    await reloadPersistedSession();
    const pending = deferred<any>(); mocks.enrich.mockReturnValue(pending.promise);
    const hook = renderHook(useRestoredCheckoutMetadata, { wrapper });
    expect(mocks.enrich).toHaveBeenCalledTimes(1);
    expect(mocks.enrich.mock.calls[0][0]).toEqual(before.rawOrder.produtos);
    expect(useCheckoutStore.getState().productMetadataLoading).toBe(true);
    expect(useCheckoutStore.getState().session?.productMetadataPending).toBe(true);

    const updated = before.rawOrder.produtos.map(({ produto }) => ({ produto: { ...produto, quantidade: 999, codigo_barras: `BAR-${produto.produto_id}` } }));
    act(() => mocks.enrich.mock.calls[0][1].onProgress(updated));
    const partial = useCheckoutStore.getState().session!;
    expect(partial.items.map(item => [item.id, item.qtd_total, item.qtd_conferida])).toEqual(before.items.map(item => [item.id, item.qtd_total, item.qtd_conferida]));
    expect(partial.partialWriteoff).toEqual(before.partialWriteoff);
    expect(partial.rawOrder).toEqual(before.rawOrder);
    await act(async () => { pending.resolve(updated); await pending.promise; });
    expect(useCheckoutStore.getState().session?.productMetadataPending).toBe(false);
    expect(useCheckoutStore.getState().session?.items[0].codigo_barras).toBe('BAR-one');
    expect(useCheckoutStore.getState().productMetadataLoading).toBe(false);

    hook.unmount(); await reloadPersistedSession(); renderHook(useRestoredCheckoutMetadata, { wrapper });
    expect(mocks.enrich).toHaveBeenCalledTimes(1);
  });

  it('não duplica a consulta que a abertura normal já iniciou', () => {
    useCheckoutStore.getState().startSession('os', order());
    const requestId = useCheckoutStore.getState().metadataRequestId;
    renderHook(useRestoredCheckoutMetadata, { wrapper });
    expect(mocks.enrich).not.toHaveBeenCalled();
    expect(useCheckoutStore.getState().metadataRequestId).toBe(requestId);
  });

  it('atualiza uma sessão antiga sem marcador uma única vez', async () => {
    useCheckoutStore.getState().startSession('os', order());
    const old = { ...useCheckoutStore.getState().session! }; delete old.productMetadataPending;
    useCheckoutStore.setState({ session: old, metadataRequestId: null, productMetadataLoading: false });
    mocks.enrich.mockResolvedValue(old.rawOrder.produtos);
    const hook = renderHook(useRestoredCheckoutMetadata, { wrapper });
    await act(async () => undefined);
    expect(mocks.enrich).toHaveBeenCalledTimes(1);
    expect(useCheckoutStore.getState().session?.productMetadataPending).toBe(false);
    hook.rerender();
    expect(mocks.enrich).toHaveBeenCalledTimes(1);
  });

  it('ignora progresso e término antigos depois de abrir outra OS', async () => {
    useCheckoutStore.getState().startSession('os', order()); await reloadPersistedSession();
    const pending = deferred<any>(); mocks.enrich.mockReturnValue(pending.promise);
    renderHook(useRestoredCheckoutMetadata, { wrapper });
    const options = mocks.enrich.mock.calls[0][1];
    act(() => { useCheckoutStore.getState().startSession('os', order('other')); });
    const other = structuredClone(useCheckoutStore.getState().session!);
    act(() => options.onProgress([product('one', 999)]));
    act(() => options.onStockWarning('Aviso antigo'));
    await act(async () => { pending.resolve([product('one', 999)]); await pending.promise; });
    expect(useCheckoutStore.getState().session).toEqual(other);
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(mocks.enrich).toHaveBeenCalledTimes(1);
  });

  it.each(['concluded', 'confirmed'])('não consulta metadados de sessão %s', state => {
    useCheckoutStore.getState().startSession('os', order());
    const session = { ...useCheckoutStore.getState().session! };
    if (state === 'concluded') session.concludedAt = '2026-09-14T13:00:00Z';
    else session.gcConfirmation = { targetStatusId: 'done', targetStatusName: 'Concluído', concludedAt: '2026-09-14T13:00:00Z' };
    useCheckoutStore.setState({ session, metadataRequestId: null, productMetadataLoading: false });
    renderHook(useRestoredCheckoutMetadata, { wrapper });
    expect(mocks.enrich).not.toHaveBeenCalled();
  });
});
