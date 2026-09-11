import { describe, expect, it } from 'vitest';
import { scanPurchases, purchaseCatalog } from '../../supabase/functions/_shared/purchaseScan';
import { readPartialPurchaseOperations } from '../../supabase/functions/_shared/partialPurchaseOperations';
import type { PartialWriteoffOperation } from './partialWriteoff';
import type { GcRecord } from './partialExecution';

function operation(quantity = 10, withdrawn = 4, reserved = 0): PartialWriteoffOperation {
  return { id: 'op1', budget_id: 'budget1', budget_code: '6345', client_id: 'client', client_name: 'Cliente', document_type: 'os',
    status: 'awaiting_balance', budget_snapshot: {}, definitive_document_id: null, definitive_document_code: null,
    definitive_auvo_task_id: null, reconciliation_reason: null, version: 1, created_at: '2026-01-01', updated_at: '2026-01-01', completed_at: null,
    items: [{ id: 'i1', operation_id: 'op1', line_key: 'p1', product_id: 'p1', variation_id: 'default-variant', product_name: 'Peça', product_code: 'P1', unit: 'UN',
      original_quantity: quantity, withdrawn_quantity: withdrawn, reserved_quantity: reserved, pending_purchase_quantity: quantity - withdrawn,
      available_to_reserve_quantity: quantity - withdrawn - reserved, global_reserved_quantity: reserved, reserved_other_operations_quantity: 0,
      line_snapshot: { produto: { possui_variacao: '0' } } }],
    batches: [{ id: 'b1', operation_id: 'op1', sequence: 1, marker: 'PP-PARCIAL', status: 'confirmed', auxiliary_document_type: 'os',
      auxiliary_document_id: 'aux', auxiliary_document_code: '10000', error_message: null, auvo_task_id: 'auvo1', auvo_task_error: null, created_at: '2026-01-01', confirmed_at: '2026-01-01' }] };
}
const line = (quantity: number, variationId = 'default-variant') => ({ produto: { produto_id: 'p1', variacao_id: variationId, quantidade: quantity, possui_variacao: '0' } });
function fixture(ops = [operation()]) {
  const records: Record<string, GcRecord[]> = {
    orcamentos: [{ id: 'budget1', codigo: '6345', situacao_id: 'baixa-parcial', situacao_estoque: '1', produtos: [line(10)] }],
    compras: [],
    ordens_servicos: [{ id: 'aux', codigo: '10000', nome_situacao: 'PEDIDO EM CONFERENCIA', situacao_estoque: '0', produtos: [line(4)],
      atributos: [{ atributo: { descricao: 'ORCAMENTO', conteudo: '6345' } }] }],
  };
  const detail: GcRecord = { id: 'p1', nome: 'Peça', possui_variacao: '0', estoque: 0, valor_custo: 10, movimenta_estoque: '1' };
  const gc = async (path: string) => {
    const name = path.split('/api/')[1].split('?')[0];
    if (name === 'produtos/p1') return { data: detail };
    const data = records[name];
    if (!data) throw new Error(`Consulta inesperada ${path}`);
    return { data, meta: { total_paginas: data.length ? 1 : 0, pagina_atual: 1, total_registros: data.length } };
  };
  const ports = { gc, partials: async () => ops };
  return { records, detail, ops, ports, scan: (statuses = ['aprovado']) => scanPurchases(ports, statuses, ['aberto']) };
}

describe('compras com saldos de baixas parciais', () => {
  it('mantém saldo fora do filtro e com flag de conversão/OS auxiliar, sem recomprar o retirado', async () => {
    const f = fixture(), before = JSON.stringify(f.ops);
    const result = await f.scan();
    expect(result.itensList).toHaveLength(1);
    expect(result.itensList[0]).toMatchObject({ qtd_necessaria: 6, qtd_efetiva_a_comprar: 6, estoque_reservado_os: 0 });
    expect(result.itensList[0].orcamentos[0]).toMatchObject({ codigo: '6345', qtd: 6, partial_operation_id: 'op1' });
    expect(result.orcamentosConvertidos).toEqual([]);
    expect(JSON.stringify(f.ops)).toBe(before);
  });
  it('inclui vendas e baixas em reconciliação mesmo sem nenhum filtro ou orçamento remoto', async () => {
    const f = fixture(); f.ops[0].budget_id = 'venda:379827387'; f.ops[0].status = 'reconciliation_required'; f.records.orcamentos = [];
    const result = await f.scan([]);
    expect(result.itensList[0].orcamentos[0]).toMatchObject({ source_kind: 'venda', qtd: 6 });
    expect(result.partialOperationsIncluded).toBe(1);
  });
  it('não duplica demanda quando a baixa também está no filtro nem depende das linhas atuais do orçamento', async () => {
    const f = fixture(); f.records.orcamentos[0].produtos = [];
    const result = await f.scan(['baixa-parcial']);
    expect(result.itensList[0].qtd_necessaria).toBe(6);
  });
  it('desconta pedido parcial, mas mantém o saldo sem pedido em A comprar', async () => {
    const f = fixture(); f.detail.estoque = 1;
    f.records.compras = [{ id: 'c1', codigo: '4000', situacao_id: 'aberto', nome_situacao: 'COMPRADO - AG CHEGADA', situacao_estoque: '0', produtos: [line(2)] }];
    const result = await f.scan();
    expect(result.itensList[0]).toMatchObject({ qtd_necessaria: 6, qtd_a_comprar: 5, qtd_ja_em_compra: 2, qtd_efetiva_a_comprar: 3 });
    f.records.compras[0].produtos = [line(5)];
    expect((await f.scan()).itensCobertosporPedido[0].qtd_efetiva_a_comprar).toBe(0);
    f.records.compras[0].nome_situacao = 'CANCELADO';
    expect((await f.scan()).itensList[0].qtd_efetiva_a_comprar).toBe(5);
  });
  it('não usa pedido recebido como cobertura novamente; desconta só a parte não recebida', async () => {
    const f = fixture(); f.records.compras = [{ id: 'c1', situacao_id: 'aberto', nome_situacao: 'COMPRADO - AG CHEGADA', situacao_estoque: '1', produtos: [line(6)] }];
    expect((await f.scan()).itensList[0].qtd_ja_em_compra).toBe(0);
    f.records.compras[0].situacao_estoque = '0';
    f.records.compras[0].produtos[0].produto.quantidade_recebida = 4;
    expect((await f.scan()).itensList[0].qtd_ja_em_compra).toBe(2);
  });
  it('mantém demanda conjunta sem aplicar o mesmo estoque/pedido duas vezes', async () => {
    const other = operation(5, 0); other.id = 'op2'; other.budget_id = 'venda:2'; other.budget_code = '2604'; other.items[0].id = 'i2';
    const f = fixture([operation(), other]); f.detail.estoque = 3;
    f.records.compras = [{ id: 'c1', situacao_id: 'aberto', nome_situacao: 'COMPRADO - AG CHEGADA', produtos: [line(2), line(1)] }];
    const result = await f.scan();
    expect(result.itensList).toHaveLength(1);
    expect(result.itensList[0]).toMatchObject({ qtd_necessaria: 11, qtd_ja_em_compra: 3, qtd_efetiva_a_comprar: 5 });
    expect(result.itensList[0].ordens_compra[0].qtd).toBe(3);
  });
  it('retirada pelo técnico e OS já baixada não comprometem; OS válida sem saída compromete', async () => {
    const f = fixture(); f.detail.estoque = 3;
    f.records.ordens_servicos.push(
      { id: 's1', nome_situacao: 'RETIRADA PELO TECNICO', situacao_estoque: '1', produtos: [line(20)] },
      { id: 's2', nome_situacao: 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO', situacao_estoque: '1', produtos: [line(20)] },
      { id: 's3', nome_situacao: 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO', situacao_estoque: '0', produtos: [line(5)] });
    expect((await f.scan()).itensList[0]).toMatchObject({ estoque_reservado_os: 5, qtd_efetiva_a_comprar: 8 });
  });
  it('protege reserva local sem repetir a reserva na demanda pendente', async () => {
    const f = fixture([operation(10, 4, 2)]); f.detail.estoque = 3;
    expect((await f.scan()).itensList[0]).toMatchObject({ qtd_necessaria: 4, estoque_reservado_os: 2, qtd_efetiva_a_comprar: 3 });
  });
  it('não usa estoque nem pedido de outra variação', async () => {
    const f = fixture(); f.detail.possui_variacao = '1'; f.detail.estoque = 50;
    f.detail.variacoes = [{ variacao: { id: 'default-variant', estoque: 1 } }, { variacao: { id: 'outra', estoque: 49 } }];
    f.records.compras = [{ id: 'c1', situacao_id: 'aberto', nome_situacao: 'COMPRADO - AG CHEGADA', produtos: [line(20, 'outra')] }];
    expect((await f.scan()).itensList[0]).toMatchObject({ estoque_atual: 1, qtd_ja_em_compra: 0, qtd_efetiva_a_comprar: 5 });
    f.detail.variacoes = [{ variacao: { id: 'outra', estoque: 50 } }];
    await expect(f.scan()).rejects.toThrow('Estoque da variação');
  });
  it('saldo zerado não gera recompra e operações concluídas/canceladas saem da demanda', async () => {
    const f = fixture([operation(10, 10)]); f.records.ordens_servicos = [];
    expect((await f.scan()).itensList).toEqual([]);
    for (const status of ['completed', 'cancelled'] as const) {
      f.ops[0] = operation(); f.ops[0].status = status;
      expect((await f.scan()).partialOperationsIncluded).toBe(0);
    }
  });
  it('não publica lista incompleta quando a leitura falha ou a baixa muda durante o cálculo', async () => {
    const f = fixture(); let reads = 0;
    f.ports.partials = async () => { reads++; return structuredClone(f.ops).map(o => ({ ...o, version: reads })); };
    await expect(f.scan()).rejects.toThrow('Uma baixa mudou');
    f.ports.partials = async () => { throw Error('Banco indisponível'); };
    await expect(f.scan()).rejects.toThrow('Banco indisponível');
    await expect(readPartialPurchaseOperations({ from: () => ({ select: () => ({ not: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'erro' } }) }) }) }) }) })).rejects.toThrow('todos os saldos');
  });
  it('recusa paginação truncada em vez de omitir documentos da lista', async () => {
    await expect(purchaseCatalog(async () => ({ data: [], meta: { total_paginas: 1, total_registros: 2, pagina_atual: 1 } }), '/api/compras')).rejects.toThrow('Registros ausentes');
  });
});
