import { supabase } from '@/integrations/supabase/client';
import { getOS, getVenda } from '@/api/gestaoclick';
import type { SeparationRecord } from '@/api/separations';

export type TimelineSource = 'separation' | 'system' | 'os_gen' | 'gc';

export interface TimelineEvent {
  at: string | null;
  source: TimelineSource;
  kind: string;
  title: string;
  description?: string;
  actor?: string | null;
  details?: Record<string, unknown> | null;
}

export interface SeparationHistory {
  events: TimelineEvent[];
  gcObservacoes?: string | null;
  gcObservacoesInterna?: string | null;
  gcStatusAtual?: string | null;
  gcError?: string | null;
}

function humanizeSystemAction(action: string): { title: string; kind: string } {
  const map: Record<string, { title: string; kind: string }> = {
    'Separação concluída': { title: 'Separação concluída', kind: 'concluded' },
    vincular_tecnico: { title: 'Técnico vinculado', kind: 'tech-link' },
    desvincular_tecnico: { title: 'Técnico desvinculado', kind: 'tech-unlink' },
    devolucao_agenda: { title: 'Devolução por agenda', kind: 'return' },
  };
  return map[action] || { title: action, kind: 'system' };
}

function buildSystemDescription(action: string, d: Record<string, unknown> | null): string | undefined {
  if (!d) return undefined;
  if (action === 'vincular_tecnico') {
    const prev = d.previous_technician_name ? ` (anterior: ${d.previous_technician_name})` : '';
    return `Técnico: ${d.technician_name ?? '—'}${d.technician_gc_id ? ` — ID ${d.technician_gc_id}` : ''}${prev}. Novo status: ${d.new_status ?? '—'}.`;
  }
  if (action === 'desvincular_tecnico') {
    return `Técnico removido${d.previous_technician_name ? `: ${d.previous_technician_name}` : ''}. Status revertido para ${d.new_status ?? '—'}.`;
  }
  if (action === 'devolucao_agenda') {
    return `Motivo: ${d.motivo ?? '—'}`;
  }
  if (action === 'Separação concluída') {
    const dur = d.duration ? ` em ${d.duration}` : '';
    return `${d.items_confirmed ?? '?'}/${d.items_total ?? '?'} itens conferidos${dur}. Status alvo: ${d.target_status ?? '—'}.`;
  }
  return undefined;
}

export async function getSeparationHistory(sep: SeparationRecord): Promise<SeparationHistory> {
  const events: TimelineEvent[] = [];

  // 1) Local separation record lifecycle events
  if (sep.started_at) {
    events.push({
      at: sep.started_at,
      source: 'separation',
      kind: 'started',
      title: 'Separação iniciada',
      actor: sep.operator_name,
      description: `${sep.items_total} item(ns) — cliente ${sep.client_name}`,
    });
  }
  if (sep.concluded_at) {
    events.push({
      at: sep.concluded_at,
      source: 'separation',
      kind: 'concluded',
      title: 'Separação registrada',
      actor: sep.operator_name,
      description: `${sep.items_confirmed}/${sep.items_total} itens • Status: ${sep.status_name} → ${sep.target_status_name}`,
    });
  }
  if (sep.invalidated && sep.invalidated_at) {
    const isReturn = (sep.invalidated_reason || '').startsWith('DEVOLUÇÃO');
    events.push({
      at: sep.invalidated_at,
      source: 'separation',
      kind: isReturn ? 'return' : 'invalidated',
      title: isReturn ? 'Devolução registrada' : 'Separação invalidada',
      description: sep.invalidated_reason || undefined,
    });
  }

  // 2) System logs for this order (everything ever logged against this OS/Venda)
  try {
    const { data: logs } = await supabase
      .from('system_logs')
      .select('action, module, entity_type, entity_id, entity_name, details, user_name, created_at')
      .eq('entity_id', sep.order_id)
      .order('created_at', { ascending: true });

    for (const log of logs || []) {
      // Skip the conclusion log if we already have the local record event (avoid duplication)
      const { title, kind } = humanizeSystemAction(log.action);
      const details = (log.details as Record<string, unknown> | null) ?? null;
      // Match this order by separation id if available, otherwise trust entity_id
      events.push({
        at: log.created_at,
        source: 'system',
        kind,
        title,
        actor: log.user_name,
        description: buildSystemDescription(log.action, details),
        details,
      });
    }
  } catch (e) {
    console.error('Failed to load system logs for history:', e);
  }

  // 3) OS generation logs (when the OS/Venda was generated from a budget)
  try {
    const { data: gen } = await supabase
      .from('os_generation_logs')
      .select('*')
      .eq('os_id', sep.order_id)
      .order('created_at', { ascending: true });

    for (const g of gen || []) {
      events.push({
        at: g.created_at,
        source: 'os_gen',
        kind: g.success ? 'os-generated' : 'os-gen-failed',
        title: g.success ? 'OS gerada a partir de orçamento' : 'Falha ao gerar OS',
        actor: g.operator_name,
        description: [
          g.orcamento_codigo ? `Orçamento #${g.orcamento_codigo}` : null,
          g.auvo_task_id ? `Tarefa Auvo ${g.auvo_task_id}` : null,
          g.error_message || null,
        ].filter(Boolean).join(' • ') || undefined,
        details: g as unknown as Record<string, unknown>,
      });
    }
  } catch (e) {
    console.error('Failed to load os generation logs for history:', e);
  }

  // 4) Live GC snapshot (observations accumulate the full WeDo trail)
  const result: SeparationHistory = { events: [], gcError: null };
  try {
    if (sep.order_type === 'os') {
      const order = await getOS(sep.order_id);
      result.gcObservacoes = order.observacoes || null;
      result.gcObservacoesInterna = order.observacoes_interna || null;
      result.gcStatusAtual = order.nome_situacao || null;
    } else {
      const order = await getVenda(sep.order_id);
      result.gcObservacoes = (order as { observacoes?: string }).observacoes || null;
      result.gcObservacoesInterna = (order as { observacoes_interna?: string }).observacoes_interna || null;
      result.gcStatusAtual = order.nome_situacao || null;
    }
  } catch (e) {
    result.gcError = e instanceof Error ? e.message : 'Erro ao buscar dados no GestãoClick';
  }

  // Sort chronologically (nulls last)
  events.sort((a, b) => {
    if (!a.at) return 1;
    if (!b.at) return -1;
    return new Date(a.at).getTime() - new Date(b.at).getTime();
  });

  result.events = events;
  return result;
}
