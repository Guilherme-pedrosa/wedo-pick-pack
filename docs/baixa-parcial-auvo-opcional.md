# Tarefa Auvo opcional por OS parcial

Solicitação de 11/09/2026: escolher, em cada abertura de OS parcial, se haverá tarefa Auvo.

- Campo **Criar tarefa no Auvo para esta OS**, marcado por padrão em cada nova abertura e restrito a OS. O operador pode desmarcar.
- Escolha persistida no lote antes de criar o documento GC; tentativas com a mesma chave não podem mudar a escolha.
- Desmarcado: nenhuma chamada de criação de tarefa. Marcado: usa a ação existente `partial-writeoff/create_batch_task`, com credenciais exclusivamente no servidor.
- Tarefa já vinculada é reutilizada. Falha permanece visível no histórico, com opção de tentar novamente. A consolidação aguarda as tarefas explicitamente solicitadas.
- `NULL` preserva o comportamento dos lotes históricos; não há preenchimento retroativo nem alteração de tarefas, quantidades ou orçamento.
- A opção não muda o fluxo de estoque: reserva continua reserva, execução parcial continua execução parcial.
- A consolidação transfere todos os vínculos existentes; não chama exclusão de tarefas Auvo.
- O histórico oferece **Criar tarefa no Auvo** nos lotes ativos com documento GC e sem tarefa, inclusive quando a opção foi desmarcada na abertura. Operações encerradas, em consolidação ou com documento definitivo não aceitam essa ação.
- A solicitação posterior relê o orçamento no GC e valida as quantidades antes de registrar a intenção. A RPC `partial_writeoff_request_auvo_task` exige autenticação e perfil Auvo, preserva a escolha original no evento de abertura e acrescenta o evento `auvo_task_requested_later`. Uma falha na criação permanece pendente no histórico para nova tentativa.

## Implementação e validação

Base: `1270138ea4abdc606eaa2932ade3ff32ccde4d6a`.
Migração: `20260911223000_partial_auvo_choice.sql`, usando o controle global de estoque já existente, com gravação atômica da escolha e guarda da consolidação no banco.

Validados: 135 testes Vitest, `npx tsc --noEmit -p tsconfig.app.json`, `npm run build` e `scripts/test-partial-auvo-choice.mjs` em PostgreSQL/PGlite isolado.
Os testes verificam opt-out sem invocar Auvo, opt-in nos dois fluxos, reutilização de vínculo, falha persistida, proteção contra falsa confirmação, documento cancelado, legado, preservação do orçamento e bloqueio da consolidação com tarefa solicitada pendente.

O frontend usa a ação de criação já existente desde agosto. O código correspondente da Edge Function também foi atualizado no GitHub para respeitar a escolha, inclusive quando receber uma abertura diretamente. Publicação de frontend não comprova atualização de Edge Functions. A validação não cria OS ou tarefas fictícias na produção.

Complemento de 11/09/2026, base `98e6c7fd2e39048b74c378d00b88f37c6e8f42d0`: migração `20260911230000_partial_auvo_late_request.sql`, novo padrão e criação posterior. A migração altera funções; não atualiza escolhas de lotes existentes nem quantidades. O frontend registra a intenção por RPC antes de chamar a ação de criação de tarefa já disponível no servidor.

Validação do complemento: 150 testes Vitest, typecheck do projeto app, build e teste SQL/PGlite passaram. Após aplicar a migração em produção, os hashes integrais permaneceram iguais para as 9 operações, 108 itens, 16 lotes, 104 itens de lotes e 86 eventos. A tarefa da OS 10226 não foi criada como teste.
