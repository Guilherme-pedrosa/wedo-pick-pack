---
name: GC API User Attribution
description: Todas as chamadas automáticas ao GC (POST OS/Venda, PUT status OS/Venda, PUT status Orçamento) forçam usuario_id=1320473 (usuário API guilherme.pedrosa@outlook.com), não o gc_usuario_id do humano logado
type: feature
---
Padrão espelhado do projeto WeDo Command Center: operações automáticas atribuem ao usuário API do GC para não poluir auditoria com o nome do humano logado.

Locais que sempre injetam `usuario_id: '1320473'`:
- `supabase/functions/generate-os/index.ts` — POST /api/ordens_servicos, POST /api/vendas, PUT /api/orcamentos/{id}
- `src/api/gestaoclick.ts` — `updateOSStatus` e `updateVendaStatus` (payload completo e minimalPayload)

O parâmetro `gcUsuarioId`/`gc_usuario_id` ainda é aceito mas ignorado; substituído pelo ID fixo.
