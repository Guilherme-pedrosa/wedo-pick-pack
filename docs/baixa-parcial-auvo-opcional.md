# Tarefa Auvo opcional por OS parcial

Solicitação de 11/09/2026: escolher, em cada abertura de OS parcial, se haverá tarefa Auvo.

- Campo **Criar tarefa no Auvo para esta OS**, inicialmente desmarcado e restrito a OS.
- Escolha persistida no lote antes de criar o documento GC; tentativas com a mesma chave não podem mudar a escolha.
- Desmarcado: nenhuma chamada de criação de tarefa. Marcado: usa a ação existente `partial-writeoff/create_batch_task`, com credenciais exclusivamente no servidor.
- Tarefa já vinculada é reutilizada. Falha permanece visível no histórico, com opção de tentar novamente. A consolidação aguarda as tarefas explicitamente solicitadas.
- `NULL` preserva o comportamento dos lotes históricos; não há preenchimento retroativo nem alteração de tarefas, quantidades ou orçamento.
- A opção não muda o fluxo de estoque: reserva continua reserva, execução parcial continua execução parcial.
- A consolidação transfere todos os vínculos existentes; não chama exclusão de tarefas Auvo.

## Implementação e validação

Base: `1270138ea4abdc606eaa2932ade3ff32ccde4d6a`.
Migração: `20260911223000_partial_auvo_choice.sql`, usando o controle global de estoque já existente, com gravação atômica da escolha e guarda da consolidação no banco.

Validados: 135 testes Vitest, `npx tsc --noEmit -p tsconfig.app.json`, `npm run build` e `scripts/test-partial-auvo-choice.mjs` em PostgreSQL/PGlite isolado.
Os testes verificam opt-out sem invocar Auvo, opt-in nos dois fluxos, reutilização de vínculo, falha persistida, proteção contra falsa confirmação, documento cancelado, legado, preservação do orçamento e bloqueio da consolidação com tarefa solicitada pendente.

O frontend usa a ação de criação já existente desde agosto. O código correspondente da Edge Function também foi atualizado no GitHub para respeitar a escolha, inclusive quando receber uma abertura diretamente. Publicação de frontend não comprova atualização de Edge Functions. A validação não cria OS ou tarefas fictícias na produção.
