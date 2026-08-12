# Associação inteligente Cliente Gestão Click ↔ Auvo

Objetivo: eliminar a digitação manual do código do cliente Auvo na janela "Gerar OS + Tarefa Auvo", usando histórico de associações e busca por CNPJ, mantendo sempre a validação na API do Auvo antes de gerar.

## Situação atual (verificada)

- A janela em `src/pages/RastreadorPage.tsx` exige digitar o código Auvo e valida via a função `auvo-lookup-customer` (busca por `customer_id`).
- Não existe nenhuma tabela de clientes no banco: a consulta ao schema não retornou tabela de cliente nem coluna com CNPJ. Hoje o app só guarda `client_id` + `client_name` em tabelas operacionais.
- CNPJ e código do cadastro do cliente precisam vir do Gestão Click em tempo real, via o proxy existente.

## O que será feito

### 1. Histórico de associações (nova tabela)

Tabela `auvo_customer_links` com: id do cliente no GC, nome GC, código GC, CNPJ normalizado, id do cliente Auvo, nome Auvo, data da última utilização e contador de usos. Chave única por (cliente GC + cliente Auvo), para que várias associações do mesmo cliente GC convivam — nada é sobrescrito.

### 2. Dados do cliente na janela

Ao abrir a janela, buscar no Gestão Click o cadastro do cliente do orçamento e exibir:
`Cliente Gestão Click: [Nome] — Código GC: [código]`, além do CNPJ formatado.

### 3. Novo componente de seleção do cliente Auvo

Substituir o campo "digite o código" por um seletor inteligente que resolve nesta ordem:

```text
1. Histórico do cliente GC
   1 associação   -> preenche automaticamente
   2+ associações -> lista suspensa (mais recente primeiro, depois mais usada)
   0 associações  -> passo 2
2. Busca no Auvo pelo CNPJ (normalizado: sem pontos, barras, hífens, espaços)
   1 resultado    -> preenche automaticamente
   2+ resultados  -> lista suspensa
   0 resultados   -> passo 3
3. Fallback manual: campo de código/pesquisa, com aviso
   "Nenhuma associação encontrada para o CNPJ XX.XXX.XXX/XXXX-XX."
```

Todas as opções mostram **Nome + Código**, nunca só o código. Em qualquer caminho, o cliente escolhido é validado na API do Auvo antes de liberar a confirmação.

### 4. Busca por CNPJ no Auvo

Adicionar a ação `search-by-cnpj` na função `auvo-lookup-customer`, que lista clientes do Auvo e compara o CNPJ normalizado, retornando todos os cadastros correspondentes.

### 5. Gravação do histórico

Somente após a OS no GC **e** a tarefa no Auvo serem criadas com sucesso, gravar/atualizar a associação (incrementando o contador de usos e a data). Falha em qualquer etapa não grava nada.

## Detalhes técnicos

- Banco: migração criando `public.auvo_customer_links` com GRANTs para `authenticated`/`service_role`, RLS habilitado e políticas de leitura/escrita para usuários autenticados (padrão operacional já usado no projeto).
- Dados do cliente GC: `GET /api/clientes/{id}` através da função `gc-proxy`, com helper novo em `src/api/gestaoclick.ts` e cache via React Query.
- Novo componente `src/components/rastreador/AuvoCustomerPicker.tsx` encapsulando resolução, dropdown, fallback manual e validação.
- `supabase/functions/auvo-lookup-customer/index.ts`: nova ação `search-by-cnpj` com paginação e normalização de CNPJ.
- `src/pages/RastreadorPage.tsx`: exibe código GC/CNPJ, usa o novo picker e grava a associação após retorno de sucesso da geração.
- `supabase/functions/generate-os/index.ts`: garantir que o retorno inclua o id do cliente Auvo usado, para registro do histórico.
- Fluxo atual de geração de OS/tarefa permanece inalterado quando já existe tarefa de origem vinculada.
