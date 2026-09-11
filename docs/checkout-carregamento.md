# Carregamento do Checkout — 11/09/2026

Ao clicar numa OS, `OrderQueue` aguardava o enriquecimento dos produtos e depois `assertCheckoutStock`, que consultava novamente a OS e percorria todas as páginas de ordens de serviço. Durante essa espera, a fila ficava bloqueada e o painel continuava mostrando “Nenhuma separação ativa”.

A abertura agora consulta somente o documento selecionado e seu vínculo de baixa parcial, em paralelo. Os itens e as quantidades originais aparecem imediatamente após essa resposta. Códigos, localização e saldo físico são obtidos em segundo plano, uma consulta por produto da OS/venda selecionada, inclusive quando há linhas repetidas. Não há listagem global de OS disparada pelo clique. O andamento fica visível e documentos com estoque já aplicado não geram um falso alerta de falta sobre peças que já saíram.

O retorno dos dados de produto atualiza somente códigos/localização. Preserva a conferência em andamento, as quantidades, o documento original e o vínculo parcial. Respostas atrasadas de outro pedido são descartadas. A troca de OS preserva a sessão anterior se o novo documento falhar; o vínculo do lote em reconciliação também é mantido ao confirmar a troca. Erro na consulta desse vínculo não é interpretado como pedido comum.

As verificações completas de estoque continuam antes da baixa: `ConclusionModal` para OS comuns e `confirmPartialBatch` para lotes parciais. Nenhuma dessas proteções foi retirada da conclusão.

Validação: testes com fila, painel e tabela reais para desktop/mobile; apresentação dos itens antes dos metadados; atualização sem perder conferências; troca de pedidos; venda; erro de carregamento; conclusão parcial pelo lote correto; bloqueio de conclusão quando há conflito; consulta restrita aos produtos selecionados. Suíte completa: 182 testes. Typecheck do projeto app e build executados. Nenhuma baixa é necessária para testar a abertura na interface.
