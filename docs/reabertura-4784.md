# Reabertura do orçamento 4784

Atualização: a reabertura foi aplicada em produção. A continuidade do fluxo e sua automação estão documentadas em [baixa-parcial-fluxos.md](baixa-parcial-fluxos.md). O texto abaixo descreve o escopo histórico da primeira migração.

Base: `8977242dfe912550fd265675e6495eb3e9bd4274`.

Esta alteração reabre a operação como `awaiting_execution`. Não implementa a
nova automação de consolidação após execução. A RPC atual rejeita consolidação
nesse estado: a última execução e o estoque da OS 10138 precisam ser conferidos
antes de permitir qualquer nova geração. Não criar outra OS por mera ausência
do vínculo definitivo.

## Aplicação

Publicar o frontend e aplicar a migration
`20260911170000_reopen_4784_awaiting_execution.sql` pelo processo de banco do
projeto. Um push Git não equivale à aplicação desta migration. Nenhuma mensagem
ao agente Lovable é necessária nem autorizada por este pacote.

A migration não chama GC/Auvo, não exclui documentos nem tarefas, não altera
quantidades e não muda a situação do orçamento no GC. Ela salva os registros
anteriores num evento, restaura os dois lotes como `confirmed` (baixa aplicada),
invalida o log de conclusão antecipada e limpa o vínculo definitivo ativo e a
data de conclusão. A OS 10138 / tarefa 78957536 permanecem no histórico e nos
sistemas de origem. Lotes 10034/10137 mantêm tarefas 78145019/78949564.

Se o estado ou saldo tiver mudado, a migration aborta: revisar a divergência,
sem remover as validações. O teste local cobre rollback e reexecução.

## Verificação de produção (somente leitura)

```sql
SELECT budget_code, status, definitive_document_id, completed_at
FROM partial_writeoff_operations
WHERE id = '5d213137-682e-4901-9b3c-e0e7818cb83d';
-- awaiting_execution, vínculo e data nulos

SELECT sequence, status, auxiliary_document_code, auvo_task_id
FROM partial_writeoff_batches
WHERE operation_id = '5d213137-682e-4901-9b3c-e0e7818cb83d'
ORDER BY sequence;
-- ambos confirmed; tarefas preservadas

SELECT sum(original_quantity), sum(withdrawn_quantity), sum(reserved_quantity)
FROM partial_writeoff_items
WHERE operation_id = '5d213137-682e-4901-9b3c-e0e7818cb83d';
-- 15 / 15 / 0
```

## Teste PostgreSQL isolado

Instalar `@electric-sql/pglite` em um diretório temporário. Definir
`PGLITE_MODULE` como URL file absoluta de `dist/index.js` desse pacote e rodar
`node scripts/test-4784-migration.mjs`. Não requer credenciais de produção.
