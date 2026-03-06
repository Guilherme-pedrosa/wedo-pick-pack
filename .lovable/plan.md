

## Plano: Aviso de Orçamentos Convertidos no Módulo Compras

### Resumo
Detectar orçamentos que já foram convertidos em Venda/OS no GestãoClick (flags `situacao_financeiro` e `situacao_estoque` ambos `"1"`) e exibir alerta prominente + badges na tabela.

### Alterações

**1. `src/api/types.ts`**
- Adicionar `situacao_financeiro?: string` e `situacao_estoque?: string` em `GCOrcamento`
- Criar interface `OrcamentoConvertidoWarning` com campos: `orcamento_id`, `codigo`, `nome_cliente`, `situacao_financeiro`, `situacao_estoque`
- Adicionar `orcamentosConvertidos: OrcamentoConvertidoWarning[]` em `ComprasResult`

**2. `src/api/compras.ts`**
- Após Phase 1 (fetch orçamentos, linha ~186), adicionar Phase 1b: iterar `allOrcamentos`, filtrar os que têm ambos flags `=== "1"`, montar array `orcamentosConvertidos`
- Incluir `orcamentosConvertidos` no objeto retornado (linha ~403)

**3. `src/components/compras/ComprasResultPanel.tsx`**
- Adicionar `useState` para `dismissed` (controle do alerta)
- Antes dos summary cards, renderizar bloco condicional: se `result.orcamentosConvertidos?.length > 0 && !dismissed`
  - Alert amber/orange com `AlertTriangle` icon
  - Titulo bold: "Atenção — {N} orçamento(s) já convertido(s)"
  - Subtitulo explicativo
  - Lista de badges com `{codigo} — {nome_cliente}`
  - Botão "Ignorar e continuar" (outline, fecha o alerta via `setDismissed(true)`)
  - Botão "Revisar orçamentos" (amber bg, scroll para a tabela)

**4. `src/components/compras/ComprasTable.tsx`**
- Receber nova prop `convertedOrcamentoIds?: Set<string>`
- Na coluna Orçamentos, para cada badge de orçamento cujo `id` está no Set, adicionar badge "Convertido" com tooltip explicativo

**5. Backward compatibility**
- Usar `result.orcamentosConvertidos ?? []` nos componentes para não quebrar resultados persistidos no zustand

### Arquivos que NÃO serão modificados
- Nenhum arquivo de triagem, rastreador, mock data structure (apenas `orcamentosConvertidos: []` se necessário no mock return)

