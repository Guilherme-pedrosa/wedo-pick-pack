import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUDGET_GENERATION_VERSION, documentLabelForBudget } from '../../supabase/functions/_shared/budgetKind';
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mock.invoke } } }));
import { assertBudgetGenerationReady, readBudgetGenerationSource } from './budgetGeneration';

beforeEach(() => { mock.invoke.mockReset(); });
describe('geração pelo tipo cadastrado no GC', () => {
  it('mostra o destino conforme o tipo e não presume OS para um orçamento ainda não identificado', () => {
    expect(documentLabelForBudget('produto')).toBe('Venda');
    expect(documentLabelForBudget('servico')).toBe('OS');
    expect(documentLabelForBudget()).toBe('documento');
  });
  it('bloqueia o servidor antigo antes de enviar dados para geração', async () => {
    mock.invoke.mockResolvedValue({ data: { error: 'Missing orcamento or auvo_user_id' }, error: new Error('HTTP 400') });
    await expect(assertBudgetGenerationReady()).rejects.toThrow('Nenhum documento ou tarefa foi criado');
    expect(mock.invoke).toHaveBeenCalledExactlyOnceWith('generate-os', { body: { action: 'generation_rules' } });
  });
  it('libera somente a versão que confirma o tipo de orçamento no servidor', async () => {
    mock.invoke.mockResolvedValue({ data: { version: BUDGET_GENERATION_VERSION }, error: null });
    await expect(assertBudgetGenerationReady()).resolves.toBeUndefined();
  });
  it('6668 é produto mesmo com serviço gratuito; as linhas recebidas permanecem intactas', async () => {
    const budget = { id: '397913178', codigo: '6668', valor_servicos: '0.00', servicos: [{ servico: { quantidade: '6.0000', desconto_porcentagem: '100.0000' } }] };
    mock.invoke.mockImplementation(async (_name, { body }) => ({ error: null,
      data: { _proxy: { ok: true }, data: body.path.startsWith('/api/orcamentos/') ? budget : body.path.includes('orcamentos_produtos') ? [budget] : [], meta: { total_paginas: 1 } },
    }));
    const source = await readBudgetGenerationSource(budget.id);
    expect(source).toEqual({ kind: 'produto', documentKind: 'venda', budget });
    expect(mock.invoke.mock.calls.every(([name, { body }]) => name === 'gc-proxy' && body.method === 'GET')).toBe(true);
  });
});
