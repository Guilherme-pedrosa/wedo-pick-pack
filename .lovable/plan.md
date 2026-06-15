# Análise de Estoque — Giro real, Sinal de Orçamento e Lead Time por compra

Reescrita profunda da Análise de Estoque para separar **dinheiro (ABC)** de **giro (recorrência)**, usar orçamento pendente apenas como sinal para peças que já giram, e calcular lead time pelo histórico real de pedidos de compra.

## Já implementado (mensagem anterior — base de giro)
- `classe_giro` (ALTO / MEDIO / BAIXO / SEM_GIRO) por `source_count_90d/180d` e meses com saída.
- `status_estoque` (COMPRAR_ESTOQUE / REVISAR_MANUALMENTE / NAO_ESTOCAR / ESTOQUE_OK).
- Gate: item só entra na compra automática com giro ALTO/MEDIO ou política manual; item caro (> R$ 500) com 1 evento → REVISAR_MANUALMENTE, qty 0; orçamento não promove item sem giro.
- Aba Ranking ABC mostra ABC financeiro, giro, eventos, 90d, 180d, dias desde último consumo, decisão de estoque. Export CSV atualizado.

## Fase 1 — Demanda separada na Análise (`InventoryAnalysisPage.tsx`)
Substituir o cálculo único de `qty` por três campos:
- `stockDemandQty` — do consumo real (`forecastMonthly`, `getMinShelfQty`, `getCoverageDaysByCost` por custo).
- `budgetSignalQty` — soma `qtd_orcamento * fator_situacao` (quase-aprovado 0.70, negociação 0.40, default 0.50; configurável).
- `suggestedQty` — final, só para `isStockEligible`.

Elegibilidade:
```
hasRecentConsumption = recentQty90d > 0 || daysSinceLast <= 90
isRecurring = sourceCount90d>=2 || sourceCount180d>=3 || nonZeroMonths180d>=2 || totalQty180d>=minShelfQty
isStockEligible = (hasRecentConsumption && isRecurring) || manualMinStock>0 || manualStockItem
```
Demanda total (não somar cego):
```
demandaTotal = isStockEligible ? max(stockDemandQty, budgetSignalQty) : 0
suggestedQty = max(0, ceil(demandaTotal - estoqueAtual - pcOpenQty))
```
Orçamento só soma quando houver reserva/OS vinculada que consome estoque.

## Fase 2 — Abas da tela
1. **Comprar agora** — elegíveis com `suggestedQty > 0` (lista atual de compras).
2. **Revisar orçamento sem giro** — produtos em orçamento pendente sem recorrência suficiente (alerta, nunca compra automática).
3. **Estoque recorrente OK** — recorrentes com estoque suficiente.
4. **Ranking ABC** (existente, já com giro).
5. **Lead time fornecedores** (existente, enriquecida na Fase 4).

Colunas/CSV da lista final: fornecedor_preferencial, lead_time_days, lead_time_source, lead_time_confidence, estoque_atual, pc_open_qty, stockDemandQty, budgetSignalQty, demandaTotal, suggestedQty, consumo_90d/180d, sourceCount90d/180d, daysSinceLast, motivos, alertas.

## Fase 3 — Tabelas de fornecedor por compra (migração)
- `product_supplier_history`: produto_id, fornecedor_id, fornecedor_nome, compra_id, compra_codigo, data_emissao, arrival_date, lead_time_days, quantidade, valor_custo, situacao_final, raw, created_at.
- `product_supplier_stats`: produto_id, fornecedor_id, fornecedor_nome, purchase_count, last_purchase_at, total_qty_purchased, avg/median/min/max_lead_time_days, last_unit_cost, confidence_level, updated_at.
- GRANTs (authenticated + service_role) e RLS conforme padrão do projeto.

## Fase 4 — Lead time real (`inventory-lead-time-sync`)
- `leadTimeDays = data_situacao_final − data_emissao` (fallback principal data_emissao).
- Situações finais de `inventory_policy_config.purchase_arrived_situacao_ids` (nova coluna de config); erro claro se vazio.
- `normalizeStatusName()` (sem acento/espaço/caixa) para comparar situações.
- Fornecedor vem do **cabeçalho da compra** (`fornecedor_id`/`nome_fornecedor`), atribuído a cada produto da compra.
- Gera `product_supplier_history` por linha de produto e agrega `product_supplier_stats`.
- Aceitar 1–2 amostras com `confidence_level = low` (remover trava `sample_count >= 3`).
- Não descartar fornecedor por mudança de status em lote — apenas marcar `possible_batch_update`.

Fornecedor preferencial: mais comprado em 365d → mais recente → menor mediana de LT → `products_index.fornecedor_id` → sem fornecedor. `lead_time_source`: produto_fornecedor_historico / fornecedor_historico / mediana_global / fallback_padrao (com alerta no fallback).

## Fase 5 — Espelhar no motor persistido (`inventory-planning-run`)
Aplicar o mesmo gate de giro/elegibilidade e a mesma separação de demanda para a lista automática/cron, mantendo consistência com a tela.

## Detalhes técnicos
- Chave de agregação SEMPRE `produto_id` (sem `item_key`/`variacao_id`).
- Config nova: `purchase_arrived_situacao_ids` e fatores de situação de orçamento em `inventory_policy_config` (editável na Política de Estoque).
- Formatação pt-BR e CSV com BOM/`;` mantidos.

## Critérios de aceite
- Orçamento pendente nunca compra peça sem giro automaticamente.
- Peças recorrentes com estoque baixo entram na compra; PC aberta abate necessidade.
- Lead time = data_emissao → situação final configurada; fornecedor da peça vem da compra.
- Histórico produto×fornecedor criado das compras finalizadas; não depende só do cadastro do produto.
- Ranking ABC pode mostrar item caro como A, mas a lista de compras não o sugere com 1 venda.

Sugiro executar por fases nesta ordem (1→2 dão valor imediato na tela; 3→4 destravam lead time real; 5 alinha o cron). Posso começar pela Fase 1+2 e seguir.