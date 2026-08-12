# Associação inteligente de cliente GC ↔ Auvo em "Gerar OS + Tarefa Auvo"

Objetivo: eliminar a digitação manual do código Auvo, aprendendo a associação a partir do código do cliente do GestãoClick e usando o CNPJ apenas para descoberta inicial.

## 1. Histórico de associações (banco)

Nova tabela `auvo_customer_links`:

- `gc_cliente_id` (chave principal da associação), `gc_cliente_codigo`, `gc_cliente_nome`, `gc_cnpj` (normalizado, só dígitos)
- `auvo_customer_id`, `auvo_customer_name`
- `usage_count`, `last_used_at`, `created_at`
- Único por (`gc_cliente_id`, `auvo_customer_id`) — múltiplas associações para o mesmo cliente GC convivem; nada é apagado ao surgir uma nova.
- RLS: leitura/escrita para usuários autenticados; grants para `authenticated` e `service_role`.

Gravação apenas após sucesso da geração (OS no GC + tarefa no Auvo): insere ou incrementa `usage_count` e atualiza `last_used_at`.

## 2. Busca de clientes Auvo por CNPJ

Nova ação na Edge Function `auvo-lookup-customer` (mantendo a ação atual de validação por código):

- `action: "search-by-cnpj"` → varre `/customers` no Auvo, compara CNPJ normalizado (sem pontos, barras, hífens, espaços) e retorna `[{ id, name, cnpj }]`.
- A validação por código continua igual e permanece obrigatória antes de gerar.

## 3. Dados do cliente GC no diálogo

Ao abrir "Gerar OS + Tarefa Auvo", buscar o cadastro do cliente no GC (`/api/clientes/{cliente_id}` via proxy) para obter código e CNPJ, e exibir:

```text
Cliente Gestão Click: WD COMERCIO E IMPORTACAO LTDA — Código GC: 1254
CNPJ: 12.345.678/0001-90
```

## 4. Campo "Cliente Auvo" inteligente

Substitui o input numérico por um componente com resolução automática, na ordem:

1. **Histórico** para o `gc_cliente_id`:
   - 1 associação → preenche automaticamente e valida na API Auvo.
   - 2+ associações → dropdown ordenado por uso mais recente, depois por mais usada.
   - Associação que não existir mais no Auvo é marcada como inválida e o fluxo segue para a próxima etapa.
2. **CNPJ** (quando não há histórico válido): busca no Auvo.
   - 1 resultado → preenche automaticamente.
   - 2+ resultados → dropdown.
3. **Manual**: mensagem "Nenhuma associação encontrada…" com o CNPJ pesquisado e o campo de código + botão Verificar (comportamento atual).

Em todos os casos a exibição é `Nome do cliente — #Código`, e o botão Confirmar só habilita após validação positiva na API do Auvo.

## 5. Geração e gravação

- O payload enviado a `generate-os` continua o mesmo (`auvo_customer_id`); a função passa a retornar o `auvo_customer_id` efetivamente usado.
- Após resposta de sucesso, o front grava/atualiza a associação no histórico.
- Nenhuma mudança na lógica de criação de OS/tarefa — sem regressão no fluxo existente.

## Detalhes técnicos

- `src/pages/RastreadorPage.tsx`: extrai o bloco do cliente Auvo para um novo componente `src/components/rastreador/AuvoCustomerPicker.tsx` (resolução automática, dropdown, validação) para não inflar a página.
- `src/api/auvoCustomerLinks.ts`: consultas ao histórico e `recordLink()` pós-sucesso.
- Normalização de CNPJ compartilhada entre front e Edge Function.
- Quando o orçamento já tem tarefa OS de origem válida (clonagem de cliente), o comportamento atual é mantido; o picker fica como fallback já pré-resolvido.
