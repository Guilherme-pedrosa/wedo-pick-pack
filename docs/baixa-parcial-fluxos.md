# Baixa parcial e reserva — correção de 11/09/2026

## Execuções parciais existentes

O 4784 mantém as 15 baixas e as tarefas Auvo das OS 10034 e 10137. A referência da OS 10138 foi retirada da conclusão ativa e preservada no histórico. A OS 10137 ainda está aguardando execução no GestãoClick; nenhuma nova OS deve ser criada enquanto isso.

Quando todas as OS necessárias estiverem executadas e com estoque aplicado, a rotina confere orçamento, quantidades integrais, cobertura das auxiliares e financeiro. Cria primeiro a OS integral sem estoque, persiste o ID, relê e valida o documento; então cancela os auxiliares com a referência da definitiva e aplica a baixa integral. Falhas preservam o ID para retomada. Nenhuma tarefa Auvo é criada ou apagada por esse caminho.

## Novas reservas

Novas operações usam `flow_mode=reservation`. Reservar aplica a indisponibilidade no GC sem criar tarefa Auvo ou execução. O controle mostra essas quantidades como “Reservado no GC”. Internamente, `withdrawn_quantity` representa a movimentação de estoque já confirmada; nesse modo não representa saída física ao cliente.

Ao completar as peças de uma OS, a reserva é transferida para uma OS integral aguardando Checkout. Essa OS é criada e conferida antes de liberar os auxiliares. O cálculo de compromisso global passa a considerá-la imediatamente. O Checkout posterior aplica a saída definitiva. As operações anteriores continuam no modo de execução parcial.

## Compromisso de estoque

Todas as páginas de OS são consultadas. Só comprometem estoque as situações AGUARDANDO COMPRA DE PEÇAS, AGUARDANDO CHEGADA DE PEÇAS, AGUARDANDO FABRICAÇÃO, PEDIDO EM CONFERENCIA, SERVICO AGUARDANDO EXECUCAO e PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO, desde que `situacao_estoque=0`. A lista foi indicada expressamente pelo usuário.

Qualquer OS que já movimentou estoque fica fora da quantidade e do popover, inclusive retirada pelo técnico ou pedido conferido aguardando execução com estoque já baixado. As situações executadas do CIGAM também ficam fora. Peças são associadas por produto e variação do GC; linhas avulsas sem produto cadastrado não são associadas por nome.

Reservas locais ainda sem baixa são consideradas. A consulta é repetida antes de reservar e antes de concluir o Checkout; consulta incompleta bloqueia a ação.

Validação real: 3.057 OS em 31 páginas; cinco OS nas situações autorizadas e ainda sem baixa, com 43 linhas de produtos. Nenhuma das 16 OS apontadas nas imagens aparece no compromisso. É um retrato da consulta, não um número fixo.

## Automação

O workflow `.github/workflows/partial-execution.yml` executa o mesmo núcleo de consolidação utilizado pela aplicação. O segredo exclusivo fica no GitHub Actions; o banco guarda seu hash e só expõe ações delimitadas, autenticadas por esse segredo. As regras de identidade, quantidade e exclusão mútua também são verificadas no banco.

A agenda solicita execução a cada cinco minutos. O GitHub pode atrasar execuções agendadas; não há promessa de execução instantânea. Referências: [agenda de workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [segredos do Actions](https://docs.github.com/en/actions/concepts/security/secrets).

A Edge Function alternativa não foi implantada pela publicação do Lovable. Seu job permanece desativado. A automação operacional usa GitHub Actions e não depende dessa implantação nem de mensagem ao agente Lovable.

## Preservação e limites

Os checkpoints retêm orçamento e auxiliares completos. O GC recalculou custos cadastrais de três linhas ao trocar a situação do 4784, embora o payload contivesse os custos anteriores. O evento `budget_status_reopened` preserva os documentos completos antes/depois. Quantidades, serviços, preços de venda e total de R$ 4.620,19 permaneceram iguais.

A reserva global protege os fluxos deste aplicativo. Uma operação feita diretamente em outro sistema, entre consultas ao GC, não participa das travas do Pick & Pack. Alterações detectadas nas quantidades ou respostas incompletas impedem a finalização.

Validação: testes de aplicação, typecheck do projeto, build, checagem Deno e testes das funções SQL com PostgreSQL embarcado. A execução real do workflow confirmou que 4784, 5561 e 5332 continuam aguardando execução; não foi forçada uma execução técnica para testar a geração em produção.

