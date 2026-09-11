import { describe, expect, it } from 'vitest';
import { assertDefinitiveContents, consolidateExecutedOs, definitivePayload, type ConsolidationPorts } from './partialConsolidation';
import type { PartialWriteoffOperation } from './partialWriteoff';

function fixture() {
  const budget: any = { id: 'b', codigo: '4784', cliente_id: 'c', valor_total: '250.00',
    produtos: [{ produto: { produto_id: 'p', nome_produto: 'Peça', quantidade: '2', valor_venda: '100.00' } }],
    servicos: [{ servico: { servico_id: 's', nome_servico: 'Instalação', quantidade: '1', valor_venda: '50.00' } }],
    observacoes_interna: 'Observação original', atributos: [{ atributo: { atributo_id: '73341', descricao: 'TAREFA OS', conteudo: '10' } }] };
  const operation = { id: 'op', budget_id: 'b', budget_code: '4784', client_id: 'c', document_type: 'os',
    status: 'awaiting_execution', budget_snapshot: budget, definitive_document_id: null, definitive_document_code: null,
    batches: [{ id: 'batch', status: 'confirmed', confirmed_at: '2026-09-11', auxiliary_document_id: 'aux', auxiliary_document_code: '10034', auvo_task_id: '20' }],
    execution_documents: [], items: [], version: 1 } as unknown as PartialWriteoffOperation;
  const aux: any = { ...structuredClone(budget), id: 'aux', codigo: '10034', situacao_id: 'executed',
    nome_situacao: 'EXECUTADO - AGUARDANDO NEGOCIAÇÃO FINANCEIRA', situacao_estoque: '1', observacoes_interna: 'Histórico do técnico' };
  const docs: Record<string, any> = { aux };
  const calls: string[] = [];
  let failFinal = false;
  let ambiguousPost = false;
  let corruptCreated = false;
  const ports: ConsolidationPorts = {
    reload: async () => structuredClone(operation), settings: async () => ({ os_waiting_status_id: 'waiting', os_cancel_status_id: 'cancel' }),
    rpc: async (name, p) => {
      calls.push(name);
      if (name === 'partial_writeoff_historical_tasks') return ['30'];
      if (name === 'partial_writeoff_record_execution') { operation.execution_documents = p.p_documents; operation.status = 'ready_to_consolidate'; }
      if (name === 'partial_writeoff_claim_consolidation') { operation.status = 'consolidating'; return 'consolidating'; }
      if (name === 'partial_writeoff_checkpoint') {
        operation.consolidation_stage = p.p_stage;
        if (p.p_document_id) { operation.definitive_document_id = p.p_document_id; operation.definitive_document_code = p.p_document_code; }
      }
      if (name === 'partial_writeoff_finish_consolidation') operation.status = p.p_success ? 'completed' : 'reconciliation_required';
    },
    gc: async (path, method = 'GET', payload: any) => {
      calls.push(`${method} ${path}`);
      if (path === '/api/situacoes_ordens_servicos') return { data: [{ id: 'executed', nome: aux.nome_situacao }] };
      if (path === '/api/atributos_ordens_servicos') return { data: [] };
      if (path === '/api/orcamentos/b') {
        if (method === 'PUT') Object.assign(budget, payload);
        return { data: structuredClone(budget) };
      }
      if (path.includes('?')) return { data: Object.values(docs).filter(d => String(d.observacoes_interna).includes('PP-CONSOLIDACAO-op')), meta: { total_paginas: 1, pagina_atual: 1 } };
      if (method === 'POST') {
        docs.final = { ...structuredClone(payload), id: 'final', codigo: '10139', situacao_estoque: '0', nome_situacao: 'PEDIDO EM CONFERENCIA' };
        if (corruptCreated) docs.final.produtos = [];
        if (ambiguousPost) throw new Error('Timeout após POST');
        return { data: { id: 'final', codigo: '10139' } };
      }
      const id = path.split('/').at(-1)!;
      if (method === 'PUT') {
        if (id === 'final' && failFinal) { failFinal = false; throw new Error('Falha de API'); }
        Object.assign(docs[id], structuredClone(payload));
        docs[id].situacao_estoque = payload.situacao_id === 'cancel' ? '0' : '1';
        docs[id].nome_situacao = payload.situacao_id === 'cancel' ? 'Cancelada - Uso em OS' : 'EXECUTADO - AGUARDANDO NEGOCIAÇÃO FINANCEIRA';
      }
      if (!docs[id]) throw new Error('Documento não encontrado');
      return { data: structuredClone(docs[id]) };
    },
  };
  return { budget, operation, aux, docs, calls, ports, failFinal: () => { failFinal = true; }, ambiguousPost: () => { ambiguousPost = true; }, corruptCreated: () => { corruptCreated = true; } };
}

describe('consolidação integral com preservação do histórico', () => {
  it('cria a integral antes de cancelar auxiliares e mantém todas as tarefas sem chamar Auvo', async () => {
    const f = fixture();
    const result = await consolidateExecutedOs(f.operation, f.ports);
    expect(result.status).toBe('completed');
    expect(f.calls.indexOf('POST /api/ordens_servicos')).toBeLessThan(f.calls.indexOf('PUT /api/ordens_servicos/aux'));
    expect(f.docs.aux.observacoes_interna).toContain('finalizada na OS #10139');
    expect(f.docs.aux.observacoes_interna).toContain('Histórico do técnico');
    expect(f.docs.final.atributos.find((a: any) => a.atributo.atributo_id === '73344').atributo.conteudo).toBe('20, 30');
    expect(f.docs.final.situacao_estoque).toBe('1');
    expect(f.docs.aux.situacao_estoque).toBe('0');
    expect(f.docs.final.produtos).toEqual(f.budget.produtos);
  });
  it('não faz nenhuma escrita se uma OS ainda não foi executada', async () => {
    const f = fixture(); f.aux.nome_situacao = 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO';
    await expect(consolidateExecutedOs(f.operation, f.ports)).rejects.toThrow('Aguardando execução');
    expect(f.calls.every(c => c.startsWith('GET '))).toBe(true);
  });
  it('não cancela os auxiliares se a OS criada perdeu produtos', async () => {
    const f = fixture(); f.corruptCreated();
    await expect(consolidateExecutedOs(f.operation, f.ports)).rejects.toThrow('não preservou');
    expect(f.aux.situacao_estoque).toBe('1');
    expect(f.operation.definitive_document_id).toBe('final');
    expect(f.operation.status).toBe('reconciliation_required');
  });
  it('retoma depois de falha ao finalizar sem criar outra OS nem cancelar duas vezes', async () => {
    const f = fixture(); f.failFinal();
    await expect(consolidateExecutedOs(f.operation, f.ports)).rejects.toThrow('Falha de API');
    expect(f.operation.definitive_document_id).toBe('final');
    await consolidateExecutedOs(structuredClone(f.operation), f.ports);
    expect(f.operation.status).toBe('completed');
    expect(f.calls.filter(c => c === 'POST /api/ordens_servicos')).toHaveLength(1);
    expect(f.calls.filter(c => c === 'PUT /api/ordens_servicos/aux')).toHaveLength(1);
  });
  it('recupera POST com resposta perdida pelo marcador e nunca repete a criação', async () => {
    const f = fixture(); f.ambiguousPost();
    await expect(consolidateExecutedOs(f.operation, f.ports)).rejects.toThrow('Timeout');
    expect(f.operation.consolidation_stage).toBe('creating');
    await consolidateExecutedOs(structuredClone(f.operation), f.ports);
    expect(f.calls.filter(c => c === 'POST /api/ordens_servicos')).toHaveLength(1);
  });
  it('bloqueia alteração da quantidade/serviço mesmo se o total monetário permaneceu igual', () => {
    const f = fixture(); const changed = structuredClone(f.budget); changed.produtos[0].produto.quantidade = '1';
    expect(() => assertDefinitiveContents(f.budget, changed)).toThrow();
    const payload = definitivePayload(f.operation, f.budget, [f.aux], [], 'waiting');
    expect(payload.servicos).toEqual(f.budget.servicos);
    expect(payload.observacoes_interna).toContain('Observação original');
  });
});
