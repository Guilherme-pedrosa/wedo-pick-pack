# Vendas de produtos pelo Rastreador

Solicitação de 11/09/2026: orçamento aprovado com venda gerada, venda aguardando separação e questionário de venda no Auvo.

## Cadastros conferidos

| Destino | Cadastro correto | ID |
|---|---|---|
| Orçamento | APROVADO - Venda Gerada | 7706107 |
| Venda | AGUARDANDO SEPARAÇÃO | 9303817 |
| Tarefa Auvo | Formulário de Venda de Equipamento/Peças/Produto | 224444 |

Situações consultadas na API GC em `/api/situacoes_orcamentos` e `/api/situacoes_vendas`. Questionário conferido na sessão autenticada Auvo: https://app2.auvo.com.br/gerenciarQuestionarios/questionario/224444. O ID anterior 214757 corresponde a EXECUÇÃO DE SERVIÇOS.

## Mudança

`generate-os` agora seleciona regras por tipo de documento. O caminho de venda do Rastreador usa os três vínculos acima. OS de serviço continua com orçamento 7109779, OS 7063581 e questionário 214757. O tipo de tarefa de entrega de venda continua 200268.

A consolidação de entregas parciais é um caminho separado: mantém a situação 8955109 da venda definitiva, que já representa peças separadas. Sua tarefa de venda também usa o formulário de produto.

Não há migração ou correção em massa de documentos/tarefas anteriores. Não há modificação das quantidades, valores, descontos ou do fluxo de estoque das OS de serviço.

## Validação e implantação

`src/api/generateSalesRouting.test.ts` executa o handler real com HTTP simulado: confere requisições GC/Auvo, produto versus serviço, consolidação parcial e preservação de quantidades/valores. Nenhum documento ou tarefa fictícia é criado em produção.

A ação somente de leitura `generation_rules` identifica a versão realmente implantada. Executar `node scripts/check-generation-rules.mjs`: só retorna sucesso quando a função ativa responde com a versão `2026-09-11-product-sales-v1` e os três IDs corretos. Sincronização GitHub ou publicação do frontend, isoladamente, não comprova implantação desta função.

Base: `f5705c36ab8c1fc84039fd35aa87bd664db2cd44`. A implantação precisa respeitar a proibição do usuário de enviar mensagens à IA do Lovable.
