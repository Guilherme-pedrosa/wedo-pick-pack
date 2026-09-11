# Auditoria dos fluxos operacionais — 11/09/2026

Base: `1dbe91e73c681505dfc8b9454a005f542dc80ee7`. Branch: `codex/auditoria-fluxos`.
As alterações de notificação do usuário foram preservadas. Nenhuma mensagem foi enviada ao agente do Lovable.

## Correções

| Fluxo | Falha encontrada | Comportamento corrigido |
| --- | --- | --- |
| Checkout de OS e vendas | Venda não passava pela conferência final de disponibilidade; OS fora dos filtros também podia escapar | Relê somente o documento selecionado e os produtos necessários antes de confirmar, verifica a quantidade atual e considera outros compromissos válidos. Estoque já movimentado não é descontado novamente. |
| Alteração de situação no GC | Funções antigas reconstruíam descontos, pagamentos e valores a partir de dados possivelmente antigos | GET atual obrigatório, preservação dos dados comerciais, uma única atualização e leitura de confirmação. Falha ou divergência impede afirmar sucesso. |
| Conferência | Repetir o clique podia reiniciar contagens; recarregar perdia a sessão | Clique no pedido ativo preserva contagens; conferência persistida por usuário. |
| Falha depois da baixa | Repetir conclusão após erro no histórico podia reenviar a atualização ao GC | Confirmação do GC persistida; nova tentativa salva somente o histórico, com identificador estável para evitar duplicação. |
| Carregamento | O pacote inicial incluía todas as páginas, bibliotecas de impressão e diagramas | Páginas carregadas sob demanda, com aviso de carregamento e recuperação de erro. Entrada caiu de 5.569 kB para 631 kB; gzip de 1.597 kB para 188 kB. Isso não representa uma medição do tempo total do GC. |
| Estoque e variações | Resposta sem saldo, produto incorreto ou variação ausente podia usar saldo genérico | Leitura estrita, identidade e variação verificadas. Varredura agrega linhas repetidas e não usa documentos já baixados como novos compromissos. |
| Baixas parciais | Estado do orçamento podia esconder lote que falhou; confirmação repetida podia alterar os saldos | Confirmação idempotente, validação das reservas, estado derivado dos lotes e Dashboard incluindo confirmações pendentes. Sem pintar verde sem baixa confirmada. |
| Compras | Quantidade do orçamento original podia mudar depois da abertura da baixa | Versão 3 relê cada origem no GC, calcula necessidade com as quantidades atuais e preserva os fatos de retirada/reserva. Relê novamente antes de publicar; aumento e novos itens entram em compras. Redução incompatível gera erro e preserva a lista anterior. |
| Auvo parcial | Venda parcial usava questionário de serviço; duas requisições podiam criar duas tarefas | Venda usa questionário 224444, OS usa 214757. Trava persistente de criação e registro imediato do número da tarefa. Falha na amarração ao GC fica visível e pode reparar o mesmo vínculo. |
| Maletas | Devolver um único item podia estornar toda a maleta; falha no GC removia o técnico | Estorno integral só com conferência completa. Falta de ferramentas mantém vínculo e referência. Devolução individual com saída GC ativa é bloqueada; usar conferência integral. Saída e entrada têm registro persistente para impedir repetição incerta. |
| Produtos | Incremental parava perto de 190/500 e ignorava saldo/custo quando nome/código não mudavam | Leitura paginada completa do catálogo, validação da contagem e atualização dos produtos recentes, de caixas e maletas, incluindo saldo e custo. |

## Validação local

- 229 testes, 32 arquivos, todos aprovados. Incluem concorrência/repetição, pedidos parcialmente baixados, falha de leitura do GC, pagamentos preservados, variações ausentes, troca de usuário, venda com estoque comprometido, produto no final da paginação e cadastro removido confirmado por HTTP 404.
- `npx tsc --noEmit -p tsconfig.app.json`: aprovado.
- `npm run build`: aprovado. Persistem avisos de tamanho de bibliotecas carregadas somente em suas páginas.
- Funções `partial-writeoff` e `sync-products`: compilação isolada aprovada.
- Varredura real somente de leitura, com a versão 3: 23 produtos a comprar, 27 cobertos por pedido, 7 baixas parciais, 24 documentos. Uma execução posterior pode refletir movimentações dos usuários.

## Banco aplicado e preservação

As cinco migrações de `20260912003000` a `20260912007000` foram ensaiadas com ROLLBACK e aplicadas juntas em uma transação. Backup antes e comparação depois confirmaram:

- Todos os itens e quantidades, reservas, retiradas, itens dos lotes e campos preexistentes dos lotes permaneceram iguais.
- 6277: operação passou a expor a confirmação pendente que já existia no lote 10228.
- 6278: a confirmação feita pelo usuário às 19:04 foi preservada; operação aguardando saldo.
- 6438: removida apenas a mensagem antiga sobre horas técnicas; baixas confirmadas e quantidades preservadas.
- 4784: 15 unidades retiradas e tarefas anteriores preservadas; documento definitivo não recriado.
- 6668: venda manual não foi criada, substituída ou alterada.

## Limites da comprovação

Não foram criadas OS, vendas, tarefas Auvo ou movimentações físicas fictícias para testar produção. A conferência física da OS 10228 continua sendo uma ação operacional da equipe. Divergências entre o orçamento atual e a referência de uma baixa bloqueiam novas movimentações até a reconciliação; compras considera a necessidade atual sem reescrever o orçamento.

Esta revisão cobre os fluxos e falhas descritos acima, com testes de regressão e conferências de produção. Não equivale a uma garantia de ausência de qualquer defeito em todas as integrações ou a um teste de execução física de todos os processos.

## Publicação e comprovação em produção

- Código principal: `d4a3d98`; publicação manual das funções: `83b6a84`. Tratamento de cadastro removido: `1b6c5bb`, função publicada por `728be84`. O editor formatou os arquivos; a comparação do JavaScript compilado confirmou conteúdo executável idêntico ao validado localmente.
- A interface pública passou a carregar páginas sob demanda (32 imports separados) e o controle de conferências por usuário. O endpoint da baixa parcial respondeu HTTP 200 com versão `2026-09-11-audit-v3`, questionário de venda 224444 e trava de criação ativa.
- [Rotina de compras 34652929944](https://github.com/Guilherme-pedrosa/wedo-pick-pack/actions/runs/34652929944): **success**, 208.366 ms. Snapshot `02d2dd69-d8b5-44bd-8062-a01006395f6b`, publicado às 19:15:40: versão 3, **26 produtos a comprar, 27 cobertos por pedido, 24 documentos e 7 baixas parciais**, sem avisos. O número mudou em relação ao ensaio porque houve movimentação real durante a revisão. Cron antigo `compras-auto-scan-3h` continua desativado; execução do GitHub permanece a cada três horas.
- Sincronização incremental `37aa6a43-355a-4638-88a2-04590c2d1db5`: **success**, HTTP 200, cerca de 36 segundos, **514 produtos atualizados e zero erros**.
- O 515º identificador era `88006382`, CABO PP 3X2,5 MM, cadastro removido do GC (404). Histórico mostra sua inclusão na Caixa Refrigeração 3 em 31/08/2026. Apenas o índice local foi marcado inativo, com aviso na tela da caixa; **4 unidades e todos os vínculos físicos/históricos preservados**. Nenhuma correspondência com outro código foi presumida.
- Checkout público carregou as 7 linhas da OS 10228. Nenhum item foi marcado; sessão de validação encerrada. Dashboard exibiu 26 necessidades de compra, um lote aguardando Checkout e uma reconciliação. A 6278 exibiu verde nas peças efetivamente baixadas. Compras concluiu sua atualização local às 19:25:15 com 26 itens e 7 baixas parciais incluídas. Caixas exibiu o aviso do cabo removido e a quantidade 4; Maletas carregou as 11 vinculadas; Etiquetas carregou seu seletor. Console das telas verificadas sem erros de execução. Bundle público final conferido: `/assets/index-D4hfPYyf.js`.

As evidências completas de banco antes/depois, testes, build, respostas das funções e execução da varredura ficam em `outputs/pick-pack-evidence/`, fora do repositório público.
