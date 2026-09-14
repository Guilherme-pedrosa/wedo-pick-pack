import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { GCOrdemServico } from './types';
import type { SeparationRecord } from './separations';

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), from: vi.fn(), log: vi.fn() }));
vi.mock('./gestaoclick', () => ({ getOS: mocks.get, getVenda: mocks.get, updateOSStatus: mocks.update, updateVendaStatus: mocks.update }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: mocks.from, auth: { getUser: async () => ({ data: { user: { id: 'operator' } } }) },
} }));
vi.mock('@/lib/systemLog', () => ({ logSystemAction: mocks.log }));
import { assignSeparationToTechnician } from './separationAssignment';
import { returnSeparationForAgenda } from './separationReturn';
import { cacheConfirmedAgendaOrder, mergeSeparationStatuses } from './separationStatusCache';
import { hasConfirmedTechnicianCustody } from './agendaControl';

let saved: SeparationRecord;
let client: QueryClient;
let current: GCOrdemServico;
const technician = { gc_id: 'new-tech', name: 'Novo técnico' };
const originalItems = [{ product_id: 'p', variation_id: 'v', code: 'part', name: 'Peça', unit: 'UN', expected_quantity: 2, confirmed_quantity: 2 }];

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  saved = { id: 'sep', order_id: 'order-1', order_code: '123', order_type: 'os', technician_gc_id: 'old-tech',
    technician_name: 'Técnico anterior', invalidated: false, items: structuredClone(originalItems) } as SeparationRecord;
  current = { id: 'order-1', codigo: '123', situacao_id: '7063705', nome_situacao: 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO', produtos: [] } as GCOrdemServico;
  mocks.get.mockImplementation(async () => structuredClone(current));
  mocks.update.mockImplementation(async (_id, _order, status) => ({ ...current, situacao_id: status,
    nome_situacao: status === '7684665' ? 'RETIRADA PELO TECNICO' : 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO' }));
  mocks.from.mockImplementation((table: string) => {
    const filters: Array<[string, unknown]> = [];
    let patch: Record<string, unknown> | undefined;
    const builder = {
      select: () => builder,
      update: (value: Record<string, unknown>) => { patch = value; return builder; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
      maybeSingle: async () => ({ data: table === 'profiles' ? { name: 'Operador' } : structuredClone(saved), error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        const matches = filters.every(([key, value]) => (saved as any)[key] === value);
        if (matches && patch) Object.assign(saved, patch);
        return Promise.resolve({ data: matches ? [{ id: saved.id }] : [], error: null }).then(resolve);
      },
    };
    return builder;
  });
});
afterEach(() => client.clear());

describe('vínculo, devolução e situação exibida', () => {
  it('a consulta em lote do histórico não sobrepõe uma confirmação mais recente', () => {
    const confirmed = { situacao_id: '7684665', nome_situacao: 'RETIRADA PELO TECNICO', fetchedAt: '2026-09-14T12:43:00Z' };
    const old = { ...confirmed, situacao_id: '7063705', fetchedAt: '2026-09-14T12:40:00Z' };
    expect(mergeSeparationStatuses({ one: confirmed, two: old }, { one: old, two: confirmed }, Date.parse('2026-09-14T12:41:00Z')))
      .toEqual({ one: confirmed, two: confirmed });
  });
  it('atualiza apenas a OS confirmada no GC e mantém os itens após vincular', async () => {
    const untouched = { ...current, id: 'another-order' };
    client.setQueryData(['agenda-open-orders'], [current, untouched]);
    await assignSeparationToTechnician({ separation: structuredClone(saved), technician, items: originalItems,
      onStatusConfirmed: order => cacheConfirmedAgendaOrder(client, order) });
    const rows = client.getQueryData<GCOrdemServico[]>(['agenda-open-orders'])!;
    expect(rows[0]).toMatchObject({ situacao_id: '7684665', nome_situacao: 'RETIRADA PELO TECNICO' });
    expect(rows[1]).toEqual(untouched);
    expect(saved).toMatchObject({ technician_gc_id: 'new-tech', invalidated: false, items: originalItems });
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('order-1');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(hasConfirmedTechnicianCustody({ os: rows[0], separation: saved })).toBe(true);
  });

  it('não salva vínculo nem exibe sucesso quando o GC recusa a situação', async () => {
    const before = structuredClone(saved);
    mocks.update.mockRejectedValue(new Error('STATUS_NOT_APPLIED'));
    const confirmed = vi.fn();
    await expect(assignSeparationToTechnician({ separation: before, technician, items: originalItems,
      onStatusConfirmed: confirmed })).rejects.toThrow('STATUS_NOT_APPLIED');
    expect(saved).toEqual(before);
    expect(confirmed).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it('devolução por agenda encerra custódia, preserva a conferência e registra o responsável anterior', async () => {
    current = { ...current, situacao_id: '7684665', nome_situacao: 'RETIRADA PELO TECNICO' };
    client.setQueryData(['agenda-open-orders'], [current]);
    await returnSeparationForAgenda({ separation: structuredClone(saved), reason: 'Não deu tempo',
      onStatusConfirmed: order => cacheConfirmedAgendaOrder(client, order) });
    expect(saved).toMatchObject({ technician_gc_id: null, technician_name: null, invalidated: false, items: originalItems });
    expect(client.getQueryData<GCOrdemServico[]>(['agenda-open-orders'])![0].situacao_id).toBe('7063705');
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'devolucao_agenda', details: expect.objectContaining({
      previous_technician_gc_id: 'old-tech', previous_technician_name: 'Técnico anterior', technician_released: true,
    }) }));
  });

  it('falha no GC durante a devolução conserva a custódia e as peças', async () => {
    const before = structuredClone(saved);
    mocks.update.mockRejectedValue(new Error('GC indisponível'));
    const confirmed = vi.fn();
    await expect(returnSeparationForAgenda({ separation: before, reason: 'Agenda', onStatusConfirmed: confirmed })).rejects.toThrow('GC indisponível');
    expect(saved).toEqual(before);
    expect(confirmed).not.toHaveBeenCalled();
  });

  it.each(['retirada', 'devolução'])('uma tela antiga não altera o GC após outra pessoa trocar o técnico: %s', async action => {
    const stale = structuredClone(saved);
    saved.technician_gc_id = 'someone-else';
    const work = action === 'retirada'
      ? assignSeparationToTechnician({ separation: stale, technician, items: originalItems })
      : returnSeparationForAgenda({ separation: stale, reason: 'Agenda', onStatusConfirmed: vi.fn() });
    await expect(work).rejects.toThrow('outra pessoa');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(saved.technician_gc_id).toBe('someone-else');
  });

  it('não apaga um novo vínculo gravado enquanto o GC confirmava a devolução', async () => {
    await expect(returnSeparationForAgenda({ separation: structuredClone(saved), reason: 'Agenda',
      onStatusConfirmed: () => { saved.technician_gc_id = 'someone-else'; saved.technician_name = 'Outro responsável'; },
    })).rejects.toThrow('vínculo mudou');
    expect(saved).toMatchObject({ technician_gc_id: 'someone-else', items: originalItems, invalidated: false });
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ technician_released: false }) }));
  });

  it('não apresenta vínculo antigo como peças com o técnico após devolução ou execução', () => {
    expect(hasConfirmedTechnicianCustody({ os: current, separation: saved })).toBe(false);
    expect(hasConfirmedTechnicianCustody({ os: { ...current, situacao_id: 'executado' }, separation: saved })).toBe(false);
    expect(hasConfirmedTechnicianCustody({ os: { ...current, situacao_id: '7684665' }, separation: saved })).toBe(true);
    expect(hasConfirmedTechnicianCustody({ os: { ...current, situacao_id: '7684665' }, separation: { ...saved, invalidated: true } })).toBe(false);
  });

  it('a consulta antiga em andamento não restaura a situação anterior após confirmação', async () => {
    client.setQueryData(['agenda-open-orders'], [current]);
    let finish!: (rows: GCOrdemServico[]) => void;
    const pending = client.fetchQuery({ queryKey: ['agenda-open-orders'], queryFn: () => new Promise<GCOrdemServico[]>(resolve => { finish = resolve; }) }).catch(() => undefined);
    const confirmed = { ...current, situacao_id: '7684665', nome_situacao: 'RETIRADA PELO TECNICO' };
    await cacheConfirmedAgendaOrder(client, confirmed);
    finish([current]);
    await pending;
    expect(client.getQueryData(['agenda-open-orders'])).toEqual([confirmed]);
  });

  it('remove da agenda uma OS que saiu das situações abertas sem preencher uma fila que nunca foi carregada', async () => {
    await cacheConfirmedAgendaOrder(client, current);
    expect(client.getQueryData(['agenda-open-orders'])).toBeUndefined();
    client.setQueryData(['agenda-open-orders'], [current]);
    await cacheConfirmedAgendaOrder(client, { ...current, situacao_id: '8928768' });
    expect(client.getQueryData(['agenda-open-orders'])).toEqual([]);
    await cacheConfirmedAgendaOrder(client, current);
    expect(client.getQueryData(['agenda-open-orders'])).toEqual([current]);
  });
});
