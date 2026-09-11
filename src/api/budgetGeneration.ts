import { supabase } from '@/integrations/supabase/client';
import { BUDGET_GENERATION_VERSION, readAuthoritativeBudget } from '../../supabase/functions/_shared/budgetKind';
export { documentLabelForBudget } from '../../supabase/functions/_shared/budgetKind';

export async function readBudgetGenerationSource(budgetId: string) {
  return readAuthoritativeBudget(async path => {
    const { data, error } = await supabase.functions.invoke('gc-proxy', { body: { path, method: 'GET' } });
    if (error || !data?._proxy?.ok) throw new Error('Não foi possível conferir o orçamento original no GC.');
    return data;
  }, budgetId);
}

/** Prevent a published frontend from using an older server that guesses from service lines. */
export async function assertBudgetGenerationReady(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('generate-os', { body: { action: 'generation_rules' } });
  if (error || data?.version !== BUDGET_GENERATION_VERSION) {
    throw new Error('A geração está temporariamente indisponível enquanto a correção do tipo de orçamento é ativada. Nenhum documento ou tarefa foi criado.');
  }
}
