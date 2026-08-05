import { supabase } from '@/integrations/supabase/client';
import type { GCProdutoItem, PickingItem } from '@/api/types';
import type { Json } from '@/integrations/supabase/types';

export interface SeparationItemSnapshot {
  product_id: string;
  variation_id: string;
  code: string;
  name: string;
  unit: string;
  expected_quantity: number;
  confirmed_quantity: number;
}

export interface SeparationRecord {
  id: string;
  user_id: string;
  order_type: 'os' | 'venda';
  order_id: string;
  order_code: string;
  client_name: string;
  status_name: string;
  status_id: string;
  client_id: string | null;
  target_status_id: string;
  target_status_name: string;
  total_value: string;
  items_total: number;
  items_confirmed: number;
  items: SeparationItemSnapshot[];
  operator_name: string;
  equipment_name: string | null;
  technician_gc_id: string | null;
  technician_name: string | null;
  started_at: string;
  concluded_at: string;
  observations: string | null;
  invalidated: boolean;
  invalidated_at: string | null;
  invalidated_reason: string | null;
  created_at: string;
}

export interface CreateSeparationInput {
  order_type: 'os' | 'venda';
  order_id: string;
  order_code: string;
  client_name: string;
  status_name: string;
  status_id: string;
  target_status_id: string;
  target_status_name: string;
  total_value: string;
  items_total: number;
  items_confirmed: number;
  items: SeparationItemSnapshot[];
  operator_name: string;
  client_id?: string;
  equipment_name?: string;
  started_at: string;
  observations?: string;
}

export interface SeparationFilters {
  fromDate?: string;
  toDate?: string;
  orderType?: 'os' | 'venda' | 'all';
  status?: 'all' | 'valid' | 'invalid';
  search?: string;
}

function quantity(value: string | number | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function snapshotPickingItems(items: PickingItem[]): SeparationItemSnapshot[] {
  return items.map((item) => ({
    product_id: String(item.produto_id || ''),
    variation_id: String(item.variacao_id || ''),
    code: String(item.codigo_produto || ''),
    name: String(item.nome_produto || ''),
    unit: String(item.sigla_unidade || ''),
    expected_quantity: quantity(item.qtd_total),
    confirmed_quantity: quantity(item.qtd_conferida),
  }));
}

export function snapshotOrderProducts(
  products: Array<{ produto: GCProdutoItem }> | null | undefined,
): SeparationItemSnapshot[] {
  return (products || []).map(({ produto }) => {
    const expected = quantity(produto.quantidade);
    return {
      product_id: String(produto.produto_id || ''),
      variation_id: String(produto.variacao_id || ''),
      code: String(produto.codigo_produto || ''),
      name: String(produto.nome_produto || ''),
      unit: String(produto.sigla_unidade || ''),
      expected_quantity: expected,
      confirmed_quantity: expected,
    };
  });
}

export async function createSeparation(input: CreateSeparationInput): Promise<SeparationRecord> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('AUTH_REQUIRED');
  }

  const { data, error } = await supabase
    .from('separations')
    .insert({
      user_id: user.id,
      client_id: input.client_id || null,
      ...input,
      items: input.items,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('Error creating separation:', error);
    throw new Error('SEPARATION_SAVE_FAILED');
  }

  return data as unknown as SeparationRecord;
}

export async function getTodaySeparations(): Promise<SeparationRecord[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return getSeparations({
    fromDate: today.toISOString(),
    toDate: tomorrow.toISOString(),
  });
}

export async function getSeparations(filters: SeparationFilters = {}): Promise<SeparationRecord[]> {
  const { fromDate, toDate, orderType = 'all', status = 'all', search } = filters;

  let query = supabase
    .from('separations')
    .select('*')
    .order('concluded_at', { ascending: false });

  if (fromDate) {
    query = query.gte('concluded_at', fromDate);
  }

  if (toDate) {
    query = query.lt('concluded_at', toDate);
  }

  if (orderType !== 'all') {
    query = query.eq('order_type', orderType);
  }

  if (status === 'valid') {
    query = query.eq('invalidated', false);
  }

  if (status === 'invalid') {
    query = query.eq('invalidated', true);
  }

  if (search && search.trim().length > 0) {
    const term = search.trim();
    query = query.or(`order_code.ilike.%${term}%,client_name.ilike.%${term}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching separations:', error);
    return [];
  }

  return (data || []) as unknown as SeparationRecord[];
}

/** Returns a Set of order IDs that have valid (non-invalidated) separations today */
export async function getValidSeparatedOrderIds(): Promise<Set<string>> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const { data, error } = await supabase
    .from('separations')
    .select('order_id')
    .gte('concluded_at', todayISO)
    .eq('invalidated', false);

  if (error) {
    console.error('Error fetching valid separations:', error);
    return new Set();
  }
  return new Set((data || []).map((record) => record.order_id));
}

export async function invalidateSeparation(id: string, reason: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('separations')
    .update({
      invalidated: true,
      invalidated_at: new Date().toISOString(),
      invalidated_reason: reason,
    })
    .eq('id', id)
    .select('id');

  if (error) {
    console.error('Error invalidating separation:', error);
    return false;
  }
  if (!data || data.length === 0) {
    console.error('Invalidate separation affected 0 rows (RLS or missing id):', id);
    return false;
  }
  return true;
}

export async function linkTechnicianToSeparation(
  id: string,
  technicianGcId: string | null,
  technicianName: string | null,
  items?: SeparationItemSnapshot[],
): Promise<boolean> {
  const update: {
    technician_gc_id: string | null;
    technician_name: string | null;
    items?: Json;
  } = {
    technician_gc_id: technicianGcId,
    technician_name: technicianName,
  };
  if (items && items.length > 0) update.items = items as unknown as Json;

  const { data, error } = await supabase
    .from('separations')
    .update(update)
    .eq('id', id)
    .select('id');

  if (error) {
    console.error('Error linking technician to separation:', error);
    return false;
  }
  if (!data || data.length === 0) {
    console.error('Link technician affected 0 rows (RLS or missing id):', id);
    return false;
  }
  return true;
}
