import { GCSituacao, GCOrdemServico, GCVenda } from './types';

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
