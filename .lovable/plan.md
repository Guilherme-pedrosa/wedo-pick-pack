# Motor de Planejamento de Compras — Backend-first

## Princípio
GestãoClick = fonte de dados brutos. Pick Pack (Supabase) = cérebro. O cálculo de necessidade sai da `InventoryAnalysisPage.tsx` e passa a rodar numa Edge Function dedicada, salvando resultado em tabelas. A tela só exibe, filtra, exporta e aprova.

Chave de análise única: **`produto_id`**. Nunca `item_key` nem `variacao_id`.

---

## Fase 1 — Banco de dados (migração)

### `inventory_planning_runs`
Cabeçalho de cada execução: `started_at`, `finished_at`, `status`, `lookback_days`, `products_analyzed`, `suggestions_count`, `total_estimated_value`, `errors_count`, `notes`.

### `inventory_purchase_suggestions`
Uma linha por produto sugerido, vinculada a `run_id`. Campos: identificação (`produto_id`, `nome`, `codigo_interno`, `grupo`, `fornecedor_id`, `fornecedor_nome`, `valor_custo`), métricas de consumo (`estoque_atual`, `consumo_12m`, `consumo_3m`, `event_count`, `source_count`, `client_count`, `media_historica_mensal`, `media_recente_mensal`, `demanda_prevista_mensal`, `monthly_std_dev`, `cv`, `adi`), classificações (`abc_class`, `xyz_class`, `demand_pattern`), política (`lead_time_days`, `safety_stock`, `operational_minimum`, `reorder_point`, `max_stock`), cruzamentos (`orcamento_qty`, `orcamento_ponderado_qty`, `pc_aberta_qty`, `saldo_projetado`, `qty_sugerida`, `risk_score`), e `motivos`/`alertas` (jsonb), além de `aprovado`, `gc_compra_id` para o vínculo pós-criação.

### `inventory_policy_overrides`
Exceções manuais por peça: `produto_id` (único), `criticality`, `min_qty_override`, `max_qty_override`, `do_not_stock`, `preferred_supplier_id`, `lead_time_override_days`, `notes`.

Todas com GRANTs (authenticated + service_role), RLS habilitado, policies para usuários autenticados, e trigger `updated_at`.

---

## Fase 2 — Edge Function `inventory-planning-run`
Orquestra tudo no backend (respeitando rate limit GC: batching ~1.1s, retries):
1. Lê `products_index` (produtos ativos que movimentam estoque).
2. Lê `inventory_consumption_events` (consumo histórico já sincronizado).
3. Estoque atual: usa cache local / bulk-stock; sinaliza alerta quando ausente.
4. PCs em aberto: situações de `inventory_policy_config.purchase_crossref_situacao_ids`; ignora antigas (>90d → alerta, não desconta).
5. Orçamentos pendentes: situações de `budget_crossref_situacao_ids`; pondera por situação (aprovado 1.0 / aguardando 0.7 / negociação 0.4 / fallback 0.7).
6. Lead time por fornecedor de `supplier_lead_times` (fallback 21d).
7. Aplica `inventory_policy_overrides`.
8. Roda o motor (série 12m com meses zerados, ABC/XYZ, padrão de demanda, mínimo operacional, safety stock por z-score, ROP, estoque máximo por cobertura, saldo projetado, condição de compra, bloqueios anti-ruído).
9. Grava `inventory_planning_runs` + `inventory_purchase_suggestions`.

A fórmula reaproveita a lógica já existente hoje na página (já validada) — apenas portada para Deno e persistida.

## Fase 3 — Edge Function `create-gc-purchase-from-suggestions`
Recebe `suggestion_ids`, valida `qty_sugerida > 0`, agrupa por `fornecedor_id`, monta `POST /api/compras` (via proxy GC existente), cria a compra, salva `gc_compra_id` na sugestão. **Nunca cria sem aprovação explícita.**

## Fase 4 — Cron diário
Encadear às 06:00 BRT: `sync-products` → `inventory-consumption-sync` → `inventory-lead-time-sync` → `inventory-planning-run` (via pg_cron + pg_net, com anon key, usando insert tool).

## Fase 5 — Refatorar `InventoryAnalysisPage.tsx`
Para de ser o motor. Passa a: botão "Rodar Planejamento" (chama a function), mostrar último run, listar `inventory_purchase_suggestions` via React Query, filtros (fornecedor/risco/grupo/valor), exportar CSV (UTF-8 BOM, `;`), selecionar itens e "Gerar Compra no GestãoClick" agrupado por fornecedor.

---

## Detalhes técnicos
- Aba "Lista de Compras" lê da tabela, não recalcula no cliente.
- Mantém formatação pt-BR e exportação CSV com BOM/`;` (regra do projeto).
- Identificação sempre `[Código Interno] Nome`.
- Motivos/alertas exibidos por linha, como hoje, vindos do jsonb persistido.

## Ordem de execução
1. Migração (Fase 1) — requer aprovação.
2. Functions (Fases 2–3).
3. Cron (Fase 4).
4. Refatorar tela (Fase 5).

## Observação
Esta é uma reescrita grande. Sugiro fazer Fase 1+2+5 primeiro (gerar e exibir sugestões persistidas) e validar os números contra a tela atual antes de ligar criação de compra (Fase 3) e o cron (Fase 4).
