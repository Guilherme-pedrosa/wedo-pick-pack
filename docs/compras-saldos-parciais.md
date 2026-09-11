# Compras: saldo parcial permanece como necessidade

## Falha corrigida

A lista manual e a rotina automática filtravam o catálogo pelos status de orçamento antes de aplicar os saldos parciais. Depois da primeira baixa, a situação do documento-mãe mudava para “Baixa parcial realizada” e suas peças desapareciam da demanda. Vendas também não entravam no catálogo de orçamentos. A leitura antiga limitava operações e transformava falhas em lista vazia.

## Regra

- Todas as baixas abertas entram pela tabela oficial de saldos, inclusive vendas e operações em reconciliação. Os filtros de situação só controlam os demais orçamentos.
- Demanda pendente = quantidade original − retirada confirmada − reserva local. A reserva local é considerada separadamente no comprometimento do estoque, sem ser contada duas vezes.
- A mesma baixa não entra novamente pelo orçamento nem pela OS auxiliar. A lista não modifica os documentos, suas quantidades, o histórico de retiradas ou as tarefas Auvo.
- Estoque e pedidos são agregados uma vez por produto/variação. Produtos sem variações usam o estoque do produto, mesmo que o GC informe um identificador de variação padrão na linha.
- Compromisso de OS segue as seis situações autorizadas e exige ausência de saída de estoque. Retirada pelo técnico e qualquer OS já baixada não comprometem novamente.
- Só a quantidade ainda aberta de pedidos selecionados cobre a necessidade. Pedidos cancelados, finalizados ou já recebidos não cobrem novamente. Pedido de outra variação não cobre o item.
- Saldo sem cobertura permanece em “A comprar”; cobertura parcial mantém a diferença. A origem aparece como “Saldo parcial”, com o número do orçamento ou venda.
- Erro de leitura ou mudança da baixa durante o cálculo impede a substituição do resultado anterior por uma lista incompleta. Listas antigas salvas no navegador são identificadas como anteriores à correção.

## Execução

`supabase/functions/_shared/purchaseScan.ts` é o motor usado pelo navegador, pela rotina GitHub e pelo código da Edge Function. O carregador de baixas percorre todas as páginas de operações, itens e lotes.

A rotina `purchase-scan.yml` substitui o agendamento antigo de compras, mantendo a periodicidade de três horas e execução manual. Usa Node 24 e a credencial de rotina já configurada. A RPC `compras_worker_api` permite somente ler saldos e inserir snapshots; confere novamente a revisão dos saldos antes de gravar. O job antigo só deve ser desativado após a nova execução ser verificada.

Publicar o frontend não comprova implantação de Edge Functions. Por isso, o caminho de produção automático verificável é o workflow GitHub; não depende de mensagem ao agente Lovable.

## Validação

Testes cobrem status fora do filtro, venda, reconciliação, conversão/OS auxiliar, duplicação, retirada, reserva, pedido parcial/cancelado/recebido, variações, saldo zerado, paginação incompleta e alterações durante o cálculo. A verificação real deve comparar as pendências das baixas abertas com as três categorias: comprar, coberto por pedido e com estoque.


Conferência real em 11/09/2026: cinco baixas com saldo, sete linhas pendentes. Seis linhas sem estoque/pedido voltam a “A comprar”: orçamento 6345 (5 lixas massa GR120, 2 lixas ferro G220, 8 sapatas silicone), orçamento 5334 (1 suporte articulado), venda 2604 (1 disco ralar) e venda 800003501 (1 controlador MT-526C). Orçamento 6438 permanece com 3 cortinas disponíveis em estoque, sem compra adicional. Resultado total: 24 produtos para comprar, 31 cobertos por pedido e 25 documentos na demanda. 123 testes, typecheck e build aprovados.

Se o número de documentos mudar durante a paginação, o motor repete somente esse catálogo até três vezes. As páginas são lidas em grupos de três e só entram no resultado após validação de contagem, identidade e ausência de duplicação. A primeira execução automática detectou uma alteração no catálogo de OS e preservou o snapshot anterior; o teste de regressão reproduz esse caso.


Produção: publicação do motor `d448e2a` conferida no bundle `index-Dnyp0kg3.js`. Workflow [34634722689](https://github.com/Guilherme-pedrosa/wedo-pick-pack/actions/runs/34634722689) concluído com sucesso em 11/09/2026 às 15:45 (Brasília), duração da varredura 196.370 ms. Snapshot `b0ed34c9-76b3-49ce-9f0b-0223e27447b6`: 24 produtos a comprar, 31 cobertos por pedido, 26 documentos e 6 baixas com saldo; a consulta já incluiu o orçamento 6276, aberto após a conferência inicial. Os seis produtos antes omitidos foram confirmados no JSON persistido. O cron antigo `compras-auto-scan-3h` foi desativado somente depois dessa verificação. O workflow novo mantém o agendamento de três horas (sujeito à fila do GitHub).
