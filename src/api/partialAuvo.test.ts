import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wantsPartialAuvoTask } from '../../supabase/functions/_shared/partialAuvo';

const mock = vi.hoisted(() => ({
  batch: {} as any, flowMode: 'reservation',
  invoke: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: mock.invoke },
  from: (table: string) => {
    let patch: any;
    const result = (many = false) => {
      if (patch) Object.assign(mock.batch, patch);
      return { data: table === 'partial_writeoff_batches' ? (many ? [mock.batch] : mock.batch)
        : table === 'partial_writeoff_operations' ? { id: 'op', flow_mode: mock.flowMode }
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
  mock.batch = { id: 'batch', operation_id: 'op', status: 'awaiting_checkout', auvo_task_requested: false, auvo_task_id: null };
  mock.flowMode = 'reservation';
  mock.invoke.mockReset();
  mock.invoke.mockImplementation(async () => { mock.batch.auvo_task_id = '123'; return { data: { batch: mock.batch }, error: null }; });
});

describe('escolha de tarefa Auvo por OS parcial', () => {
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
  it('preserva a interpretação dos lotes históricos sem escolha registrada', () => {
    expect(wantsPartialAuvoTask({ auvo_task_requested: null }, 'reservation')).toBe(false);
    expect(wantsPartialAuvoTask({}, 'partial_execution')).toBe(true);
  });
});
