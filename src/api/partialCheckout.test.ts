import { describe, expect, it, vi } from 'vitest';
import { applyPartialCheckoutStatus, partialCheckoutTarget, type PartialCheckoutPolicy } from '../../supabase/functions/_shared/partialCheckout';

const basePolicy: PartialCheckoutPolicy = { type: 'os', flowMode: 'partial_execution', waitingStatusId: 'waiting', stockStatusId: 'reserve', cancelStatusId: 'cancel', conclusionStatusId: 'ready' };
const statuses = vi.fn(async () => [{ id: 'ready', nome: 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO' }, { id: '7063705', nome: 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO' }, { id: 'done', nome: 'EXECUTADO' }, { id: 'reserve', nome: 'Baixa pra reserva de peças - Aguardando Compra' }]);
const doc = (status = 'waiting', stock = '0') => ({ id: 'os', cliente_id: 'client', situacao_id: status, nome_situacao: status, situacao_estoque: stock, produtos: [{ produto: { produto_id: 'p', quantidade: '2' } }], servicos: [{ servico: { servico_id: 's', quantidade: '8' } }], atributos: [{ atributo: { atributo_id: '73344', conteudo: '79346292' } }, { atributo: { atributo_id: '73897', conteudo: '26' } }] });

describe.each(['partial_execution', 'reservation'] as const)('situação GC do checkout de OS (%s)', flowMode => {
  const policy = { ...basePolicy, flowMode };
  it.each(['waiting', 'reserve', '7063581'])('encaminha %s para aguardando execução', async status => {
    expect(await partialCheckoutTarget(doc(status), policy, statuses)).toBe('ready');
  });
  it('usa a situação normal quando o operador não tem padrão configurado', async () => {
    expect(await partialCheckoutTarget(doc(), { ...policy, conclusionStatusId: '' }, statuses)).toBe('7063705');
  });
  it.each(['done', 'reserve', 'missing'])('não usa configuração insegura/ausente %s', async conclusionStatusId => {
    await expect(partialCheckoutTarget(doc(), { ...policy, conclusionStatusId }, statuses)).rejects.toThrow('Configure');
  });
  it.each(['RETIRADA PELO TECNICO', 'EXECUTADO', 'CHAMADO FECHADO - FATURADO', 'AGUARDANDO FINALIZACAO'])('preserva OS em %s', async name => {
    const catalog = vi.fn();
    expect(await partialCheckoutTarget({ ...doc('advanced', '1'), nome_situacao: name }, policy, catalog)).toBe('advanced');
    expect(catalog).not.toHaveBeenCalled();
  });
  it('não encaminha status desconhecido sem estoque comprovado', async () => {
    await expect(partialCheckoutTarget(doc('advanced'), policy, statuses)).rejects.toThrow('mudou de situação');
  });
  it.each(['cancel', 'CANCELADA'])('bloqueia cancelamento %s', async status => {
    await expect(partialCheckoutTarget(doc(status, '1'), policy, statuses)).rejects.toThrow('cancelado');
  });
  it('mantém o movimento de venda', async () => {
    const rule = { ...policy, type: 'venda' as const };
    expect(await partialCheckoutTarget(doc(), rule, statuses)).toBe('reserve');
    expect(await partialCheckoutTarget(doc('advanced', '1'), rule, statuses)).toBe('advanced');
  });
});

describe.each(['partial_execution', 'reservation'] as const)('retomada de situação sem repetir estoque (%s)', flowMode => {
  const policy = { ...basePolicy, flowMode };
  function fixture(initial = doc(), alreadyConfirmed = false) {
    let current = initial;
    const put = vi.fn(async (document, target) => { current = { ...document, situacao_id: target, situacao_estoque: '1' }; });
    const options = { policy, read: vi.fn(async () => structuredClone(current)), getStatuses: statuses, validate: vi.fn(), prepare: (d: any) => d, put, alreadyConfirmed };
    return { options, set: (value: typeof current) => { current = value; } };
  }
  it('baixa uma vez, preserva serviços/horas/vínculo Auvo e repetir não envia outro PUT', async () => {
    const { options } = fixture();
    const result = await applyPartialCheckoutStatus(options);
    expect(result).toMatchObject({ situacao_id: 'ready', produtos: doc().produtos, servicos: doc().servicos, atributos: doc().atributos });
    expect(await applyPartialCheckoutStatus({ ...options, alreadyConfirmed: true })).toEqual(result);
    expect(options.put).toHaveBeenCalledOnce();
  });
  it('corrige uma reserva já confirmada sem zerar o estoque antes', async () => {
    const { options } = fixture(doc('reserve', '1'), true);
    await applyPartialCheckoutStatus(options);
    expect(options.put).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ situacao_estoque: '1' }), 'ready');
  });
  it('releitura preserva uma retirada que ocorreu depois de abrir o modal', async () => {
    const { options } = fixture(doc('withdrawn', '1'));
    await applyPartialCheckoutStatus(options);
    expect(options.put).not.toHaveBeenCalled();
  });
  it('não repete baixa confirmada cujo estoque foi revertido', async () => {
    const { options } = fixture(doc('reserve'), true);
    await expect(applyPartialCheckoutStatus(options)).rejects.toThrow('estoque mudou');
    expect(options.put).not.toHaveBeenCalled();
  });
  it('recupera timeout depois de PUT aplicado sem reenviar', async () => {
    const { options, set } = fixture();
    options.put.mockImplementation(async () => { set(doc('ready', '1')); throw new Error('timeout'); });
    expect(await applyPartialCheckoutStatus(options)).toMatchObject({ situacao_id: 'ready' });
    expect(options.put).toHaveBeenCalledOnce();
  });
  it.each(['RETIRADA PELO TECNICO', 'EXECUTADO'])('preserva avanço concorrente para %s após o PUT', async name => {
    const { options, set } = fixture();
    options.put.mockImplementation(async () => { set({ ...doc('advanced', '1'), nome_situacao: name }); });
    expect(await applyPartialCheckoutStatus(options)).toMatchObject({ situacao_id: 'advanced', nome_situacao: name });
    expect(options.put).toHaveBeenCalledOnce();
  });
  it('não declara encaminhada uma OS que só teve estoque baixado', async () => {
    const { options, set } = fixture();
    options.put.mockImplementation(async () => { set(doc('reserve', '1')); });
    await expect(applyPartialCheckoutStatus(options)).rejects.toThrow('ainda não foi encaminhada');
  });
  it('detecta perda de vínculo, serviço ou horas após atualizar', async () => {
    const { options, set } = fixture();
    options.put.mockImplementation(async () => { set({ ...doc('ready', '1'), atributos: [] }); });
    await expect(applyPartialCheckoutStatus(options)).rejects.toThrow('alterou o campo');
  });
});
