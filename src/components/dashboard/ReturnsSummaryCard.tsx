import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Undo2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReturnsCounts {
  day: number;
  week: number;
  month: number;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

async function fetchReturnsSummary(): Promise<ReturnsCounts> {
  const now = new Date();
  const dayStart = startOfDay(now);
  const weekStart = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const fromISO = monthStart < weekStart ? monthStart.toISOString() : weekStart.toISOString();

  const dates: Date[] = [];

  const { data: agendaLogs } = await (supabase.from('system_logs') as any)
    .select('created_at')
    .eq('module', 'separations')
    .eq('action', 'devolucao_agenda')
    .gte('created_at', fromISO)
    .limit(2000);

  for (const row of (agendaLogs || []) as Array<{ created_at: string }>) {
    dates.push(new Date(row.created_at));
  }

  const { data: pecaLogs } = await supabase
    .from('separations')
    .select('invalidated_at')
    .eq('invalidated', true)
    .ilike('invalidated_reason', 'DEVOLUÇÃO:%')
    .gte('invalidated_at', fromISO)
    .limit(2000);

  for (const row of (pecaLogs || []) as Array<{ invalidated_at: string | null }>) {
    if (row.invalidated_at) dates.push(new Date(row.invalidated_at));
  }

  return {
    day: dates.filter((d) => d >= dayStart).length,
    week: dates.filter((d) => d >= weekStart).length,
    month: dates.filter((d) => d >= monthStart).length,
  };
}

export function ReturnsSummaryCard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'returns-summary'],
    queryFn: fetchReturnsSummary,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const counts = data ?? { day: 0, week: 0, month: 0 };
  const alerting = counts.day > 0 || counts.week > 0;

  const blocks: Array<{ label: string; value: number }> = [
    { label: 'Hoje', value: counts.day },
    { label: 'Últimos 7 dias', value: counts.week },
    { label: 'No mês', value: counts.month },
  ];

  return (
    <section
      className={cn(
        'rounded-2xl border-2 p-5',
        'border-destructive/60 bg-destructive/5',
        alerting && 'animate-blink-red',
      )}
    >
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
            <Undo2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-destructive">Devoluções acumuladas</h2>
            <p className="text-sm text-muted-foreground">
              Peças incorretas e retornos por agenda registrados no Log de Devoluções.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 bg-background/80"
          onClick={() => navigate('/devolucoes')}
        >
          Abrir log<ArrowRight className="ml-2 h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {blocks.map((b) => (
          <div key={b.label} className="rounded-xl border border-destructive/30 bg-background/70 p-4 text-center">
            <p className="text-3xl font-extrabold tabular-nums text-destructive">
              {isLoading ? '—' : b.value}
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{b.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default ReturnsSummaryCard;
