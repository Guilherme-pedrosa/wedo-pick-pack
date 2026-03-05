import { GCOrdemServico, GCVenda, GCSituacao, GCMeta } from './types';
import { MOCK_OS, MOCK_VENDAS, MOCK_STATUS_OS, MOCK_STATUS_VENDA } from './mockData';
import { supabase } from '@/integrations/supabase/client';

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

export function isUsingMock(): boolean {
  return !SUPABASE_PROJECT_ID;
}

async function apiRequest<T>(path: string, options?: { method?: string; body?: string }): Promise<T> {
  const method = options?.method || 'GET';
  
  const { data, error } = await supabase.functions.invoke('gc-proxy', {
    method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
    body: {
      path,
      method,
      payload: options?.body ? JSON.parse(options.body) : undefined,
    },
  });

  if (error) {
    const msg = error.message || 'Unknown error';
    if (msg.includes('429') || msg.includes('RATE_LIMIT')) throw new Error('RATE_LIMIT');
    if (msg.includes('401') || msg.includes('403') || msg.includes('AUTH_ERROR')) throw new Error('AUTH_ERROR');
    throw new Error(msg);
  }

  return data as T;
}

const mockDelay = () => new Promise(r => setTimeout(r, 300));

// --- LIST ---
export async function listOS(situacaoId?: string, pagina = 1): Promise<{ data: GCOrdemServico[]; meta: GCMeta }> {
  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_OS];
    if (situacaoId) data = data.filter(o => o.situacao_id === situacaoId);
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }
  let path = `/api/ordens_servicos?pagina=${pagina}`;
  if (situacaoId) path += `&situacao_id=${situacaoId}`;
  return apiRequest<{ data: GCOrdemServico[]; meta: GCMeta }>(path);
}

export async function listVendas(situacaoId?: string, pagina = 1): Promise<{ data: GCVenda[]; meta: GCMeta }> {
  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_VENDAS];
    if (situacaoId) data = data.filter(v => v.situacao_id === situacaoId);
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }
  let path = `/api/vendas?pagina=${pagina}`;
  if (situacaoId) path += `&situacao_id=${situacaoId}`;
  return apiRequest<{ data: GCVenda[]; meta: GCMeta }>(path);
}

// --- GET SINGLE ---
export async function getOS(id: string): Promise<GCOrdemServico> {
  if (isUsingMock()) {
    await mockDelay();
    const found = MOCK_OS.find(o => o.id === id);
    if (!found) throw new Error('NOT_FOUND');
    return { ...found };
  }
  return apiRequest<GCOrdemServico>(`/api/ordens_servicos/${id}`);
}

export async function getVenda(id: string): Promise<GCVenda> {
  if (isUsingMock()) {
    await mockDelay();
    const found = MOCK_VENDAS.find(v => v.id === id);
    if (!found) throw new Error('NOT_FOUND');
    return { ...found };
  }
  return apiRequest<GCVenda>(`/api/vendas/${id}`);
}

// --- STATUSES ---
export async function getStatusOS(): Promise<GCSituacao[]> {
  if (isUsingMock()) {
    await mockDelay();
    return [...MOCK_STATUS_OS];
  }
  const res = await apiRequest<{ data: GCSituacao[] }>('/api/situacoes_ordens_servicos');
  return res.data;
}

export async function getStatusVendas(): Promise<GCSituacao[]> {
  if (isUsingMock()) {
    await mockDelay();
    return [...MOCK_STATUS_VENDA];
  }
  const res = await apiRequest<{ data: GCSituacao[] }>('/api/situacoes_vendas');
  return res.data;
}

// --- UPDATE STATUS ---
export async function updateOSStatus(id: string, rawOrder: GCOrdemServico, newStatusId: string): Promise<void> {
  if (isUsingMock()) {
    await mockDelay();
    return;
  }
  const payload = {
    cliente_id: rawOrder.cliente_id,
    codigo: rawOrder.codigo,
    data: rawOrder.data,
    situacao_id: newStatusId,
    vendedor_id: rawOrder.vendedor_id,
    observacoes: rawOrder.observacoes || '',
    observacoes_interna: rawOrder.observacoes_interna || '',
    valor_frete: rawOrder.valor_frete || '0.00',
    condicao_pagamento: rawOrder.condicao_pagamento || 'a_vista',
    produtos: rawOrder.produtos,
    servicos: rawOrder.servicos || [],
  };
  await apiRequest(`/api/ordens_servicos/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function updateVendaStatus(id: string, rawOrder: GCVenda, newStatusId: string): Promise<void> {
  if (isUsingMock()) {
    await mockDelay();
    return;
  }
  const payload = {
    tipo: 'produto',
    cliente_id: rawOrder.cliente_id,
    codigo: rawOrder.codigo,
    data: rawOrder.data,
    situacao_id: newStatusId,
    vendedor_id: rawOrder.vendedor_id,
    valor_frete: rawOrder.valor_frete || '0.00',
    condicao_pagamento: rawOrder.condicao_pagamento || 'a_vista',
    produtos: rawOrder.produtos,
    servicos: rawOrder.servicos || [],
  };
  await apiRequest(`/api/vendas/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
