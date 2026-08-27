# Sincronizar impressão de etiquetas (commit b5444fb)

Baixar 4 arquivos do commit `b5444fb` (branch `feat/etiquetas-pedido-compra`) via raw.githubusercontent.com e gravá-los byte a byte, sem qualquer reescrita ou reformatação.

## Arquivos

| Arquivo | Estado | Tamanho no remoto |
| --- | --- | --- |
| `src/lib/etiquetaPdf.ts` | novo | 5.528 B |
| `src/lib/etiquetaPdf.test.ts` | novo | 1.916 B |
| `src/components/compras/EtiquetaPrintDialog.tsx` | novo | 6.195 B |
| `src/pages/PurchaseTrackerPage.tsx` | substituído | 30.489 B |

Todos os 4 URLs respondem 200. `jspdf` já está no `package.json` (`^4.2.1`) — nenhuma dependência nova.

## Passos

1. `curl` de cada blob direto para o caminho de destino (download binário, sem edição manual do conteúdo).
2. Conferir tamanho de cada arquivo gravado contra o remoto.
3. Rodar `bunx vitest run` e reportar os totais exatos (esperado: 53 passed / 0 failed).
4. Verificar o log de build e commitar tudo em um único commit.

## Fora de escopo

Nenhum outro arquivo é tocado, nenhuma edge function é publicada, nenhuma alteração de banco.
