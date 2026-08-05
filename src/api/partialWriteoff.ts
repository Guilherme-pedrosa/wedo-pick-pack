import { supabase } from '@/integrations/supabase/client';
import { OrderType } from './types';
import { invokePartialWriteoffClient } from './partialWriteoffClient';

export type PartialWriteoffStatus =
  | 'awaiting_separation'
  | 'partial_separation'
  | 'awaiting_balance'
  | 'ready_to_consolidate'
  | 'consolidating'
  | 'completed'
  | 'cancelled'
  | 'reconciliation_required';

export interface PartialWriteoffItem {
  id: string;
  operation_id: string;
  line_key: string;
  product_id: string;
  variation_id: string;
  product_name: string;
  product_code: string;
  unit: string;
  original_quantity: number;
  reserved_quantity: number;
  withdrawn_quantity: number;
  pending_purchase_quantity: number;
  available_to_reserve_quantity: number;
  line_snapshot: unknown;
}

export interface PartialWriteoffBatch {
  id: string;
  operation_id: string;
  sequence: number;
  marker: string;
  status: string;
  auxiliary_document_type: OrderType;
  auxiliary_document_id: string | null;
  auxiliary_document_code: string | null;
  error_message: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export interface PartialWriteoffOperation {
  id: string;
  budget_id: string;
  budget_code: string;
  client_id: string;
  client_name: string;
  document_type: OrderType;
  status: PartialWriteoffStatus;
  budget_snapshot: Record<string, unknown>;
  definitive_document_id: string | null;
  definitive_document_code: string | null;
  definitive_auvo_task_id: string | null;
  reconciliation_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  items: PartialWriteoffItem[];
  batches: PartialWriteoffBatch[];
}

export interface PartialBudgetSearchResult {
  id: string;
  codigo: string;
  budget_kind: 'produto' | 'servico';
  cliente_id: string;
  nome_cliente: string;
  data: string;
  nome_situacao: string;
  valor_total: string;
  partial_operation: Pick<PartialWriteoffOperation, 'id' | 'budget_id' | 'status'> | null;
}

export interface PartialCheckoutEntry {
  batchId: string;
  operationId: string;
  budgetCode: string;
  marker: string;
  type: OrderType;
  documentId: string;
  documentCode: string;
  clientName: string;
  createdAt: string;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  return invokePartialWriteoffClient<T>(body);
}

export async function searchPartialBudgets(term: string): Promise<PartialBudgetSearchResult[]> {
  const data = await invoke<{ budgets: PartialBudgetSearchResult[] }>({ action: 'search_budgets', term });
  return data.budgets || [];
}

export async function openPartialOperation(
  budgetId: string,
  budgetKind: PartialBudgetSearchResult['budget_kind'],
): Promise<PartialWriteoffOperation> {
  const data = await invoke<{ operation: PartialWriteoffOperation }>({
    action: 'open_operation',
    budget_id: budgetId,
    budget_kind: budgetKind,
  });
  return data.operation;
}

export async function getPartialOperation(operationId: string): Promise<PartialWriteoffOperation> {
  const data = await invoke<{ operation: PartialWriteoffOperation }>({ action: 'get_operation', operation_id: operationId });
  return data.operation;
}

export async function listPartialOperations(): Promise<PartialWriteoffOperation[]> {
  try {
    const data = await invoke<{ operations: PartialWriteoffOperation[] }>({ action: 'list_operations' });
    return data.operations || [];
  } catch (error) {
    if (/partial_writeoff|relation .* does not exist/i.test(error instanceof Error ? error.message : String(error))) return [];
    throw error;
  }
}

export async function preparePartialBatch(
  operationId: string,
  items: Array<{ item_id: string; quantity: number }>,
  idempotencyKey = crypto.randomUUID(),
): Promise<PartialWriteoffOperation> {
  const data = await invoke<{ operation: PartialWriteoffOperation }>({
    action: 'prepare_batch',
    operation_id: operationId,
    idempotency_key: idempotencyKey,
    items,
  });
  return data.operation;
}

export async function confirmPartialBatch(batchId: string): Promise<PartialWriteoffOperation> {
  const data = await invoke<{ operation: PartialWriteoffOperation }>({ action: 'confirm_batch', batch_id: batchId });
  return data.operation;
}

export async function consolidatePartialOperation(
  operationId: string,
  options?: { auvoCustomerId?: string; manualEquipment?: string },
): Promise<PartialWriteoffOperation> {
  const data = await invoke<{ operation: PartialWriteoffOperation }>({
    action: 'consolidate',
    operation_id: operationId,
    auvo_customer_id: options?.auvoCustomerId?.trim() || undefined,
    manual_equipamento: options?.manualEquipment?.trim() || undefined,
  });
  return data.operation;
}

export async function getPartialCheckoutQueue(): Promise<PartialCheckoutEntry[]> {
  const operations = await listPartialOperations();
  return operations.flatMap((operation) => operation.batches
    .filter((batch) => batch.status === 'awaiting_checkout' && batch.auxiliary_document_id)
    .map((batch) => ({
      batchId: batch.id,
      operationId: operation.id,
      budgetCode: operation.budget_code,
      marker: batch.marker,
      type: batch.auxiliary_document_type,
      documentId: String(batch.auxiliary_document_id),
      documentCode: String(batch.auxiliary_document_code || ''),
      clientName: operation.client_name,
      createdAt: batch.created_at,
    })));
}

export async function findPartialBatchByDocument(type: OrderType, documentId: string): Promise<PartialCheckoutEntry | null> {
  try {
    const query = (supabase.from('partial_writeoff_batches' as any) as any)
      .select('id, operation_id, marker, auxiliary_document_type, auxiliary_document_id, auxiliary_document_code, created_at, status, partial_writeoff_operations(budget_code, client_name)')
      .eq('auxiliary_document_type', type)
      .eq('auxiliary_document_id', documentId)
      .eq('status', 'awaiting_checkout')
      .maybeSingle();
    const { data, error } = await query;
    if (error || !data) return null;
    return {
      batchId: data.id,
      operationId: data.operation_id,
      budgetCode: data.partial_writeoff_operations?.budget_code || '',
      marker: data.marker,
      type: data.auxiliary_document_type,
      documentId: data.auxiliary_document_id,
      documentCode: data.auxiliary_document_code || '',
      clientName: data.partial_writeoff_operations?.client_name || '',
      createdAt: data.created_at,
    };
  } catch {
    return null;
  }
}

export interface ActivePartialDemand {
  activeBudgetIds: Set<string>;
  auxiliaryDocumentIds: Set<string>;
  pendingByBudgetAndProduct: Map<string, Map<string, number>>;
}

export function buildActivePartialDemand(operations: PartialWriteoffOperation[]): ActivePartialDemand {
  const result: ActivePartialDemand = {
    activeBudgetIds: new Set(),
    auxiliaryDocumentIds: new Set(),
    pendingByBudgetAndProduct: new Map(),
  };
  for (const operation of operations) {
    if (['completed', 'cancelled'].includes(operation.status)) continue;
    result.activeBudgetIds.add(operation.budget_id);
    const demand = new Map<string, number>();
    for (const item of operation.items) {
      const key = item.variation_id ? `${item.product_id}::${item.variation_id}` : item.product_id;
      demand.set(key, (demand.get(key) || 0) + Number(item.pending_purchase_quantity || 0));
    }
    result.pendingByBudgetAndProduct.set(operation.budget_id, demand);
    for (const batch of operation.batches) {
      if (batch.auxiliary_document_id) result.auxiliaryDocumentIds.add(`${batch.auxiliary_document_type}:${batch.auxiliary_document_id}`);
    }
  }
  return result;
}

export async function getActivePartialDemand(): Promise<ActivePartialDemand> {
  const empty: ActivePartialDemand = {
    activeBudgetIds: new Set(),
    auxiliaryDocumentIds: new Set(),
    pendingByBudgetAndProduct: new Map(),
  };
  try {
    const operations = await listPartialOperations();
    return buildActivePartialDemand(operations);
  } catch {
    return empty;
  }
}
