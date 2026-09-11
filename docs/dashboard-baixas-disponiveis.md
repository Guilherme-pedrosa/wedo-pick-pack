# Varredura de peças para baixa parcial no dashboard

O dashboard consulta todas as operações de baixa parcial abertas e identifica peças pendentes que podem ser baixadas. A consulta acontece ao abrir a página, a cada cinco minutos enquanto ela permanece aberta e pelo botão “Atualizar varredura”, também incluído em “Atualizar tudo”. Não cria reserva, movimentação no GC ou tarefa Auvo.

A seção “Peças disponíveis para baixa parcial” mostra documento, cliente, produto, código, pendência, estoque GC, comprometimento e quantidade sugerida. “Abrir baixa” navega diretamente para a operação correspondente pelo parâmetro `operation`.

Regras da varredura:

- Relê os orçamentos/vendas e confere os dados integrais com a referência preservada. Divergências aparecem como pendências de conferência e não como baixas liberadas.
- Desconta quantidades já baixadas e reservadas da pendência de cada item.
- Reutiliza a regra global de comprometimento: apenas as seis situações autorizadas, com estoque ainda sem baixa. Retirada pelo técnico e demais OS já movimentadas não entram.
- Consulta o estoque atual do produto e da variação exata; não associa produtos por nome e não substitui estoque ausente por disponibilidade.
- Distribui peças compartilhadas entre as operações mais antigas, sem sugerir a mesma unidade duas vezes. Esta distribuição é informativa; o fluxo de baixa continua verificando e reservando atomicamente quando o usuário efetivamente prossegue.
- Pagina as operações e itens sem o limite de 200 operações da listagem histórica. Confere novamente os saldos locais ao terminar; alterações durante a varredura invalidam o resultado.
- Falha na consulta global oculta as sugestões anteriores. Falhas de um orçamento/produto aparecem na lista de pendências, sem liberar aquele item.

Validação em 11/09/2026: oito operações abertas, cinco com pendências. A varredura real encontrou três cortinas de 100 cm disponíveis no orçamento 6438, com estoque três e comprometimento zero. Os orçamentos 6345 e 5334 apresentaram divergência em relação às referências e foram sinalizados para conferência. Esses valores são o retrato da consulta, não valores fixos do dashboard.

Validação técnica: 110 testes de aplicação, typecheck e build. Os testes da nova varredura cobrem estoque compartilhado, reservas, situações autorizadas, variações, orçamento alterado, indisponibilidade do GC, saldos modificados durante a consulta e itens já integralmente retirados/reservados.
