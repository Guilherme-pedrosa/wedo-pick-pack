export interface GCMeta {
  pagina_atual: number;
  total_paginas: number;
  total_registros: number;
}

export interface GCProdutoItem {
  produto_id: string;
  variacao_id: string;
  nome_produto: string;
  codigo_produto: string;
  codigo_barras: string;
  sigla_unidade: string;
  quantidade: number | string;
  valor_venda?: string;
}

export interface GCOrdemServico {
  id: string;
  codigo: string;
  cliente_id: string;
  nome_cliente: string;
  vendedor_id?: string;
  data: string;
  data_entrada?: string;
  data_saida?: string;
  situacao_id: string;
  nome_situacao: string;
  valor_total: string;
  observacoes?: string;
  observacoes_interna?: string;
  valor_frete?: string;
  condicao_pagamento?: string;
  produtos: Array<{ produto: GCProdutoItem }>;
  servicos?: unknown[];
  equipamentos?: unknown[];
  pagamentos?: unknown[];
  atributos?: unknown[];
}

export interface GCVenda {
  id: string;
  codigo: string;
  tipo: string;
  cliente_id: string;
  nome_cliente: string;
  vendedor_id?: string;
  data: string;
  situacao_id: string;
  nome_situacao: string;
  valor_total: string;
  observacoes?: string;
  valor_frete?: string;
  condicao_pagamento?: string;
  produtos: Array<{ produto: GCProdutoItem }>;
  servicos?: unknown[];
  pagamentos?: unknown[];
}

export interface GCSituacao {
  id: string;
  nome: string;
}

export type OrderType = 'os' | 'venda';
export type Order = GCOrdemServico | GCVenda;

export interface PickingItem {
  id: string;
  produto_id: string;
  variacao_id: string;
  nome_produto: string;
  codigo_produto: string;
  codigo_barras: string;
  sigla_unidade: string;
  qtd_total: number;
  qtd_conferida: number;
  conferido: boolean;
  confirmed_at?: string;
}

export interface PickingSession {
  tipo: OrderType;
  refId: string;
  codigo: string;
  nomeCliente: string;
  nomeSituacao: string;
  situacaoId: string;
  valorTotal: string;
  rawOrder: Order;
  items: PickingItem[];
  startedAt: string;
  concludedAt?: string;
}
