# Baixas confirmadas e retomada do Checkout — 11/09/2026

No orçamento 6276, a OS 10224 já estava com `situacao_estoque=1` no GC, mas o lote local permanecia em `reconciliation_required` após um erro anterior de HORAS TÉCNICAS. As sete linhas continuavam reservadas e apareciam vermelhas. A auditoria anterior reconhecia apenas duas situações específicas e apenas lotes aguardando Checkout; também não atualizava a tabela imediatamente após confirmar.

A auditoria e o botão Atualizar estoque agora usam a baixa efetiva do GC. Antes de confirmar localmente, releem o orçamento original e conferem a referência integral. A confirmação atômica valida documento, marcador, cliente, produtos, variações, quantidades e reservas. Registra a prova do GC e os dados anteriores, preserva orçamento e tarefas Auvo e não envia nova baixa ao GC. Repetir a confirmação não duplica quantidades. Falhas de reconciliação são apresentadas como erro.

Itens completamente baixados ficam verdes mesmo se houver um alerta de estoque global. Em itens parcialmente baixados, a quantidade já baixada fica verde e a quantidade ainda pendente fica vermelha. Reservar localmente, sem confirmação do GC, não torna uma quantidade baixada.

Na OS 10226, a baixa ainda não havia ocorrido. O campo obrigatório HORAS TÉCNICAS já estava preenchido com 26 no documento atual, mas o erro antigo impedia uma nova tentativa. O Checkout agora retoma o mesmo lote em reconciliação após reler o orçamento, conferir o documento e executar as proteções de estoque. Os campos atuais da OS são preservados. A fila mantém esses lotes disponíveis para retomada. Não há criação de outra OS ou tarefa nessa ação.

Validação: testes do handler com HTTP simulado, PostgreSQL embarcado para confirmação/repetição/guardas/preservação e typecheck/build. Os testes incluem estoque já aplicado sem PUT, retomada com uma única alteração de situação e preservação do campo HORAS TÉCNICAS, além da vedação pendente continuar com saldo de compra.
