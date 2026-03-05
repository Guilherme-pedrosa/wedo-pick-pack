import { GCOrdemServico, GCVenda, GCSituacao, GCMeta } from './types';
import { MOCK_OS, MOCK_VENDAS, MOCK_STATUS_OS, MOCK_STATUS_VENDA } from './mockData';

function getTokens() {
  // Try env first, then localStorage
  const stored = localStorage.getItem('wedo-checkout-store');
  let lsAccess = '';
  let lsSecret = '';
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      lsAccess = parsed?.state?.config?.accessToken || '';
      lsSecret = parsed?.state?.config?.secretToken || '';
    } catch {}
  }
  return {
    accessToken: import.meta.env.VITE_GC_ACCESS_TOKEN || lsAccess,
    secretToken: import.meta.env.VITE_GC_SECRET_TOKEN || lsSecret,
  };
}

export function isUsingMock(): boolean {
  const { accessToken } = getTokens();
  return !accessToken;
}

function getBaseUrl(): string {
  return import.meta.env.VITE_GC_API_URL || 'https://api.gestaoclick.com';
}

function getHeaders(): Record<string, string> {
  const { accessToken, secretToken } = getTokens();
  return {
    'access-token': accessToken,
    'secret-access-token': secretToken,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...getHeaders(), ...options?.headers },
    });
    if (res.status === 429) throw new Error('RATE_LIMIT');
    if (res.status === 401 || res.status === 403) throw new Error('AUTH_ERROR');
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return res.json();
  } catch (err: unknown) {
    if (err instanceof Error && ['RATE_LIMIT', 'AUTH_ERROR'].includes(err.message)) throw err;
    if (err instanceof TypeError) throw new Error('NETWORK_ERROR');
    throw err;
  }
}

// Delay for mock
const mockDelay = () => new Promise(r => setTimeout(r, 300));

// --- LIST ---
export async function listOS(situacaoId?: string, pagina = 1): Promise<{ data: GCOrdemServico[]; meta: GCMeta }> {
  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_OS];
    if (situacaoId) data = data.filter(o => o.situacao_id === situacaoId);
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }
  const params = new URLSearchParams({ pagina: String(pagina) });
  if (situacaoId) params.set('situacao_id', situacaoId);
  const res = await apiRequest<{ data: GCOrdemServico[]; meta: GCMeta }>(`/ordens_servico?${params}`);
  return res;
}

export async function listVendas(situacaoId?: string, pagina = 1): Promise<{ data: GCVenda[]; meta: GCMeta }> {
  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_VENDAS];
    if (situacaoId) data = data.filter(v => v.situacao_id === situacaoId);
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }
  const params = new URLSearchParams({ pagina: String(pagina) });
  if (situacaoId) params.set('situacao_id', situacaoId);
  const res = await apiRequest<{ data: GCVenda[]; meta: GCMeta }>(`/vendas?${params}`);
  return res;
}

// --- GET SINGLE ---
export async function getOS(id: string): Promise<GCOrdemServico> {
  if (isUsingMock()) {
    await mockDelay();
    const found = MOCK_OS.find(o => o.id === id);
    if (!found) throw new Error('NOT_FOUND');
    return { ...found };
  }
  return apiRequest<GCOrdemServico>(`/ordens_servico/${id}`);
}

export async function getVenda(id: string): Promise<GCVenda> {
  if (isUsingMock()) {
    await mockDelay();
    const found = MOCK_VENDAS.find(v => v.id === id);
    if (!found) throw new Error('NOT_FOUND');
    return { ...found };
  }
  return apiRequest<GCVenda>(`/vendas/${id}`);
}

// --- STATUSES ---
export async function getStatusOS(): Promise<GCSituacao[]> {
  if (isUsingMock()) {
    await mockDelay();
    return [...MOCK_STATUS_OS];
  }
  const res = await apiRequest<{ data: GCSituacao[] }>('/situacoes_os');
  return res.data;
}

export async function getStatusVendas(): Promise<GCSituacao[]> {
  if (isUsingMock()) {
    await mockDelay();
    return [...MOCK_STATUS_VENDA];
  }
  const res = await apiRequest<{ data: GCSituacao[] }>('/situacoes_vendas');
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
  await apiRequest(`/ordens_servico/${id}`, {
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
  await apiRequest(`/vendas/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
