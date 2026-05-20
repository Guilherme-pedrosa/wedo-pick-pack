## Objetivo

Levar os contadores "parados +30 dias" e "com chegada atrasada" do Acompanhamento de Pedidos de Compra para o Dashboard, com snapshot atualizado a cada hora pelo servidor, e exibir um popup global (1x por snapshot) para todos os usuários quando houver pedidos nessas duas categorias.

## Backend

### 1. Tabela `purchase_tracker_settings`
Linha única (singleton) com:
- `watched_situacao_ids text[]` — quais situações de compra varrer (mesmas hoje persistidas em localStorage na página).
- `updated_at timestamptz`.
- RLS: leitura para autenticados, escrita apenas para admin.

### 2. Tabela `purchase_tracker_snapshots`
- `id uuid pk`, `created_at timestamptz`, `status text` (success/error)
- `total int` (total de pedidos varridos)
- `warn_count int` (parados >15 e <=30 dias)
- `crit_count int` (parados >30 dias)
- `arrival_overdue_count int`
- `crit_rows jsonb` / `arrival_rows jsonb` — top N (código, fornecedor, situação, dias)
- `error_message text`
- RLS: leitura para autenticados.

### 3. Edge function `purchase-tracker-snapshot`
- Lê `watched_situacao_ids`.
- Faz a varredura paginada via `gc-proxy` (mesma lógica do `PurchaseTrackerPage.handleScan`/`extractRow`).
- Calcula severidades (stuck dias / atraso chegada).
- Insere linha em `purchase_tracker_snapshots`.

### 4. Cron `pg_cron` horário
Invoca a edge function a cada 1h.

## Frontend

### 5. Página PurchaseTrackerPage
Ao alterar as situações selecionadas, faz upsert em `purchase_tracker_settings` (mantém localStorage como cache, mas o servidor passa a ser fonte de verdade para o cron).

### 6. Dashboard
- Novo card "Compras Atrasadas" (clicável → `/purchase-tracker`) mostrando `crit_count + arrival_overdue_count` com subtítulo "X parados +30 · Y atrasados — atualizado hh:mm".
- Lê o último snapshot success.

### 7. Popup global hourly (componente em `AppLayout`)
- Faz polling a cada 60s no último snapshot.
- Compara `snapshot.id` com `localStorage.lastSeenPurchaseSnapshotId`.
- Se for novo E (`crit_count>0 || arrival_overdue_count>0`) → abre `AlertDialog` com resumo + top rows e botão "Abrir acompanhamento" (navega para `/purchase-tracker`) e "Dispensar" (grava o id como visto).
- Garante que aparece para todos os usuários logados, 1x por novo snapshot.

## Detalhes técnicos

- Reusar `parseFlexibleDate` / `parseGCDate` / `daysBetween` extraindo para `src/lib/purchaseTrackerUtils.ts` (consumido pela página e pelo dashboard se necessário).
- A edge function repete a lógica em Deno (não compartilha código do front) para evitar acoplamento — apenas chama o proxy GC existente.
- Para a primeira execução sem configuração, a função pula com status `skipped` se `watched_situacao_ids` estiver vazio.
- Popup global registrado dentro do layout autenticado já existente (mesmo lugar do header) para garantir cobertura em todas as rotas.
