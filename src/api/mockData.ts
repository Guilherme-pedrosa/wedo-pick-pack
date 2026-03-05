import { GCSituacao, GCOrdemServico, GCVenda, GCOrcamento, GCProdutoDetalhe, GCFornecedor, GCSituacaoCompra, GCOrdemCompra } from './types';

export const MOCK_STATUS_OS: GCSituacao[] = [
  { id: "12113", nome: "Em aberto" },
  { id: "18", nome: "Em andamento" },
  { id: "19", nome: "Confirmada" },
  { id: "20224", nome: "Execução" },
  { id: "910903", nome: "Somente estoque" },
  { id: "20", nome: "Cancelada" }
];

export const MOCK_STATUS_VENDA: GCSituacao[] = [
  { id: "17", nome: "Em aberto" },
  { id: "12138", nome: "Em andamento" },
  { id: "3150", nome: "Confirmado" },
  { id: "12139", nome: "Cancelado" }
];

export const MOCK_OS: GCOrdemServico[] = [
  {
    id: "1001", codigo: "OS-2024-001", cliente_id: "501",
    nome_cliente: "Restaurante Bom Sabor Ltda", vendedor_id: "10",
    data: "2026-03-05", situacao_id: "12113", nome_situacao: "Em aberto",
    valor_total: "1.250,00", condicao_pagamento: "a_vista", valor_frete: "0.00",
    produtos: [
      { produto: { produto_id: "p001", variacao_id: "", nome_produto: "Grelha inox 60cm", codigo_produto: "GRL-001", codigo_barras: "7891234560001", sigla_unidade: "UND", quantidade: 2 } },
      { produto: { produto_id: "p002", variacao_id: "", nome_produto: "Resistência 220V 2000W", codigo_produto: "RES-220", codigo_barras: "7891234560002", sigla_unidade: "UND", quantidade: 1 } },
      { produto: { produto_id: "p003", variacao_id: "", nome_produto: "Termostato KSD301", codigo_produto: "TRM-KSD", codigo_barras: "7891234560003", sigla_unidade: "UND", quantidade: 3 } }
    ]
  },
  {
    id: "1002", codigo: "OS-2024-002", cliente_id: "502",
    nome_cliente: "Hotel Grand Palace", vendedor_id: "10",
    data: "2026-03-04", situacao_id: "18", nome_situacao: "Em andamento",
    valor_total: "3.780,00", condicao_pagamento: "a_vista", valor_frete: "0.00",
    produtos: [
      { produto: { produto_id: "p004", variacao_id: "", nome_produto: "Compressor Embraco 1/4HP", codigo_produto: "CMP-EMB-025", codigo_barras: "7891234560004", sigla_unidade: "UND", quantidade: 1 } },
      { produto: { produto_id: "p005", variacao_id: "", nome_produto: "Fluido Refrigerante R404A 10kg", codigo_produto: "FLU-R404A", codigo_barras: "7891234560005", sigla_unidade: "KG", quantidade: 10 } }
    ]
  },
  {
    id: "1003", codigo: "OS-2024-003", cliente_id: "503",
    nome_cliente: "Padaria Central Eireli", vendedor_id: "11",
    data: "2026-03-05", situacao_id: "12113", nome_situacao: "Em aberto",
    valor_total: "890,00", condicao_pagamento: "a_vista", valor_frete: "0.00",
    produtos: [
      { produto: { produto_id: "p006", variacao_id: "", nome_produto: "Borracha porta câmara fria 60x180cm", codigo_produto: "BOR-CF-6018", codigo_barras: "7891234560006", sigla_unidade: "UND", quantidade: 2 } },
      { produto: { produto_id: "p007", variacao_id: "", nome_produto: "Dobradiça inox porta câmara", codigo_produto: "DOB-CF-INX", codigo_barras: "7891234560007", sigla_unidade: "UND", quantidade: 4 } },
      { produto: { produto_id: "p008", variacao_id: "", nome_produto: "Parafuso M6 x 20mm inox", codigo_produto: "PAR-M6-20", codigo_barras: "7891234560008", sigla_unidade: "UND", quantidade: 16 } }
    ]
  }
];

export const MOCK_VENDAS: GCVenda[] = [
  {
    id: "2001", codigo: "VD-2024-101", tipo: "produto", cliente_id: "601",
    nome_cliente: "Buffet Sabores do Mar", vendedor_id: "12",
    data: "2026-03-05", situacao_id: "17", nome_situacao: "Em aberto",
    valor_total: "4.200,00", condicao_pagamento: "a_vista", valor_frete: "0.00",
    produtos: [
      { produto: { produto_id: "p010", variacao_id: "", nome_produto: "Forno Combinado Rational 6GN1/1", codigo_produto: "RAT-SCC61", codigo_barras: "4012992117438", sigla_unidade: "UND", quantidade: 1 } },
      { produto: { produto_id: "p011", variacao_id: "", nome_produto: "Kit Acessórios Rational", codigo_produto: "RAT-ACESS-KIT", codigo_barras: "4012992200000", sigla_unidade: "KIT", quantidade: 1 } }
    ]
  },
  {
    id: "2002", codigo: "VD-2024-102", tipo: "produto", cliente_id: "602",
    nome_cliente: "Cozinha Industrial SP Ltda", vendedor_id: "12",
    data: "2026-03-03", situacao_id: "12138", nome_situacao: "Em andamento",
    valor_total: "1.150,00", condicao_pagamento: "parcelado", valor_frete: "35.00",
    produtos: [
      { produto: { produto_id: "p012", variacao_id: "", nome_produto: "Detergente Enzimático 5L WeDo Pro", codigo_produto: "QUI-ENZ-5L", codigo_barras: "7898765430001", sigla_unidade: "LT", quantidade: 10 } },
      { produto: { produto_id: "p013", variacao_id: "", nome_produto: "Desincrustante Alcalino 5L WeDo Pro", codigo_produto: "QUI-ALK-5L", codigo_barras: "7898765430002", sigla_unidade: "LT", quantidade: 5 } }
    ]
  }
];

// --- COMPRAS MODULE MOCKS ---

export const MOCK_STATUS_ORCAMENTO: GCSituacao[] = [
  { id: "6919", nome: "Confirmado" },
  { id: "6917", nome: "Em aberto" },
  { id: "6918", nome: "Em andamento" },
  { id: "6920", nome: "Cancelado" },
];

export const MOCK_ORCAMENTOS: GCOrcamento[] = [
  {
    id: "3001", codigo: "ORC-2024-001", cliente_id: "701",
    nome_cliente: "Restaurante Bom Sabor Ltda", vendedor_id: "10",
    data: "2026-03-04", situacao_id: "6919", nome_situacao: "Confirmado",
    valor_total: "2.350,00",
    produtos: [
      { produto: { produto_id: "p001", variacao_id: "", nome_produto: "Grelha inox 60cm", codigo_produto: "GRL-001", sigla_unidade: "UND", quantidade: 3, movimenta_estoque: "1" } },
      { produto: { produto_id: "p004", variacao_id: "", nome_produto: "Compressor Embraco 1/4HP", codigo_produto: "CMP-EMB-025", sigla_unidade: "UND", quantidade: 2, movimenta_estoque: "1" } },
    ]
  },
  {
    id: "3002", codigo: "ORC-2024-002", cliente_id: "702",
    nome_cliente: "Hotel Grand Palace", vendedor_id: "10",
    data: "2026-03-05", situacao_id: "6919", nome_situacao: "Confirmado",
    valor_total: "1.890,00",
    produtos: [
      { produto: { produto_id: "p004", variacao_id: "", nome_produto: "Compressor Embraco 1/4HP", codigo_produto: "CMP-EMB-025", sigla_unidade: "UND", quantidade: 1, movimenta_estoque: "1" } },
      { produto: { produto_id: "p006", variacao_id: "", nome_produto: "Borracha porta câmara fria 60x180cm", codigo_produto: "BOR-CF-6018", sigla_unidade: "UND", quantidade: 4, movimenta_estoque: "1" } },
    ]
  },
  {
    id: "3003", codigo: "ORC-2024-003", cliente_id: "703",
    nome_cliente: "Padaria Central Eireli", vendedor_id: "11",
    data: "2026-03-05", situacao_id: "6919", nome_situacao: "Confirmado",
    valor_total: "780,00",
    produtos: [
      { produto: { produto_id: "p003", variacao_id: "", nome_produto: "Termostato KSD301", codigo_produto: "TRM-KSD", sigla_unidade: "UND", quantidade: 5, movimenta_estoque: "1" } },
    ]
  },
];

export const MOCK_PRODUTOS_DETALHE: Record<string, GCProdutoDetalhe> = {
  "p001": { id: "p001", nome: "Grelha inox 60cm", codigo_interno: "GRL-001", codigo_barra: "7891234560001", estoque: 1, valor_custo: "85.00", movimenta_estoque: "1", fornecedores: [{ id: "f001" }] },
  "p003": { id: "p003", nome: "Termostato KSD301", codigo_interno: "TRM-KSD", codigo_barra: "7891234560003", estoque: 10, valor_custo: "22.50", movimenta_estoque: "1", fornecedores: [{ id: "f002" }] },
  "p004": { id: "p004", nome: "Compressor Embraco 1/4HP", codigo_interno: "CMP-EMB-025", codigo_barra: "7891234560004", estoque: 0, valor_custo: "420.00", movimenta_estoque: "1", fornecedores: [{ id: "f001" }] },
  "p006": { id: "p006", nome: "Borracha porta câmara fria 60x180cm", codigo_interno: "BOR-CF-6018", codigo_barra: "7891234560006", estoque: 2, valor_custo: "48.00", movimenta_estoque: "1", fornecedores: [{ id: "f002" }] },
};

export const MOCK_FORNECEDORES: Record<string, GCFornecedor> = {
  "f001": { id: "f001", nome: "Frigelar Distribuidora Ltda", telefone: "(11) 3344-5566", email: "compras@frigelar.com.br" },
  "f002": { id: "f002", nome: "Insumos Técnicos WeDo", telefone: "(11) 99988-7766", email: "pedidos@insumoswedo.com.br" },
};

// --- COMPRAS (Purchase Orders) MOCKS ---

export const MOCK_STATUS_COMPRA: GCSituacaoCompra[] = [
  { id: "15", nome: "Confirmada", padrao: "0", tipo_lancamento: "1" },
  { id: "13", nome: "Em aberto", padrao: "1", tipo_lancamento: "0" },
  { id: "14", nome: "Em andamento", padrao: "0", tipo_lancamento: "0" },
  { id: "16", nome: "Cancelada", padrao: "0", tipo_lancamento: "0" },
  { id: "4010", nome: "Finalizado", padrao: "0", tipo_lancamento: "1" },
];

export const MOCK_ORDENS_COMPRA: GCOrdemCompra[] = [
  {
    id: "9001", codigo: "PC-001",
    fornecedor_id: "f001", nome_fornecedor: "Frigelar Distribuidora Ltda",
    data_emissao: "2026-03-03", situacao_id: "13", nome_situacao: "Em aberto",
    valor_total: "840,00",
    produtos: [
      { produto: { id: "item1", produto_id: "p004", variacao_id: "", nome_produto: "Compressor Embraco 1/4HP", quantidade: "2.00", valor_custo: "420.00" } },
    ]
  },
  {
    id: "9002", codigo: "PC-002",
    fornecedor_id: "f002", nome_fornecedor: "Insumos Técnicos WeDo",
    data_emissao: "2026-03-04", situacao_id: "14", nome_situacao: "Em andamento",
    valor_total: "192,00",
    produtos: [
      { produto: { id: "item2", produto_id: "p006", variacao_id: "", nome_produto: "Borracha porta câmara fria", quantidade: "4.00", valor_custo: "48.00" } },
    ]
  },
];
