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
  equipamentos?: Array<{
    equipamento: {
      equipamento: string;
      serie?: string;
      marca?: string;
      modelo?: string;
    };
  }>;
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

// --- COMPRAS MODULE ---

export interface GCOrcamentoProduto {
  produto_id: string;
  variacao_id: string;
  nome_produto: string;
  codigo_produto: string;
  sigla_unidade: string;
  quantidade: string | number;
  valor_custo?: string;
  movimenta_estoque?: string;
}

export interface GCOrcamento {
  id: string;
  codigo: string;
  cliente_id: string;
  nome_cliente: string;
  vendedor_id?: string;
  data: string;
  situacao_id: string;
  nome_situacao: string;
  valor_total: string;
  situacao_financeiro?: string;
  situacao_estoque?: string;
  produtos: Array<{ produto: GCOrcamentoProduto }>;
  equipamentos?: Array<{
    equipamento: {
      equipamento: string;
      serie?: string;
      marca?: string;
      modelo?: string;
    };
  }>;
}

export interface OrcamentoConvertidoWarning {
  orcamento_id: string;
  codigo: string;
  nome_cliente: string;
  situacao_financeiro: string;
  situacao_estoque: string;
}

export interface GCProdutoDetalhe {
  id: string;
  nome: string;
  codigo_interno: string;
  codigo_barra: string;
  estoque: string | number;
  valor_custo: string;
  movimenta_estoque: string;
  nome_grupo?: string;
  fornecedores: Array<{ id: string }>;
  variacoes?: Array<{
    variacao: {
      id: string;
      nome: string;
      estoque: string | number;
    };
  }>;
}

export interface GCFornecedor {
  id: string;
  nome: string;
  telefone?: string;
  email?: string;
}

export interface GCCompraProduto {
  id: string;
  produto_id: string;
  variacao_id: string;
  nome_produto: string;
  quantidade: string | number;
  valor_custo: string;
}

export interface GCOrdemCompra {
  id: string;
  codigo: string;
  fornecedor_id: string;
  nome_fornecedor: string;
  data_emissao: string;
  situacao_id: string;
  nome_situacao: string;
  valor_total: string;
  produtos: Array<{ produto: GCCompraProduto }>;
}

export interface GCSituacaoCompra {
  id: string;
  nome: string;
  padrao: string;
  tipo_lancamento: string; // "0"=Não lança "1"=Est+Fin "2"=Só Est "3"=Só Fin
}

export interface ItemCompra {
  produto_id: string;
  variacao_id: string;
  nome_produto: string;
  codigo_produto: string;
  sigla_unidade: string;
  grupo?: string;
  estoque_atual: number;
  qtd_necessaria: number;
  qtd_a_comprar: number;
  qtd_ja_em_compra: number;
  qtd_efetiva_a_comprar: number;
  ultimo_preco: number;
  estimativa: number;
  movimenta_estoque: boolean;
  fornecedor_id?: string;
  fornecedor_nome?: string;
  fornecedor_telefone?: string;
  orcamentos: Array<{
    id: string;
    codigo: string;
    qtd: number;
    nome_cliente: string;
  }>;
  ordens_compra: Array<{
    id: string;
    codigo: string;
    qtd: number;
    nome_fornecedor: string;
    situacao: string;
  }>;
}

export interface ComprasResult {
  itensList: ItemCompra[];
  itensOkList: ItemCompra[];
  itensCobertosporPedido: ItemCompra[];
  orcamentosConvertidos: OrcamentoConvertidoWarning[];
  totalOrcamentos: number;
  totalProdutosSemEstoque: number;
  totalProdutosOk: number;
  totalItensCobertosporPedido: number;
  estimativaTotal: number;
  scannedAt: string;
}
