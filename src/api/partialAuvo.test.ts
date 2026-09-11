import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertRequestedAuvoTasksLinked, canRequestPartialAuvoTask, DEFAULT_CREATE_PARTIAL_AUVO_TASK, wantsPartialAuvoTask } from '../../supabase/functions/_shared/partialAuvo';

const mock = vi.hoisted(() => ({
  batch: {} as any, flowMode: 'reservation',
  invoke: vi.fn(), rpc: vi.fn(), operation: {} as any, budget: {} as any, items: [] as any[],
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: mock.invoke },
  rpc: mock.rpc,
  from: (table: string) => {
    let patch: any;
    const result = (many = false) => {
      if (patch) Object.assign(mock.batch, patch);
      return { data: table === 'partial_writeoff_batches' ? (many ? [mock.batch] : mock.batch)
        : table === 'partial_writeoff_operations' ? { ...mock.operation, flow_mode: mock.flowMode }
        : table === 'partial_writeoff_item_balances' ? mock.items
        : [], error: null };
    };
    const chain: any = {
      select: () => chain, eq: () => chain, is: () => chain,
      update: (value: any) => { patch = value; return chain; },
      single: async () => result(), order: async () => result(true),
      then: (resolve: any) => Promise.resolve(result()).then(resolve),
    };
    return chain;
  },
} }));
import { createBatchAuvoTask } from './partialWriteoffClient';

beforeEach(() => {
  mock.batch = { id: 'batch', operation_id: 'op', status: 'awaiting_checkout', auxiliary_document_id: 'os-10226', auvo_task_requested: false, auvo_task_id: null };
  mock.budget = { id: 'budget', produtos: [{ produto: { produto_id: 'p', quantidade: '3' } }] };
  mock.operation = { id: 'op', status: 'partial_separation', budget_id: 'budget', budget_snapshot: structuredClone(mock.budget) };
  mock.items = [{ product_id: 'p', original_quantity: 3, reserved_quantity: 3, withdrawn_quantity: 0 }];
  mock.flowMode = 'reservation';
  mock.rpc.mockReset();
  mock.rpc.mockImplementation(async () => { mock.batch.auvo_task_requested = true; return { data: { requested: true }, error: null }; });
  mock.invoke.mockReset();
  mock.invoke.mockImplementation(async name => {
    if (name === 'gc-proxy') return { data: { _proxy: { ok: true }, data: mock.budget }, error: null };
    mock.batch.auvo_task_id = '123'; return { data: { batch: mock.batch }, error: null };
  });
});

describe('escolha de tarefa Auvo por OS parcial', () => {
  it('começa marcada para cada nova abertura', () => {
    expect(DEFAULT_CREATE_PARTIAL_AUVO_TASK).toBe(true);
  });
  it.each([false, null, true])('permite solicitar pelo histórico após escolha %s, conferindo o orçamento primeiro', async choice => {
    mock.batch.auvo_task_requested = choice;
    const before = structuredClone(mock.items);
    expect(canRequestPartialAuvoTask(mock.batch, mock.operation)).toBe(true);
    await createBatchAuvoTask('batch', undefined, { requestIfMissing: true });
    expect(mock.invoke).toHaveBeenNthCalledWith(1, 'gc-proxy', { body: { path: '/api/orcamentos/budget', method: 'GET', payload: undefined } });
    expect(mock.rpc).toHaveBeenCalledWith('partial_writeoff_request_auvo_task', { p_batch_id: 'batch' });
    expect(mock.invoke.mock.invocationCallOrder[0]).toBeLessThan(mock.rpc.mock.invocationCallOrder[0]);
    expect(mock.rpc.mock.invocationCallOrder[0]).toBeLessThan(mock.invoke.mock.invocationCallOrder[1]);
    expect(mock.batch).toMatchObject({ auvo_task_requested: true, auvo_task_id: '123' });
    expect(mock.items).toEqual(before);
    await createBatchAuvoTask('batch', undefined, { requestIfMissing: true });
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.invoke).toHaveBeenCalledTimes(2);
  });
  it('bloqueia a solicitação posterior quando a quantidade no orçamento original mudou', async () => {
    mock.budget.produtos[0].produto.quantidade = '4';
    await expect(createBatchAuvoTask('batch', undefined, { requestIfMissing: true })).rejects.toThrow('Orçamento alterado');
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.batch.auvo_task_requested).toBe(false);
  });
  it('não cria tarefa se a solicitação posterior foi recusada pelo banco', async () => {
    mock.rpc.mockResolvedValue({ error: { message: 'Configure o usuário Auvo' } });
    await expect(createBatchAuvoTask('batch', undefined, { requestIfMissing: true })).rejects.toThrow('Configure');
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.batch.auvo_task_id).toBeNull();
  });
  it('mantém a solicitação posterior para repetir quando o Auvo falha', async () => {
    mock.invoke.mockImplementation(async name => name === 'gc-proxy'
      ? { data: { _proxy: { ok: true }, data: mock.budget }, error: null }
      : { data: { error: 'Auvo indisponível' }, error: null });
    await expect(createBatchAuvoTask('batch', undefined, { requestIfMissing: true })).rejects.toThrow('Auvo indisponível');
    expect(mock.batch).toMatchObject({ auvo_task_requested: true, auvo_task_id: null, auvo_task_error: 'Auvo indisponível' });
    expect(canRequestPartialAuvoTask(mock.batch, mock.operation)).toBe(true);
  });
  it.each(['completed', 'cancelled', 'consolidating'])('não oferece nem cria tarefa em operação %s', async status => {
    mock.operation.status = status;
    expect(canRequestPartialAuvoTask(mock.batch, mock.operation)).toBe(false);
    await expect(createBatchAuvoTask('batch', undefined, { requestIfMissing: true })).rejects.toThrow('não está disponível');
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each(['reservation', 'partial_execution'])('não chama o Auvo quando desmarcado em %s', async flow => {
    mock.flowMode = flow;
    await expect(createBatchAuvoTask('batch')).rejects.toThrow('sem solicitar');
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it.each(['reservation', 'partial_execution'])('cria quando marcado em %s e reutiliza o vínculo existente', async flow => {
    mock.flowMode = flow; mock.batch.auvo_task_requested = true;
    await createBatchAuvoTask('batch');
    expect(mock.invoke).toHaveBeenCalledWith('partial-writeoff', { body: { action: 'create_batch_task', batch_id: 'batch', auvo_customer_id: undefined } });
    await createBatchAuvoTask('batch');
    expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it('mantém a opção solicitada e registra falha para o histórico', async () => {
    mock.batch.auvo_task_requested = true;
    mock.invoke.mockResolvedValue({ data: { error: 'Cliente Auvo não localizado' }, error: null });
    await expect(createBatchAuvoTask('batch')).rejects.toThrow('Cliente Auvo');
    expect(mock.batch).toMatchObject({ auvo_task_requested: true, auvo_task_id: null, auvo_task_error: 'Cliente Auvo não localizado' });
  });
  it('não declara sucesso se o servidor não confirmou o vínculo', async () => {
    mock.batch.auvo_task_requested = true;
    mock.invoke.mockResolvedValue({ data: {}, error: null });
    await expect(createBatchAuvoTask('batch')).rejects.toThrow('ainda não foi confirmada');
  });
  it('não cria em documento cancelado', async () => {
    mock.batch.auvo_task_requested = true; mock.batch.status = 'cancelled';
    await expect(createBatchAuvoTask('batch')).rejects.toThrow('não está disponível');
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it('lote cancelado não deixa uma solicitação de tarefa pendente bloqueando a operação', () => {
    expect(() => assertRequestedAuvoTasksLinked([{ status: 'cancelled', auvo_task_requested: true, auvo_task_id: null }])).not.toThrow();
  });
  it('preserva a interpretação dos lotes históricos sem escolha registrada', () => {
    expect(wantsPartialAuvoTask({ auvo_task_requested: null }, 'reservation')).toBe(false);
    expect(wantsPartialAuvoTask({}, 'partial_execution')).toBe(true);
  });
});
