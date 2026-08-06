import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Boxes,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  FileCheck2,
  Link2Off,
  PackageCheck,
  PackageMinus,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Users,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  getCloudOperationsDashboard,
  getIntegrationOperationsDashboard,
  type CloudOperationsDashboard,
  type IntegrationOperationsDashboard,
} from '@/api/operationsDashboard';
import ComprasSnapshotDialog from '@/components/dashboard/ComprasSnapshotDialog';

type AlertLevel = 'critical' | 'warning' | 'info';

interface AttentionItem {
  id: string;
  level: AlertLevel;
  title: string;
  description: string;
  href: string;
  action: string;
}

interface HighlightCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: LucideIcon;
  tone: 'blue' | 'violet' | 'amber' | 'emerald';
  onClick: () => void;
  loading?: boolean;
}

const toneStyles = {
  blue: 'border-blue-200/80 bg-gradient-to-br from-blue-50 to-card dark:border-blue-900/60 dark:from-blue-950/35',
  violet: 'border-violet-200/80 bg-gradient-to-br from-violet-50 to-card dark:border-violet-900/60 dark:from-violet-950/35',
  amber: 'border-amber-200/80 bg-gradient-to-br from-amber-50 to-card dark:border-amber-900/60 dark:from-amber-950/35',
  emerald: 'border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-card dark:border-emerald-900/60 dark:from-emerald-950/35',
} as const;

const toneIcons = {
  blue: 'bg-blue-600 text-white',
  violet: 'bg-violet-600 text-white',
  amber: 'bg-amber-500 text-white',
  emerald: 'bg-emerald-600 text-white',
} as const;

const alertStyles = {
  critical: {
    wrapper: 'border-red-200 bg-red-50/80 dark:border-red-900/70 dark:bg-red-950/25',
    icon: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
    badge: 'border-red-200 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
    label: 'Crítico',
  },
  warning: {
    wrapper: 'border-amber-200 bg-amber-50/80 dark:border-amber-900/70 dark:bg-amber-950/25',
    icon: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    badge: 'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
    label: 'Atenção',
  },
  info: {
    wrapper: 'border-blue-200 bg-blue-50/70 dark:border-blue-900/70 dark:bg-blue-950/25',
    icon: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    badge: 'border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200',
    label: 'Acompanhar',
  },
} as const;

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Sem registro';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function timeAgo(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

function activityLabel(action: string): string {
  const labels: Record<string, string> = {
    gc_status_change: 'Situação atualizada no GestãoClick',
    vincular_tecnico: 'Técnico vinculado à separação',
    'OS gerada': 'Ordem de serviço gerada',
    'Venda gerada': 'Venda gerada',
    'Separação concluída': 'Separação concluída',
    'Lista de compras gerada': 'Lista de compras atualizada',
    'Caixa criada': 'Nova caixa criada',
  };
  return labels[action] || action;
}

function activityRoute(module: string): string {
  if (module === 'rastreador') return '/rastreador/logs';
  if (module === 'compras') return '/compras';
  if (module === 'controle_caixas') return '/controle/caixas';
  if (module === 'controle_maletas') return '/controle/maletas';
  if (module === 'checkout' || module === 'separations') return '/separations';
  return '/dashboard';
}

function HighlightCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tone,
  onClick,
  loading = false,
}: HighlightCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group min-h-40 rounded-2xl border p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
        toneStyles[tone],
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl shadow-sm', toneIcons[tone])}>
          <Icon className="h-5 w-5" />
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      {loading ? <Skeleton className="mt-2 h-9 w-24" /> : <p className="mt-1 text-3xl font-bold tracking-tight">{value}</p>}
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </button>
  );
}

function MetricRow({
  label,
  value,
  emphasis = false,
  warning = false,
}: {
  label: string;
  value: string | number;
  emphasis?: boolean;
  warning?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-semibold tabular-nums', emphasis && 'text-primary', warning && 'text-amber-700 dark:text-amber-300')}>
        {value}
      </span>
    </div>
  );
}

function OperationCard({
  title,
  description,
  icon: Icon,
  href,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <Card className="group overflow-hidden rounded-2xl shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate(href)}>
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-2">{children}</CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-40 rounded-2xl" />)}
      </div>
      <Skeleton className="h-48 rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="h-72 rounded-2xl" />)}
      </div>
    </div>
  );
}

function buildAttentionItems(
  cloud: CloudOperationsDashboard,
  integration: IntegrationOperationsDashboard | undefined,
  integrationError: boolean,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (cloud.sync.stalledIncrementals.length > 0) {
    items.push({
      id: 'sync-stalled',
      level: 'critical',
      title: 'Sincronização incremental travada',
      description: `${cloud.sync.stalledIncrementals.length} execução(ões) continuam abertas há mais de 45 minutos.`,
      href: '/config',
      action: 'Ver sincronização',
    });
  }
  if (cloud.purchaseTracker?.status !== 'success') {
    items.push({
      id: 'purchase-tracker',
      level: 'critical',
      title: 'Acompanhamento de compras (comprado ag chegada)',
      description: cloud.purchaseTracker?.errorMessage || 'O rastreador de pedidos ainda não possui uma leitura válida.',
      href: '/compras/acompanhamento',
      action: 'Configurar situações',
    });
  } else {
    const tracker = cloud.purchaseTracker;
    if ((tracker.overdue ?? 0) > 0) {
      items.push({
        id: 'purchase-arrival-overdue',
        level: 'critical',
        title: 'Pedidos de compra com chegada atrasada',
        description: `${tracker.overdue} pedido(s) em "comprado ag chegada" passaram da previsão de chegada.`,
        href: '/compras/acompanhamento',
        action: 'Ver pedidos',
      });
    }
    if ((tracker.critical ?? 0) > 0) {
      items.push({
        id: 'purchase-stuck',
        level: 'critical',
        title: 'Pedidos de compra parados há mais de 30 dias',
        description: `${tracker.critical} pedido(s) sem mudança de situação há mais de 30 dias.`,
        href: '/compras/acompanhamento',
        action: 'Ver pedidos',
      });
    }
    if ((tracker.warning ?? 0) > 0) {
      items.push({
        id: 'purchase-warning',
        level: 'warning',
        title: 'Pedidos de compra sem movimentação',
        description: `${tracker.warning} pedido(s) sem atualização há mais de 15 dias.`,
        href: '/compras/acompanhamento',
        action: 'Ver pedidos',
      });
    }
  }

  if (cloud.partialWriteoff.reconciliationRequired > 0) {
    items.push({
      id: 'partial-reconciliation',
      level: 'critical',
      title: 'Baixa parcial exige reconciliação',
      description: `${cloud.partialWriteoff.reconciliationRequired} operação(ões) precisam de conferência antes de continuar.`,
      href: '/baixa-parcial',
      action: 'Abrir baixa parcial',
    });
  }
  if (cloud.generations.unresolvedFailures.length > 0) {
    const budgets = cloud.generations.unresolvedFailures.slice(0, 3).map((log) => `#${log.orcamento_codigo}`).join(', ');
    items.push({
      id: 'generation-failures',
      level: 'warning',
      title: 'Gerações ainda sem sucesso posterior',
      description: `${cloud.generations.unresolvedFailures.length} orçamento(s) com falha pendente: ${budgets}.`,
      href: '/rastreador/logs',
      action: 'Analisar falhas',
    });
  }
  if (integration) {
    if (integration.ordersWithoutExecutionTask > 0) {
      items.push({
        id: 'os-without-task',
        level: 'critical',
        title: 'OS sem tarefa de execução',
        description: `${integration.ordersWithoutExecutionTask} OS aberta(s) no GestãoClick não possuem a amarração da tarefa Auvo.`,
        href: '/separations?tab=agenda',
        action: 'Corrigir amarração',
      });
    }
    if (integration.tasksWithoutDate > 0 || integration.tasksWithoutTechnician > 0) {
      items.push({
        id: 'tasks-unscheduled',
        level: 'warning',
        title: 'Execuções ainda não programadas',
        description: `${integration.tasksWithoutDate} sem data e ${integration.tasksWithoutTechnician} sem técnico no Auvo.`,
        href: '/separations?tab=agenda',
        action: 'Organizar agenda',
      });
    }
    if (integration.agendaUnassigned > 0) {
      items.push({
        id: 'agenda-unassigned',
        level: 'warning',
        title: 'Agenda de hoje com tarefa sem técnico',
        description: `${integration.agendaUnassigned} tarefa(s) de hoje ainda não possuem responsável.`,
        href: '/separations?tab=agenda',
        action: 'Definir técnico',
      });
    }
  } else if (integrationError) {
    items.push({
      id: 'integration-offline',
      level: 'warning',
      title: 'Leitura ao vivo de Auvo/GC indisponível',
      description: 'Os dados internos foram carregados, mas a amarração entre OS e agenda não respondeu.',
      href: '/separations?tab=agenda',
      action: 'Abrir controle OS',
    });
  }
  if (cloud.assets.boxesPendingConference > 0) {
    items.push({
      id: 'boxes-unverified',
      level: 'info',
      title: 'Caixas aguardando conferência',
      description: `${cloud.assets.boxesPendingConference} de ${cloud.assets.activeBoxes} caixas ativas ainda não foram verificadas.`,
      href: '/controle/caixas',
      action: 'Conferir caixas',
    });
  }
  if (cloud.partialWriteoff.awaitingBalance > 0) {
    items.push({
      id: 'partial-balance',
      level: 'info',
      title: 'Saldo pendente em baixa parcial',
      description: `${cloud.partialWriteoff.awaitingBalance} operação(ões) seguem abertas aguardando as peças restantes.`,
      href: '/baixa-parcial',
      action: 'Continuar baixa',
    });
  }

  const levelOrder: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
  return items.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);
}

const DashboardPage = () => {
  const navigate = useNavigate();
  const [comprasDialogOpen, setComprasDialogOpen] = useState(false);
  const cloudQuery = useQuery({
    queryKey: ['operations-dashboard', 'cloud'],
    queryFn: () => getCloudOperationsDashboard(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const integrationQuery = useQuery({
    queryKey: ['operations-dashboard', 'auvo-gc'],
    queryFn: () => getIntegrationOperationsDashboard(),
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const attentionItems = useMemo(
    () => cloudQuery.data
      ? buildAttentionItems(cloudQuery.data, integrationQuery.data, integrationQuery.isError)
      : [],
    [cloudQuery.data, integrationQuery.data, integrationQuery.isError],
  );

  const refreshAll = async () => {
    await Promise.all([cloudQuery.refetch(), integrationQuery.refetch()]);
  };

  if (cloudQuery.isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Central de Operações</h1>
          <p className="text-sm text-muted-foreground">Consolidando GestãoClick, Auvo e Pick & Pack…</p>
        </div>
        <DashboardSkeleton />
      </div>
    );
  }

  if (!cloudQuery.data) {
    return (
      <Card className="rounded-2xl border-red-200 bg-red-50/50">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <XCircle className="h-10 w-10 text-red-600" />
          <div>
            <h1 className="text-xl font-bold">Não foi possível carregar a central</h1>
            <p className="mt-1 text-sm text-muted-foreground">{cloudQuery.error?.message || 'Tente atualizar novamente.'}</p>
          </div>
          <Button onClick={() => cloudQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Tentar novamente</Button>
        </CardContent>
      </Card>
    );
  }

  const cloud = cloudQuery.data;
  const integration = integrationQuery.data;
  const agendaProgress = integration && integration.agendaToday > 0
    ? Math.round((integration.agendaFinished / integration.agendaToday) * 100)
    : 0;
  const allRefreshing = cloudQuery.isFetching || integrationQuery.isFetching;

  return (
    <div className="space-y-7 animate-in fade-in duration-300">
      <div className="relative overflow-hidden rounded-2xl border bg-card px-5 py-5 shadow-sm sm:px-7">
        <div className="absolute inset-y-0 right-0 hidden w-80 bg-gradient-to-l from-primary/10 to-transparent lg:block" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Visão operacional</Badge>
              <span className="text-xs text-muted-foreground">Atualização automática</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Central de Operações</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              GestãoClick, Auvo, separações, compras e ativos em uma única leitura do que exige ação.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right md:block">
              <p className="text-xs font-medium text-muted-foreground">Dados internos</p>
              <p className="text-xs">{formatDateTime(cloud.refreshedAt)}</p>
            </div>
            <Button variant="outline" onClick={refreshAll} disabled={allRefreshing} className="bg-background/80">
              <RefreshCw className={cn('mr-2 h-4 w-4', allRefreshing && 'animate-spin')} />
              Atualizar tudo
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <HighlightCard
          title="Agenda Auvo hoje"
          value={integration?.agendaToday ?? '—'}
          subtitle={integration ? `${integration.agendaInProgress} em atendimento · ${integration.agendaFinished} finalizada(s)` : 'Consultando a agenda ao vivo…'}
          icon={CalendarClock}
          tone="blue"
          loading={integrationQuery.isLoading}
          onClick={() => navigate('/separations?tab=agenda')}
        />
        <HighlightCard
          title="OS abertas no GC"
          value={integration?.openOrders ?? '—'}
          subtitle={integration ? `${integration.tasksWithoutDate} tarefas sem data definida` : 'Cruzando OS com tarefas Auvo…'}
          icon={Wrench}
          tone="violet"
          loading={integrationQuery.isLoading}
          onClick={() => navigate('/separations?tab=agenda')}
        />
        <HighlightCard
          title="Separações"
          value={cloud.separations.week}
          subtitle={`${cloud.separations.today} hoje · ${cloud.separations.weekItems} itens em 7 dias`}
          icon={PackageCheck}
          tone="emerald"
          onClick={() => navigate('/separations')}
        />
        <HighlightCard
          title="Necessidade de compra"
          value={cloud.purchases?.shortageProducts ?? '—'}
          subtitle={cloud.purchases ? `${formatCurrency(cloud.purchases.estimatedValue)} em ${cloud.purchases.budgets} orçamento(s)` : 'Nenhuma varredura disponível'}
          icon={ShoppingCart}
          tone="amber"
          onClick={() => setComprasDialogOpen(true)}
        />
      </div>

      <ReturnsSummaryCard />



      <section className="space-y-3">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <h2 className="text-lg font-bold">Atenção agora</h2>
              <Badge variant="secondary">{attentionItems.length}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Exceções e pendências que podem interromper o fluxo operacional.</p>
          </div>
          {integrationQuery.isFetching && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Cruzando Auvo e GC
            </span>
          )}
        </div>

        {attentionItems.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900 dark:bg-emerald-950/25">
            <div className="rounded-full bg-emerald-100 p-2 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></div>
            <div>
              <p className="font-semibold">Nenhuma pendência crítica encontrada</p>
              <p className="text-sm text-muted-foreground">As fontes consultadas estão dentro do fluxo esperado.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {attentionItems.map((item) => {
              const style = alertStyles[item.level];
              const Icon = item.level === 'critical' ? AlertCircle : item.level === 'warning' ? AlertTriangle : Clock3;
              return (
                <div key={item.id} className={cn('flex flex-col justify-between gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center', style.wrapper)}>
                  <div className="flex min-w-0 items-start gap-3">
                    <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', style.icon)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{item.title}</p>
                        <Badge variant="outline" className={cn('text-[10px]', style.badge)}>{style.label}</Badge>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0 bg-background/80" onClick={() => navigate(item.href)}>
                    {item.action}<ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">Fluxo operacional</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Highlights de cada etapa, do orçamento até a execução em campo.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <OperationCard title="Comercial e geração" description="Conversão de orçamentos em OS e vendas." icon={FileCheck2} href="/rastreador/logs">
            <MetricRow label="Gerados hoje" value={cloud.generations.todaySuccess} emphasis />
            <MetricRow label="Gerados nos últimos 7 dias" value={cloud.generations.weekSuccess} />
            <MetricRow label="Valor convertido em 7 dias" value={formatCurrency(cloud.generations.weekValue)} />
            <MetricRow label="Falhas ainda pendentes" value={cloud.generations.unresolvedFailures.length} warning={cloud.generations.unresolvedFailures.length > 0} />
          </OperationCard>

          <OperationCard title="Agenda e execução" description="Amarração das OS abertas com as tarefas do Auvo." icon={CalendarClock} href="/separations?tab=agenda">
            <MetricRow label="OS abertas no GestãoClick" value={integration?.openOrders ?? 'Carregando…'} emphasis />
            <MetricRow label="Tarefas de execução localizadas" value={integration ? `${integration.resolvedExecutionTasks}/${integration.executionTaskRefs}` : '—'} />
            <MetricRow label="Sem data / sem técnico" value={integration ? `${integration.tasksWithoutDate} / ${integration.tasksWithoutTechnician}` : '—'} warning={Boolean(integration && (integration.tasksWithoutDate || integration.tasksWithoutTechnician))} />
            <MetricRow label="Execuções ligadas para hoje" value={integration?.linkedTasksScheduledToday ?? '—'} />
          </OperationCard>

          <OperationCard title="Separação e estoque" description="Saídas concluídas e correções do processo." icon={PackageCheck} href="/separations">
            <MetricRow label="Separações hoje" value={cloud.separations.today} emphasis />
            <MetricRow label="Separações em 7 dias" value={cloud.separations.week} />
            <MetricRow label="Itens confirmados em 7 dias" value={cloud.separations.weekItems} />
            <MetricRow label="Devoluções/correções em 30 dias" value={cloud.separations.returns30d} warning={cloud.separations.returns30d > 0} />
          </OperationCard>

          <OperationCard title="Baixa parcial" description="Lotes em andamento e saldo ainda aguardado." icon={PackageMinus} href="/baixa-parcial">
            <MetricRow label="Operações abertas" value={cloud.partialWriteoff.active} emphasis />
            <MetricRow label="Aguardando saldo" value={cloud.partialWriteoff.awaitingBalance} />
            <MetricRow label="Aguardando Checkout" value={cloud.partialWriteoff.awaitingCheckoutBatches} />
            <MetricRow label="Reconciliação necessária" value={cloud.partialWriteoff.reconciliationRequired} warning={cloud.partialWriteoff.reconciliationRequired > 0} />
          </OperationCard>

          <OperationCard title="Compras e cobertura" description="Necessidade consolidada e acompanhamento de pedidos." icon={ShoppingCart} href="/compras">
            <MetricRow label="Produtos com falta" value={cloud.purchases?.shortageProducts ?? '—'} emphasis />
            <MetricRow label="Estimativa de compra" value={cloud.purchases ? formatCurrency(cloud.purchases.estimatedValue) : '—'} />
            <MetricRow label="Itens cobertos por pedido" value={cloud.purchases?.coveredItems ?? '—'} />
            <MetricRow label="Saúde do acompanhamento" value={cloud.purchaseTracker?.status === 'success' ? 'Atualizado' : 'Sem configuração'} warning={cloud.purchaseTracker?.status !== 'success'} />
          </OperationCard>

          <OperationCard title="Ativos em campo" description="Caixas e maletas sob responsabilidade da equipe." icon={Boxes} href="/controle/caixas">
            <MetricRow label="Caixas ativas" value={cloud.assets.activeBoxes} emphasis />
            <MetricRow label="Caixas sem conferência" value={cloud.assets.boxesPendingConference} warning={cloud.assets.boxesPendingConference > 0} />
            <MetricRow label="Maletas ativas" value={cloud.assets.activeToolboxes} />
            <MetricRow label="Maletas sem técnico" value={cloud.assets.unassignedToolboxes} warning={cloud.assets.unassignedToolboxes > 0} />
          </OperationCard>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg"><Sparkles className="h-5 w-5 text-primary" />Ritmo de hoje</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Execuções programadas no Auvo.</p>
              </div>
              <Badge variant="outline">{agendaProgress}% concluído</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {integration ? (
              <>
                <Progress value={agendaProgress} className="h-2.5" />
                <div className="grid grid-cols-3 divide-x rounded-xl border bg-muted/25 py-4 text-center">
                  <div><p className="text-2xl font-bold tabular-nums">{integration.agendaOpen}</p><p className="text-xs text-muted-foreground">Abertas</p></div>
                  <div><p className="text-2xl font-bold tabular-nums text-blue-600">{integration.agendaInProgress}</p><p className="text-xs text-muted-foreground">Em atendimento</p></div>
                  <div><p className="text-2xl font-bold tabular-nums text-emerald-600">{integration.agendaFinished}</p><p className="text-xs text-muted-foreground">Finalizadas</p></div>
                </div>
                <Button className="w-full" onClick={() => navigate('/separations?tab=agenda')}>Abrir agenda e separação<ArrowRight className="ml-2 h-4 w-4" /></Button>
              </>
            ) : (
              <div className="space-y-4 py-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-24 w-full rounded-xl" />
                <p className="text-center text-xs text-muted-foreground">Consultando o Auvo e cruzando as tarefas com o GestãoClick…</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg"><Activity className="h-5 w-5 text-primary" />Atividade operacional recente</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Somente eventos de negócio; acessos e navegação foram removidos.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/admin/logs')}>Ver logs</Button>
            </div>
          </CardHeader>
          <CardContent>
            {cloud.activity.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Nenhuma atividade operacional recente.</div>
            ) : (
              <div className="divide-y">
                {cloud.activity.slice(0, 7).map((log) => (
                  <button
                    type="button"
                    key={log.id}
                    onClick={() => navigate(activityRoute(log.module))}
                    className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      {log.action === 'gc_status_change' ? <RefreshCw className="h-3.5 w-3.5" /> : log.action === 'vincular_tecnico' ? <Users className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{activityLabel(log.action)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[log.entity_name, log.user_name].filter(Boolean).join(' · ') || log.module}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(log.created_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-dashed bg-muted/20">
        <CardContent className="grid gap-4 py-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center gap-3">
            <div className={cn('rounded-full p-2', integration ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
              {integration ? <CheckCircle2 className="h-4 w-4" /> : <RefreshCw className={cn('h-4 w-4', integrationQuery.isFetching && 'animate-spin')} />}
            </div>
            <div><p className="text-xs text-muted-foreground">Auvo ↔ GestãoClick</p><p className="text-sm font-semibold">{integration ? 'Conectado' : integrationQuery.isError ? 'Falha na leitura' : 'Consultando'}</p></div>
          </div>
          <div className="flex items-center gap-3">
            <div className={cn('rounded-full p-2', cloud.sync.stalledIncrementals.length ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>
              {cloud.sync.stalledIncrementals.length ? <Link2Off className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            </div>
            <div><p className="text-xs text-muted-foreground">Índice de produtos</p><p className="text-sm font-semibold">{cloud.sync.stalledIncrementals.length ? `${cloud.sync.stalledIncrementals.length} sync(s) travado(s)` : 'Operacional'}</p></div>
          </div>
          <div className="flex items-center gap-3">
            <div className={cn('rounded-full p-2', cloud.purchaseTracker?.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
              {cloud.purchaseTracker?.status === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            </div>
            <div><p className="text-xs text-muted-foreground">Rastreador de compras</p><p className="text-sm font-semibold">{cloud.purchaseTracker?.status === 'success' ? 'Atualizado' : 'Configuração pendente'}</p></div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-slate-100 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-200"><Clock3 className="h-4 w-4" /></div>
            <div><p className="text-xs text-muted-foreground">Último sync completo</p><p className="text-sm font-semibold">{formatDateTime(cloud.sync.latestSuccessfulFull?.finished_at)}</p></div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Button variant="outline" className="h-auto justify-between rounded-xl px-4 py-3" onClick={() => navigate('/checkout')}>
          <span className="flex items-center gap-2"><PackageCheck className="h-4 w-4 text-primary" />Iniciar separação</span><ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" className="h-auto justify-between rounded-xl px-4 py-3" onClick={() => navigate('/baixa-parcial')}>
          <span className="flex items-center gap-2"><PackageMinus className="h-4 w-4 text-primary" />Continuar baixa parcial</span><ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" className="h-auto justify-between rounded-xl px-4 py-3" onClick={() => navigate('/compras')}>
          <span className="flex items-center gap-2"><CircleDollarSign className="h-4 w-4 text-primary" />Gerar lista de compras</span><ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" className="h-auto justify-between rounded-xl px-4 py-3" onClick={() => navigate('/controle/maletas')}>
          <span className="flex items-center gap-2"><BriefcaseBusiness className="h-4 w-4 text-primary" />Ver ativos em campo</span><ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      <ComprasSnapshotDialog open={comprasDialogOpen} onOpenChange={setComprasDialogOpen} />
    </div>
  );
};

export default DashboardPage;
