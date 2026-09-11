import { describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { scanPartialStock, strictProductStock, type PartialStockPorts } from './partialStockOpportunities';
import { pendingOsLines } from './osStockCommitments';
import type { PartialWriteoffOperation } from './partialWriteoff';

function operation(id: string, requested = 3, withdrawn = 0, reserved = 0, productId = 'p', variationId = ''): PartialWriteoffOperation {
  const line = { produto: { produto_id: productId, variacao_id: variationId, possui_variacao: variationId ? '1' : '0',
    quantidade: String(requested), valor_venda: '10', movimenta_estoque: '1', nome_produto: 'Peça' } };
  return { id, budget_id: `budget-${id}`, budget_code: id, client_id: 'c', client_name: 'Cliente', document_type: 'os', status: 'awaiting_balance',
    created_at: id, updated_at: id, completed_at: null, version: 1, batches: [],
    definitive_document_id: null, definitive_document_code: null, definitive_auvo_task_id: null, reconciliation_reason: null,
    budget_snapshot: { id: `budget-${id}`, cliente_id: 'c', valor_total: String(requested * 10), produtos: [line], servicos: [], observacoes: 'Condições originais' },
    items: [{ id: `item-${id}`, operation_id: id, line_key: `${productId}::${variationId}::0`, product_id: productId, variation_id: variationId, product_name: 'Peça', product_code: '', unit: 'UN',
      original_quantity: requested, withdrawn_quantity: withdrawn, reserved_quantity: reserved, line_snapshot: line,
      pending_purchase_quantity: requested - withdrawn, available_to_reserve_quantity: requested - withdrawn - reserved,
      global_reserved_quantity: reserved, reserved_other_operations_quantity: 0 }],
  };
}
function fixture(operations: PartialWriteoffOperation[], stock = 3) {
  const requests: string[] = [];
  const ports: PartialStockPorts = {
    operations: async () => structuredClone(operations),
    commitments: async () => [],
    gc: async path => {
      requests.push(path);
      if (path.startsWith('/api/produtos/')) return { data: { id: path.split('/').at(-1)!.split('?')[0], estoque: stock, codigo_interno: '123' } };
      const op = operations.find(o => path.endsWith(o.budget_id));
      if (!op) throw new Error('Documento não encontrado');
      return { data: structuredClone(op.budget_snapshot) };
    },
  };
  return { ports, requests };
}

describe('varredura de oportunidades de baixa parcial', () => {
  it('mostra somente o saldo ainda pendente e não altera documentos ou quantidades', async () => {
    const op = operation('6438', 5, 2); const before = structuredClone(op); const f = fixture([op]);
    const result = await scanPartialStock(f.ports);
    expect(result.opportunities[0]).toMatchObject({ budgetCode: '6438', pendingQuantity: 3, suggestedQuantity: 3, stockQuantity: 3 });
    expect(result.issues).toEqual([]);
    expect(op).toEqual(before);
    expect(f.requests.every(p => /^\/api\/(orcamentos|produtos)\//.test(p))).toBe(true);
  });
  it('não promete a mesma peça a duas operações e prioriza a mais antiga', async () => {
    const newer = operation('2', 4), older = operation('1', 4); const f = fixture([newer, older], 5);
    const result = await scanPartialStock(f.ports);
    expect(result.opportunities.map(i => [i.budgetCode, i.suggestedQuantity])).toEqual([['1', 4], ['2', 1]]);
    expect(result.opportunities[1].allocatedEarlier).toBe(4);
    expect(f.requests.filter(p => p.startsWith('/api/produtos/'))).toHaveLength(1);
  });
  it('desconta reservas locais e apenas OS autorizadas sem baixa de estoque', async () => {
    const op = operation('1', 5, 1, 1); const f = fixture([op], 4);
    const os = { id: 'os', codigo: '10', nome_situacao: 'PEDIDO EM CONFERENCIA', situacao_estoque: '0', produtos: [{ produto: { produto_id: 'p', quantidade: '2', possui_variacao: '0' } }] };
    f.ports.commitments = async () => [...pendingOsLines(os), ...pendingOsLines({ ...os, id: 'retirada', nome_situacao: 'RETIRADA PELO TECNICO', situacao_estoque: '1' })];
    const result = await scanPartialStock(f.ports);
    expect(result.opportunities[0]).toMatchObject({ committedQuantity: 3, suggestedQuantity: 1, pendingQuantity: 3 });
  });
  it('respeita o estoque de cada variação, mesmo quando o produto é o mesmo', async () => {
    const f = fixture([operation('1', 2, 0, 0, 'p', 'v1'), operation('2', 2, 0, 0, 'p', 'v2')]);
    const gc = f.ports.gc;
    f.ports.gc = path => path.startsWith('/api/produtos/') ? Promise.resolve({ data: { id: 'p', estoque: 20,
      variacoes: [{ variacao: { id: 'v1', estoque: 0 } }, { variacao: { id: 'v2', estoque: 2 } }] } }) : gc(path);
    const result = await scanPartialStock(f.ports);
    expect(result.opportunities.map(i => [i.variationId, i.suggestedQuantity])).toEqual([['v2', 2]]);
    expect(() => strictProductStock({ data: { id: 'p', estoque: 50, variacoes: [] } }, 'p', 'missing')).toThrow('variação');
  });
  it('impede sugestão quando o orçamento atual diverge da referência preservada', async () => {
    const f = fixture([operation('1')]); const gc = f.ports.gc;
    f.ports.gc = async path => { const response = await gc(path); if (path.includes('orcamentos')) response.data.produtos[0].produto.quantidade = '1'; return response; };
    const result = await scanPartialStock(f.ports);
    expect(result.opportunities).toEqual([]);
    expect(result.issues[0].message).toContain('diverge');
    expect(f.requests.some(p => p.includes('produtos'))).toBe(false);
  });
  it('não transforma falha de consulta ou estoque ausente em disponibilidade', async () => {
    const f = fixture([operation('1')]);
    f.ports.commitments = async () => { throw new Error('Consulta global incompleta'); };
    await expect(scanPartialStock(f.ports)).rejects.toThrow('incompleta');
    expect(() => strictProductStock({ data: { id: 'p' } }, 'p', '')).toThrow('não informado');
    expect(() => strictProductStock({ data: { id: 'outro', estoque: 10 } }, 'p', '')).toThrow('não confirmado');
  });
  it('descarta sugestões quando as quantidades mudam durante a consulta', async () => {
    const op = operation('1'), f = fixture([op]); let calls = 0;
    f.ports.operations = async () => [{ ...op, version: ++calls }];
    await expect(scanPartialStock(f.ports)).rejects.toThrow('mudaram durante');
  });
  it('não sugere nova baixa de itens já retirados ou reservados integralmente', async () => {
    const f = fixture([operation('1', 3, 3), operation('2', 3, 1, 2)], 100);
    f.ports.commitments = vi.fn();
    const result = await scanPartialStock(f.ports);
    expect(result.opportunities).toEqual([]);
    expect(f.ports.commitments).not.toHaveBeenCalled();
  });
});
