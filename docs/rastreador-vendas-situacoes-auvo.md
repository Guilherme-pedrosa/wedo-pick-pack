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

`generate-os` seleciona regras pelo tipo do orçamento confirmado nas coleções `orcamentos_produtos` e `orcamentos_servicos` do GC. Orçamento de produto gera venda; orçamento de serviço gera OS. A existência de linhas de serviço ou seu valor não determina o tipo. O caminho de venda do Rastreador usa os três vínculos acima. OS de serviço continua com orçamento 7109779, OS 7063581 e questionário 214757. O tipo de tarefa de entrega de venda continua 200268.

A consolidação de entregas parciais é um caminho separado: mantém a situação 8955109 da venda definitiva, que já representa peças separadas. Sua tarefa de venda também usa o formulário de produto.

Não há migração ou correção em massa de documentos/tarefas anteriores. Não há modificação das quantidades, valores, descontos ou do fluxo de estoque das OS de serviço.

## Validação e implantação

`src/api/generateSalesRouting.test.ts` executa o handler real com HTTP simulado: confere requisições GC/Auvo, produto versus serviço, consolidação parcial e preservação de quantidades/valores. Nenhum documento ou tarefa fictícia é criado em produção.

A ação somente de leitura `generation_rules` identifica a versão realmente implantada. Executar `node scripts/check-generation-rules.mjs`: só retorna sucesso quando a função ativa responde com a versão `2026-09-11-budget-kind-v2` e os três IDs corretos. Sincronização GitHub ou publicação do frontend, isoladamente, não comprova implantação desta função. A tela também consulta essa versão e bloqueia a geração se o servidor ainda estiver na regra antiga.

Base: `f5705c36ab8c1fc84039fd35aa87bd664db2cd44`. A implantação precisa respeitar a proibição do usuário de enviar mensagens à IA do Lovable.

## Regressão 6668 — 11/09/2026

Base do complemento: `e18312d193bc82635ce2d5e35020e00e92f8bddc`.
O orçamento 6668 (397913178), Cargill Novos Horizontes, está na coleção de produtos. Ele inclui seis horas técnicas com desconto de 100%, valor de serviços zero. A regra anterior escolhia OS porque havia uma linha em `servicos`. A tela também fixava “Gerar OS” para todos os orçamentos.

O Rastreador agora preserva o tipo vindo da coleção GC, apresenta “Gerar Venda”/“Gerar OS” e relê o orçamento e seu tipo na confirmação e no servidor antes de qualquer criação. Tipo ausente, ambíguo ou alterado bloqueia o envio. A atualização de situação relê novamente o orçamento, preservando seus campos comerciais, serviços gratuitos, quantidades e preços unitários com a precisão original. Linhas repetidas legítimas do GC são preservadas.

Teste do 6668: dois produtos, uma unidade de cada, desconto R$ 1.731,18, frete R$ 350,00, total R$ 3.078,06; venda e formulário Auvo de produto; nenhuma OS; seis horas gratuitas preservadas no orçamento. Também há testes para orçamento de serviço sem linhas de serviço, falha/ambiguidade do catálogo, servidor antigo e duplicatas legítimas de linhas.

Validação local: 161 testes, typecheck do projeto app e build. Na inspeção inicial, 6668 continuava aprovado aguardando compra e não havia registro de geração nos logs; nenhum documento ou tarefa foi criado como teste.

## Ativação confirmada — 11/09/2026

A correção foi sincronizada pelo GitHub no commit `48a91e6e303a055c55a51f8078ad602514839ab5`. O salvamento manual do arquivo da função pelo Code Editor do Lovable ativou a implantação e produziu o commit `171480b6a763d5f7c6131fccb9eaed6597667ace`, sem mensagem à IA. Esse salvamento acrescentou um comentário, formatou o arquivo e atualizou o lockfile; a comparação do código executável normalizado por esbuild confirmou equivalência com a correção validada.

Após o salvamento, `node scripts/check-generation-rules.mjs` confirmou HTTP 200, `ready: true` e versão ativa `2026-09-11-budget-kind-v2`, incluindo os vínculos corretos de venda e Auvo. O frontend também foi publicado e seu bundle público conferido. Para futuras implantações, salvar manualmente a função no Code Editor é uma alternativa sem mensagem à IA; sempre confirmar a versão ativa com a consulta de leitura, pois apenas o push não comprova implantação.

O usuário informou que a venda do orçamento 6668 já foi gerada manualmente. Nenhuma venda, OS ou tarefa Auvo foi criada ou alterada durante esta validação em produção.
