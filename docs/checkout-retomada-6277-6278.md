# Retomada dos orçamentos 6277 e 6278 — 11/09/2026

As OS 10228 e 10229 estavam em PEDIDO EM CONFERENCIA e `situacao_estoque=0`. A tentativa anterior de Checkout foi rejeitada por falta de HORAS TÉCNICAS (#73897). A auditoria informava apenas que os documentos existiam na situação esperada, deixando o lote em reconciliação sem indicar como retomar. Não havia uma baixa comprovada para pintar os itens de verde.

O orçamento original de cada operação foi relido integralmente e comparado à referência e às quantidades locais. Ambos contêm 8 unidades de HORA TECNICA A. O campo da OS estava ausente. Foi preenchido com 8 nas duas OS existentes, preservando todos os outros campos, produtos, quantidades, situação, financeiro e estoque. Os orçamentos foram relidos depois da correção e permaneceram íntegros. Nenhuma OS, venda ou tarefa Auvo foi criada, e nenhuma baixa foi aplicada nessa correção.

O cliente agora aproveita as horas explicitamente informadas no orçamento ou nas linhas de serviço medidas em horas. No Checkout, só preenche o campo ausente, preservando valores manuais como 26. A criação de novas OS parciais também usa essa mesma leitura. Não adiciona linhas de serviço ao lote. A confirmação local só é concluída se o GC confirmar `situacao_estoque=1`.

A auditoria retorna “baixa ainda não aplicada”, em vez de sucesso genérico, e o histórico expõe a falha anterior. O botão “Retomar no Checkout” abre somente o lote correspondente. Outra conferência em andamento é preservada até confirmar a troca; cancelar mantém as quantidades conferidas. O comportamento foi testado em desktop e mobile.

Validação: 191 testes passaram, incluindo retomada da mesma OS com uma única atualização, preservação de campos/quantidades e auditoria sem novo movimento. Typecheck e build também foram executados. Evidências antes/depois: `outputs/pick-pack-evidence/6277-hours-repair.json` e `6278-hours-repair.json`, fora do repositório.

Os lotes permanecem pendentes até a conclusão da conferência no Checkout. Reservas locais ou preenchimento de um campo obrigatório não equivalem à baixa de estoque.

## Ajuste da retomada às 19:34

Nova leitura da 6277 confirmou a OS 10228 em PEDIDO EM CONFERENCIA, `situacao_estoque=0`, com HORAS TÉCNICAS já preenchido com 8. O botão superior ainda dizia “Retomar consolidação” e, ao detectar a baixa pendente, apenas mostrava um aviso. Esse caminho foi corrigido: quando existe lote pendente, o botão diz “Retomar confirmação no Checkout”; após conferir o GC, abre o lote correspondente no Checkout. A falha anterior é identificada como histórica. A retomada usa o mesmo lote e preserva outra conferência em andamento por meio da confirmação de troca já existente. Nenhuma baixa, quantidade ou documento foi alterado neste ajuste.

Validação do ajuste: 27 testes de auditoria/retomada/carregamento passaram; checagem de tipos e build aprovados.

## Recuperação efetiva da 6277 às 19:49

O ajuste anterior só abriu o Checkout e deixou a causa operacional pendente. A tentativa original de Filipe Carvalho ficou registrada no evento 169, às 17:09:40, com rejeição do GC por ausência de HORAS TÉCNICAS. A versão 6ba371a tinha apenas um chamador de `confirmPartialBatch`, no modal que bloqueava confirmação parcial forçada/incompleta e exigia o termo aceito. Essa evidência fundamentou o reprocessamento técnico da tentativa anterior; não foi registrada uma nova conferência física nem inventado um histórico de leitura de códigos.

Antes da recuperação, o orçamento atual foi comparado integralmente à referência inicial, incluindo suas 16 unidades de produtos, 8 horas de serviço e valor total de R$ 12.378,19. A OS 10228 tinha exatamente os sete produtos e dez unidades do lote, estoque não aplicado e financeiro não aplicado. A consulta completa de 3.063 OS não encontrou compromissos concorrentes para esses produtos; a única reserva local era deste lote. Os sete saldos foram relidos imediatamente antes da atualização.

A recuperação assumiu o lote com bloqueio transacional e validou versão, estado, ausência de definitiva, evento original e quantidades. Foi executado um único PUT na OS existente para a situação de baixa configurada (7347355). O retorno foi relido: estoque aplicado, financeiro não aplicado, todos os campos comerciais preservados. As diferenças de saldo foram exatamente -2 O-rings, -1 filtro de ar, -1 junta da porta, -1 motor shaft, -3 filtros de água, -1 junta frame e -1 lâmpada. O orçamento original foi relido novamente e permaneceu íntegro.

A função idempotente de conclusão sincronizou o lote para `confirmed`, dez unidades baixadas, zero reservas locais e seis unidades ainda pendentes. A operação passou a `awaiting_balance`, sem erro de reconciliação. Os eventos de recuperação mantêm a referência ao operador/tentativa original e identificam a ação técnica separadamente. Nenhuma nova OS, venda, tarefa Auvo ou separação física fictícia foi criada.

Validação visual em produção: alerta de reconciliação removido; lâmpada, filtro de água, O-ring e junta da porta totalmente verdes; quantidades já baixadas verdes nas linhas parcialmente atendidas, cujo saldo pendente continua vermelho. Evidências completas e script de recuperação estão em `outputs/pick-pack-evidence/6277-recovery-*` e `outputs/recover-6277.mjs`, fora do repositório. Esta etapa corrigiu dados de produção; não alterou o código de execução publicado.
