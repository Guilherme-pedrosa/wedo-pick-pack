import { appendUniqueNote, consolidationReference, executionDocument, isCancelledStatus, isExecutedStatus, requireExecutedDocuments, type GcRecord } from './partialExecution.ts';
import type { ConsolidationOperation as PartialWriteoffOperation } from './partialExecution.ts';
import { assertBudgetUnchanged, documentDifferences } from './budgetIntegrity.ts';
import { assertRequestedAuvoTasksLinked } from './partialAuvo.ts';
import { budgetTechnicalHours } from './technicalHours.ts';

export interface ConsolidationPorts<T extends PartialWriteoffOperation = PartialWriteoffOperation> {
  gc(path: string, method?: string, payload?: unknown): Promise<GcRecord>;
  rpc(name: string, payload: GcRecord): Promise<any>;
  reload(): Promise<T>;
  settings(): Promise<Record<string, string>>;
}

const quantity = (v: unknown) => Number(String(v ?? '0').includes(',') ? String(v).replace(/\./g, '').replace(',', '.') : v ?? 0);
const unwrap = (v: GcRecord, kind: string) => v[kind] || v;

function linesSignature(document: GcRecord, kind: 'produto' | 'servico'): string {
  const totals = new Map<string, number>();
  for (const entry of document[`${kind}s`] || []) {
    const line = unwrap(entry, kind);
    const key = JSON.stringify([line[`${kind}_id`] || '', line.variacao_id || '', line.nome_produto || line.nome_servico || '', quantity(line.valor_venda)]);
    const q = quantity(line.quantidade);
    if (!Number.isFinite(q) || q < 0) throw new Error('Quantidade inválida no documento.');
    totals.set(key, (totals.get(key) || 0) + q);
  }
  return JSON.stringify([...totals].map(([k, v]) => [k, Number(v.toFixed(6))]).sort());
}

/** Compara o documento integral, inclusive as peças já retiradas nos lotes. */
export function assertDefinitiveContents(source: GcRecord, actual: GcRecord): void {
  if (String(source.cliente_id) !== String(actual.cliente_id)
    || linesSignature(source, 'produto') !== linesSignature(actual, 'produto')
    || linesSignature(source, 'servico') !== linesSignature(actual, 'servico')
    || Math.abs(quantity(source.valor_total) - quantity(actual.valor_total)) > 0.011) {
    throw new Error('A OS não preservou produtos, quantidades, serviços, preços ou total do orçamento. Consolidação bloqueada.');
  }
}

/** Uma troca de situação não autoriza perder os demais campos do documento. */
export function assertStatusOnlyChange(source: GcRecord, actual: GcRecord): void {
  const differences = documentDifferences(source, actual);
  if (differences.length) throw new Error(`A troca de situação alterou o campo ${differences[0]}. Confira o documento no GC antes de continuar.`);
}

export function writableDocument(document: GcRecord): GcRecord {
  const result: GcRecord = {};
  for (const key of ['cliente_id', 'data', 'data_entrada', 'data_saida', 'valor_total', 'valor_frete', 'condicao_pagamento',
    'produtos', 'servicos', 'equipamentos', 'atributos', 'pagamentos', 'vendedor_id', 'tecnico_id', 'centro_custo_id',
    'observacoes', 'observacoes_interna', 'introducao', 'aos_cuidados_de', 'validade', 'previsao_entrega',
    'desconto_valor', 'desconto_tipo', 'tipo_desconto', 'desconto_porcentagem', 'forma_pagamento_id',
    'data_primeira_parcela', 'numero_parcelas', 'intervalo_dias', 'transportadora_id', 'enderecos', 'exibir_endereco']) {
    if (document[key] != null) result[key] = structuredClone(document[key]);
  }
  result.usuario_id = '1320473';
  return result;
}

export function assertAuxiliaryCoverage(budget: GcRecord, auxiliaries: GcRecord[]): void {
  const signature = (documents: GcRecord[]) => {
    const totals = new Map<string, number>();
    for (const d of documents) for (const entry of d.produtos || []) {
      const p = unwrap(entry, 'produto');
      if (String(p.movimenta_estoque) === '0') continue;
      const key = `${p.produto_id || ''}::${String(p.possui_variacao) === '0' ? '' : p.variacao_id || ''}`;
      totals.set(key, (totals.get(key) || 0) + quantity(p.quantidade));
    }
    return JSON.stringify([...totals].map(([k, v]) => [k, Number(v.toFixed(6))]).sort());
  };
  if (signature([budget]) !== signature(auxiliaries)) throw new Error('As baixas das OS parciais não cobrem exatamente as quantidades integrais do orçamento.');
}

export function definitivePayload(operation: PartialWriteoffOperation, budget: GcRecord, auxiliaries: GcRecord[],
  attributes: GcRecord[], waitingStatus: string, historicTasks: string[] = []): GcRecord {
  const taskIds = [...new Set([...operation.batches.map(b => b.auvo_task_id || ''), ...historicTasks].filter(Boolean))];
  assertRequestedAuvoTasksLinked(operation.batches.filter(b => b.confirmed_at));
  if (!taskIds.length && operation.flow_mode !== 'reservation' && operation.batches.some(b => b.confirmed_at && b.auvo_task_requested !== false)) throw new Error('As tarefas Auvo das execuções precisam estar vinculadas antes de consolidar.');
  const normalize = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const sourceAttributes = (budget.atributos || []).map((a: GcRecord) => unwrap(a, 'atributo'));
  const mapped: GcRecord[] = [];
  for (const entry of attributes) {
    const attr = unwrap(entry, 'atributo');
    const name = normalize(attr.descricao || attr.nome);
    let value: unknown;
    if (name.includes('orcamento')) value = operation.budget_code;
    else if (name.includes('tarefaexecucao') || name.includes('tarefadeentrega')) value = taskIds.join(', ');
    else value = sourceAttributes.find((a: GcRecord) => normalize(a.descricao || a.nome) === name)?.conteudo;
    if (value != null && String(value) !== '') mapped.push({ atributo: { atributo_id: String(attr.id || attr.atributo_id), conteudo: String(value) } });
  }
  // IDs já utilizados pelo fluxo de OS; a consulta acima preserva os demais campos por nome.
  const setAttr = (id: string, value: string) => {
    const existing = mapped.find(a => a.atributo.atributo_id === id);
    if (existing) existing.atributo.conteudo = value;
    else mapped.push({ atributo: { atributo_id: id, conteudo: value } });
  };
  setAttr('81831', operation.budget_code);
  if (taskIds.length) setAttr('73344', taskIds.join(', '));
  const sourceValue = (id: string) => String(sourceAttributes.find((a: GcRecord) => String(a.atributo_id) === id)?.conteudo || '');
  if (sourceValue('73341') || taskIds[0]) setAttr('73343', sourceValue('73341') || taskIds[0]);
  setAttr('68658', sourceValue('73350') || 'CLIENTE');
  const hours = budgetTechnicalHours(budget);
  if (hours !== null) setAttr('73897', hours);
  const marker = `PP-CONSOLIDACAO-${operation.id}`;
  const notes = auxiliaries.map(d => `OS parcial #${d.codigo} (${d.id}) — ${d.nome_situacao}\n${d.observacoes || ''}\n${d.observacoes_interna || ''}`).join('\n\n');
  return { ...writableDocument(budget), data: budget.data || new Date().toISOString().slice(0, 10),
    situacao_id: waitingStatus, atributos: mapped,
    observacoes_interna: [budget.observacoes_interna, marker, `Consolidação integral do orçamento #${operation.budget_code}.`, taskIds.length ? `Tarefas Auvo preservadas: ${taskIds.join(', ')}.` : 'Lotes sem solicitação de tarefa Auvo.', notes].filter(Boolean).join('\n\n') };
}

async function readDocument(ports: ConsolidationPorts, id: string): Promise<GcRecord> {
  const doc = (await ports.gc(`/api/ordens_servicos/${encodeURIComponent(id)}`)).data;
  if (!doc || String(doc.id) !== id) throw new Error(`Não foi possível conferir a OS ${id}.`);
  return doc;
}

async function findCreatedDocument(ports: ConsolidationPorts, marker: string): Promise<GcRecord | null> {
  const found: GcRecord[] = [];
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const result = await ports.gc(`/api/ordens_servicos?limite=100&pagina=${page}&pesquisa=${encodeURIComponent(marker)}`);
    const total = Number(result.meta?.total_paginas);
    if (!Array.isArray(result.data) || !Number.isInteger(total) || total < 0 || Number(result.meta?.pagina_atual) !== page) throw new Error('Consulta incompleta da OS definitiva.');
    if (page > 1 && total !== pages) throw new Error('A lista de OS mudou durante a conferência.');
    pages = total;
    for (const entry of result.data) {
      const d = entry.OrdemServico || entry.ordem_servico || entry;
      if (String(d.observacoes_interna || '').includes(marker)) found.push(d);
    }
  }
  if (found.length > 1) throw new Error('Há mais de uma OS com a referência desta consolidação.');
  return found[0] ? readDocument(ports, String(found[0].id)) : null;
}

/** Nenhuma chamada ao Auvo: consolidação documental das execuções existentes. */
export async function consolidateExecutedOs<T extends PartialWriteoffOperation>(initial: T, ports: ConsolidationPorts<T>): Promise<T> {
  let operation = initial;
  if (operation.status === 'completed') return operation;
  const reservationOnly = operation.flow_mode === 'reservation';
  const settings = await ports.settings();
  const marker = `PP-CONSOLIDACAO-${operation.id}`;
  const batches = operation.batches.filter(b => b.confirmed_at && b.auxiliary_document_id);
  assertRequestedAuvoTasksLinked(batches);
  const auxiliaries: GcRecord[] = [];
  for (const batch of batches) auxiliaries.push(await readDocument(ports, batch.auxiliary_document_id!));
  if (auxiliaries.some(d => String(d.situacao_financeiro) === '1' || [d.nota_fiscal_id, d.nota_fiscal_servico_id].some(id => id && String(id) !== '0'))) {
    throw new Error('Há financeiro ou nota fiscal aplicado em uma OS parcial. Reconcilie esses lançamentos antes de cancelar o documento.');
  }
  const proof = operation.execution_documents || [];
  const documents = auxiliaries.map((doc, i) => {
    // Retomada só aceita auxiliar cancelado se a própria consolidação o referenciou.
    const reference = operation.definitive_document_code && consolidationReference(operation.budget_code, operation.definitive_document_code);
    if (isCancelledStatus(doc.nome_situacao) && reference && String(doc.observacoes_interna || '').includes(reference)) {
      const previous = proof.find(p => p.documentId === String(doc.id));
      if (previous?.stockApplied && (previous.executed || reservationOnly && previous.statusId === settings.os_stock_status_id)) return previous;
    }
    return executionDocument(batches[i].id, doc);
  });
  const requireReady = (docs: typeof documents) => {
    if (!reservationOnly) return requireExecutedDocuments(docs);
    if (!docs.length || docs.some(d => !d.stockApplied || d.statusId !== settings.os_stock_status_id)) throw new Error('A reserva de todas as peças ainda não foi confirmada no GC.');
  };
  requireReady(documents);
  const budget = (await ports.gc(`/api/orcamentos/${encodeURIComponent(operation.budget_id)}`)).data;
  if (!budget || String(budget.id) !== operation.budget_id) throw new Error('Não foi possível conferir o orçamento original.');
  assertBudgetUnchanged(operation.budget_snapshot, budget);
  assertAuxiliaryCoverage(budget, auxiliaries);
  const statuses = (await ports.gc('/api/situacoes_ordens_servicos')).data;
  if (!Array.isArray(statuses)) throw new Error('Não foi possível conferir as situações de OS.');
  const finalStatus = reservationOnly ? settings.os_waiting_status_id : documents[documents.length - 1].statusId;
  if (!statuses.some(s => String(s.id) === finalStatus)) throw new Error('Situação da última execução não está disponível.');
  await ports.rpc('partial_writeoff_record_execution', { p_operation_id: operation.id, p_documents: documents });
  const claim = await ports.rpc('partial_writeoff_claim_consolidation', { p_operation_id: operation.id });
  if (claim === 'completed') return ports.reload();
  operation = await ports.reload();
  let definitive: GcRecord | null = null;
  const save = (stage: string, doc?: GcRecord | null) => ports.rpc('partial_writeoff_checkpoint', {
    p_operation_id: operation.id, p_stage: stage, p_document_id: doc?.id ? String(doc.id) : null,
    p_document_code: doc?.codigo ? String(doc.codigo) : null,
    p_payload: { budget, auxiliaries, documents, definitive: doc || null },
  });
  try {
    if (operation.definitive_document_id) definitive = await readDocument(ports, operation.definitive_document_id);
    else definitive = await findCreatedDocument(ports, marker);
    if (definitive && (isCancelledStatus(definitive.nome_situacao) || !String(definitive.observacoes_interna || '').includes(marker))) {
      throw new Error('A OS definitiva anterior precisa de reconciliação; uma nova não será criada automaticamente.');
    }
    if (!definitive) {
      if (operation.consolidation_stage === 'creating') throw new Error('Criação anterior inconclusiva. Confirme a OS no GC antes de repetir; os auxiliares foram preservados.');
      const attrs = (await ports.gc('/api/atributos_ordens_servicos')).data;
      if (!Array.isArray(attrs)) throw new Error('Não foi possível consultar os atributos da OS.');
      const history = await ports.rpc('partial_writeoff_historical_tasks', { p_operation_id: operation.id });
      const payload = definitivePayload(operation, budget, auxiliaries, attrs, settings.os_waiting_status_id, history || []);
      await save('creating');
      const created = (await ports.gc('/api/ordens_servicos', 'POST', payload)).data;
      if (!created?.id) throw new Error('O GC não confirmou o ID da OS criada.');
      definitive = { ...created };
      await save('created', definitive); // ID persistido antes de qualquer outra consulta/mutação.
      definitive = await readDocument(ports, String(created.id));
      assertDefinitiveContents(budget, definitive);
      assertStatusOnlyChange(payload, definitive);
    }
    assertDefinitiveContents(budget, definitive);
    const expectedMetadata = writableDocument(budget);
    delete expectedMetadata.atributos; // IDs próprios de OS, mapeados no payload de criação.
    delete expectedMetadata.observacoes_interna; // Texto original mais o histórico das auxiliares.
    assertStatusOnlyChange(expectedMetadata, definitive);
    if (budget.observacoes_interna && !String(definitive.observacoes_interna || '').includes(String(budget.observacoes_interna))) {
      throw new Error('A OS não preservou as observações internas do orçamento.');
    }
    await save('created', definitive);
    if (String(definitive.situacao_estoque) !== '0' && !['finalizing', 'finalized'].includes(operation.consolidation_stage || '')) {
      throw new Error('A OS definitiva já movimenta estoque antes da compensação dos auxiliares.');
    }
    const reference = consolidationReference(operation.budget_code, String(definitive.codigo));
    for (const batch of batches) {
      const current = await readDocument(ports, batch.auxiliary_document_id!);
      if (isCancelledStatus(current.nome_situacao)) {
        if (String(current.situacao_estoque) !== '0' || !String(current.observacoes_interna || '').includes(reference)) throw new Error(`OS #${current.codigo} cancelada fora desta consolidação.`);
        continue;
      }
      requireReady([executionDocument(batch.id, current)]);
      const payload = { ...writableDocument(current), situacao_id: settings.os_cancel_status_id,
        observacoes_interna: appendUniqueNote(current.observacoes_interna, reference) };
      await ports.gc(`/api/ordens_servicos/${current.id}`, 'PUT', payload);
      const verified = await readDocument(ports, String(current.id));
      assertDefinitiveContents(current, verified);
      assertStatusOnlyChange({ ...current, observacoes_interna: payload.observacoes_interna }, verified);
      if (!isCancelledStatus(verified.nome_situacao) || String(verified.situacao_estoque) !== '0' || !String(verified.observacoes_interna || '').includes(reference)) throw new Error(`Compensação da OS #${current.codigo} não confirmada.`);
    }
    await save('finalizing', definitive);
    definitive = await readDocument(ports, String(definitive.id));
    if (!reservationOnly && String(definitive.situacao_estoque) !== '1') {
      const beforeStatus = definitive;
      await ports.gc(`/api/ordens_servicos/${definitive.id}`, 'PUT', { ...writableDocument(definitive), situacao_id: finalStatus });
      definitive = await readDocument(ports, String(definitive.id));
      assertStatusOnlyChange(beforeStatus, definitive);
    }
    assertDefinitiveContents(budget, definitive);
    if (reservationOnly) {
      if (String(definitive.situacao_estoque) !== '0' || String(definitive.situacao_id) !== finalStatus) throw new Error('Transferência da reserva para a fila de Checkout não confirmada.');
    } else if (String(definitive.situacao_estoque) !== '1' || !isExecutedStatus(definitive.nome_situacao)) throw new Error('Baixa e execução definitivas não confirmadas no GestãoClick.');
    const latestBudget = (await ports.gc(`/api/orcamentos/${operation.budget_id}`)).data;
    assertBudgetUnchanged(budget, latestBudget);
    await ports.gc(`/api/orcamentos/${operation.budget_id}`, 'PUT', { ...writableDocument(latestBudget), situacao_id: '7109779' });
    const verifiedBudget = (await ports.gc(`/api/orcamentos/${operation.budget_id}`)).data;
    assertDefinitiveContents(budget, verifiedBudget);
    assertStatusOnlyChange(latestBudget, verifiedBudget);
    if (String(verifiedBudget.situacao_id) !== '7109779') throw new Error('Vínculo do orçamento com a OS não confirmado.');
    await save('finalized', definitive);
    await ports.rpc('partial_writeoff_finish_consolidation', { p_operation_id: operation.id, p_success: true,
      p_document_id: String(definitive.id), p_document_code: String(definitive.codigo),
      p_auvo_task_id: operation.batches.map(b => b.auvo_task_id).filter(Boolean).join(', ') });
    return ports.reload();
  } catch (error) {
    await ports.rpc('partial_writeoff_finish_consolidation', { p_operation_id: operation.id, p_success: false,
      p_document_id: definitive?.id ? String(definitive.id) : null, p_document_code: definitive?.codigo ? String(definitive.codigo) : null,
      p_error_message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
