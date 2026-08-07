import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelPartialOperation,
  consolidatePartialOperation,

  listPartialOperations,
  openPartialOperation,
  PartialBudgetSearchResult,
  PartialWriteoffOperation,
  preparePartialBatch,
  searchPartialBudgets,
} from '@/api/partialWriteoff';
import { getProductStock } from '@/api/gestaoclick';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  PackageMinus,
  RefreshCw,
  Search,
  XCircle,

} from 'lucide-react';
import { toast } from 'sonner';

const statusLabels: Record<string, string> = {
  awaiting_separation: 'Aguardando separação',
  partial_separation: 'Separação parcial',
  awaiting_balance: 'Aguardando saldo',
  ready_to_consolidate: 'Pronto para consolidar',
  consolidating: 'Consolidando',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  reconciliation_required: 'Reconciliação necessária',
};

function fmtQty(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 6 });
}

function fmtDate(value: string) {
  return new Date(value).toLocaleString('pt-BR');
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('INSUFFICIENT_STOCK:')) {
    const [, product, stock] = message.split(':');
    return `Saldo insuficiente para ${product}. Saldo atual: ${fmtQty(Number(stock))}.`;
  }
  if (message.includes('QUANTITY_EXCEEDS_PENDING')) return 'A quantidade informada ultrapassa o saldo pendente.';
  if (message.includes('CONFIGURE_OS_CONCLUSION_STATUS')) return 'Configure a situação padrão de conclusão de OS antes de consolidar.';
  if (message.includes('CONFIGURE_AUVO_USER_ID')) return 'Configure o ID de usuário Auvo antes de consolidar.';
  if (message.includes('SEARCH_TOO_SHORT')) return 'Digite pelo menos 2 caracteres para buscar.';
  if (message.includes('SEARCH_BUDGET_KIND_REQUIRED')) return 'Escolha Orçamento de produto, Orçamento de serviço ou Venda.';
  if (message.includes('BUDGET_ALREADY_HAS_DOCUMENT')) return 'Este orçamento já gerou OS ou venda e não pode entrar na baixa parcial.';
  if (message.includes('SALE_ALREADY_MOVED_STOCK')) return 'Esta venda já movimentou estoque e não pode entrar na baixa parcial.';
  if (message.includes('SALE_FINAL_STOCK_NOT_APPLIED')) return 'A venda não confirmou a baixa definitiva de estoque. A operação foi travada para conferência.';
  if (message.includes('SALE_FINAL_FINANCIAL_NOT_PRESERVED')) return 'O financeiro da venda não foi preservado como esperado. A operação foi travada para conferência.';
  return message;
}

function statusClass(status: string) {
  if (status === 'completed') return 'bg-green-100 text-green-800 border-green-200';
  if (status === 'reconciliation_required') return 'bg-red-100 text-red-800 border-red-200';
  if (status === 'ready_to_consolidate') return 'bg-blue-100 text-blue-800 border-blue-200';
  return 'bg-amber-100 text-amber-800 border-amber-200';
}

function sourceLabel(kind: PartialBudgetSearchResult['budget_kind']) {
  if (kind === 'venda') return 'Venda';
  return kind === 'produto' ? 'Orçamento de produto' : 'Orçamento de serviço';
}

function sourceNoun(kind: PartialBudgetSearchResult['budget_kind']) {
  if (kind === 'venda') return 'venda';
  return kind === 'produto' ? 'orçamento de produto' : 'orçamento de serviço';
}

function operationIsExistingSale(operation: PartialWriteoffOperation | null) {
  return (operation?.budget_snapshot as Record<string, unknown> | undefined)?._partial_source_kind === 'venda';
}

export default function PartialWriteoffPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const [budgetKind, setBudgetKind] = useState<PartialBudgetSearchResult['budget_kind'] | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PartialBudgetSearchResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [preparing, setPreparing] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [auvoCustomerId, setAuvoCustomerId] = useState('');
  const [manualEquipment, setManualEquipment] = useState('');
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const batchRequestKey = useRef<string | null>(null);

  const operationsQuery = useQuery({
    queryKey: ['partial-writeoff-operations'],
    queryFn: listPartialOperations,
    refetchInterval: 30000,
    staleTime: 5000,
  });
  const operations = operationsQuery.data || [];
  const selected = operations.find(operation => operation.id === selectedId) || null;

  useEffect(() => {
    if (!selectedId && operations.length > 0) {
      const firstActive = operations.find(operation => !['completed', 'cancelled'].includes(operation.status));
      setSelectedId((firstActive || operations[0]).id);
    }
  }, [operations, selectedId]);

  useEffect(() => {
    if (!selected) return;
    const next: Record<string, string> = {};
    for (const item of selected.items) next[item.id] = '';
    setQuantities(next);
  }, [selected?.id, selected?.version]);

  useEffect(() => {
    batchRequestKey.current = null;
  }, [selected?.id]);

  const stockQuery = useQuery({
    queryKey: ['partial-writeoff-stock', selected?.id, selected?.version],
    queryFn: async () => {
      const map: Record<string, number> = {};
      for (const item of selected?.items || []) {
        const stock = await getProductStock(item.product_id, item.variation_id || undefined);
        map[item.id] = stock?.estoque ?? 0;
      }
      return map;
    },
    enabled: !!selected && !['completed', 'cancelled'].includes(selected.status),
    staleTime: 15000,
  });

  const requestedItems = useMemo(() => {
    if (!selected) return [];
    return selected.items.map(item => ({ item_id: item.id, quantity: Number(String(quantities[item.id] || '').replace(',', '.')) }))
      .filter(item => Number.isFinite(item.quantity) && item.quantity > 0);
  }, [quantities, selected]);

  // Só é possível cancelar enquanto nada foi efetivado no GestãoClick:
  // nenhum documento auxiliar criado, nenhuma peça reservada ou retirada.
  const canCancelSelected = useMemo(() => {
    if (!selected) return false;
    if (['completed', 'cancelled', 'consolidating'].includes(selected.status)) return false;
    const hasGcDocument = selected.batches.some(batch =>
      !!batch.auxiliary_document_id || !['failed', 'cancelled'].includes(batch.status));
    if (hasGcDocument) return false;
    return !selected.items.some(item => Number(item.withdrawn_quantity) > 0 || Number(item.reserved_quantity) > 0);
  }, [selected]);

  async function handleCancelOperation() {
    if (!selected || cancelling) return;
    if (!window.confirm(`Cancelar a baixa parcial do #${selected.budget_code}? Nada foi efetivado no GestãoClick.`)) return;
    setCancelling(true);
    try {
      await cancelPartialOperation(selected.id);
      toast.success('Baixa parcial cancelada.');
      setSelectedId(null);
      await refresh();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setCancelling(false);
    }
  }


  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['partial-writeoff-operations'] }),
      queryClient.invalidateQueries({ queryKey: ['partial-writeoff-stock'] }),
      queryClient.invalidateQueries({ queryKey: ['partial-checkout-queue'] }),
    ]);
  }

  async function handleManualRefresh() {
    if (manualRefreshing) return;
    setManualRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['partial-checkout-queue'] });
      const result = await operationsQuery.refetch();
      await queryClient.refetchQueries({ queryKey: ['partial-writeoff-stock'] });
      if (result.error) throw result.error;
      toast.success('Lista atualizada.');
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setManualRefreshing(false);
    }
  }


  async function handleSearch() {
    if (!budgetKind) {
      toast.error('Escolha Orçamento de produto, Orçamento de serviço ou Venda.');
      return;
    }
    if (term.trim().length < 2) {
      toast.error('Digite pelo menos 2 caracteres.');
      return;
    }
    setSearching(true);
    setHasSearched(false);
    setResults([]);
    try {
      setResults(await searchPartialBudgets(term, budgetKind));
      setHasSearched(true);
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setSearching(false);
    }
  }

  async function handleOpen(budget: PartialBudgetSearchResult) {
    if (budget.partial_operation?.id) {
      setSelectedId(budget.partial_operation.id);
      return;
    }
    setOpeningId(budget.id);
    try {
      const operation = await openPartialOperation(budget.id, budget.budget_kind);
      await refresh();
      setSelectedId(operation.id);
      toast.success(`${budget.budget_kind === 'venda' ? 'Venda' : 'Orçamento'} #${operation.budget_code} entrou no fluxo de baixa parcial.`);
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setOpeningId(null);
    }
  }

  async function handlePrepare() {
    if (!selected || requestedItems.length === 0) {
      toast.error('Informe ao menos uma quantidade para retirar.');
      return;
    }
    setPreparing(true);
    try {
      if (!batchRequestKey.current) batchRequestKey.current = crypto.randomUUID();
      await preparePartialBatch(selected.id, requestedItems, batchRequestKey.current as string);
      batchRequestKey.current = null;
      await refresh();
      toast.success('Documento auxiliar criado. O lote já está na fila do Checkout.');
      navigate('/checkout');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const ambiguous = /failed to send|network|fetch|timeout|BATCH_CREATION_IN_PROGRESS/i.test(message);
      if (!ambiguous) batchRequestKey.current = null;
      toast.error(message.includes('BATCH_CREATION_IN_PROGRESS')
        ? 'O lote ainda está sendo criado. Aguarde alguns segundos e tente novamente.'
        : friendlyError(error), { duration: 8000 });
    } finally {
      setPreparing(false);
    }
  }

  async function handleConsolidate() {
    if (!selected) return;
    setConsolidating(true);
    try {
      const completed = await consolidatePartialOperation(selected.id, {
        auvoCustomerId,
        manualEquipment,
      });
      await refresh();
      toast.success(operationIsExistingSale(completed)
        ? `Venda #${completed.definitive_document_code} atualizada e baixa consolidada.`
        : `${completed.document_type === 'os' ? 'OS' : 'Venda'} definitiva #${completed.definitive_document_code} criada e auxiliares compensados.`);
    } catch (error) {
      toast.error(friendlyError(error), { duration: 10000 });
      await refresh();
    } finally {
      setConsolidating(false);
    }
  }

  return (
    <div className="min-h-full bg-muted/30 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div>
          <div className="flex items-center gap-2">
            <PackageMinus className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Baixa Parcial</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Retire apenas o que está disponível. O orçamento ou a venda permanece como documento-mãe até a consolidação final.
          </p>
        </div>

        <Alert className="border-amber-200 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
          <AlertTitle>Fluxo isolado e rastreável</AlertTitle>
          <AlertDescription>
            Os auxiliares movimentam somente estoque. Não geram financeiro, comissão, serviços, Auvo nem uma nova demanda em Compras.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Localizar documento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <p className="text-sm font-medium">1. O que você quer baixar?</p>
              <div className="grid max-w-3xl grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Origem da baixa parcial">
                <Button
                  type="button"
                  variant={budgetKind === 'produto' ? 'default' : 'outline'}
                  aria-pressed={budgetKind === 'produto'}
                  onClick={() => {
                    setBudgetKind('produto');
                    setResults([]);
                    setHasSearched(false);
                  }}
                >
                  Orçamento de produto
                </Button>
                <Button
                  type="button"
                  variant={budgetKind === 'servico' ? 'default' : 'outline'}
                  aria-pressed={budgetKind === 'servico'}
                  onClick={() => {
                    setBudgetKind('servico');
                    setResults([]);
                    setHasSearched(false);
                  }}
                >
                  Orçamento de serviço
                </Button>
                <Button
                  type="button"
                  variant={budgetKind === 'venda' ? 'default' : 'outline'}
                  aria-pressed={budgetKind === 'venda'}
                  onClick={() => {
                    setBudgetKind('venda');
                    setResults([]);
                    setHasSearched(false);
                  }}
                >
                  Venda
                </Button>
              </div>
            </div>
            <p className="text-sm font-medium">2. Informe o número {budgetKind === 'venda' ? 'da venda' : 'do orçamento'}:</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={term}
                  onChange={event => {
                    setTerm(event.target.value);
                    setResults([]);
                    setHasSearched(false);
                  }}
                  onKeyDown={event => event.key === 'Enter' && void handleSearch()}
                  placeholder={budgetKind
                    ? budgetKind === 'venda'
                      ? 'Número, cliente ou CNPJ da venda'
                      : `Número, cliente ou CNPJ do ${sourceNoun(budgetKind)}`
                    : 'Primeiro escolha Orçamento de produto, Orçamento de serviço ou Venda'}
                  className="pl-9"
                />
              </div>
              <Button onClick={handleSearch} disabled={searching || !budgetKind}>
                {searching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Buscar
              </Button>
            </div>

            {results.length > 0 && (
              <div className="grid gap-2 md:grid-cols-2">
                {results.map(budget => (
                  <div
                    key={`${budget.budget_kind}:${budget.id}`}
                    className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${budget.eligible_for_partial_writeoff ? 'bg-background' : 'border-amber-300 bg-amber-50'}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{budget.budget_kind === 'venda' ? 'Venda' : 'Orçamento'} #{budget.codigo}</p>
                        <Badge variant="outline">
                          {sourceLabel(budget.budget_kind)}
                        </Badge>
                      </div>
                      <p className="truncate text-sm">{budget.nome_cliente}</p>
                      <p className="text-xs text-muted-foreground">{budget.nome_situacao} · R$ {budget.valor_total}</p>
                      {!budget.eligible_for_partial_writeoff && (
                        <p className="mt-1 text-xs font-medium text-amber-800">
                          {budget.budget_kind === 'venda'
                            ? 'Esta venda já movimentou estoque. Baixa parcial bloqueada.'
                            : `Já possui ${budget.nome_situacao.toLocaleLowerCase('pt-BR').includes('os') ? 'OS' : 'venda'} gerada. Baixa parcial bloqueada.`}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant={budget.partial_operation ? 'outline' : 'default'}
                      onClick={() => handleOpen(budget)}
                      disabled={openingId === budget.id || !budget.eligible_for_partial_writeoff}
                    >
                      {openingId === budget.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {!budget.eligible_for_partial_writeoff
                        ? budget.budget_kind === 'venda' ? 'Estoque já baixado' : 'Documento já gerado'
                        : budget.partial_operation ? 'Abrir controle' : 'Iniciar baixa'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {!searching && hasSearched && results.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum {budgetKind ? sourceNoun(budgetKind) : 'documento'} encontrado para “{term.trim()}”.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Operacões</CardTitle>
                <Button variant="ghost" size="icon" onClick={handleManualRefresh} disabled={manualRefreshing}>
                  <RefreshCw className={`h-4 w-4 ${manualRefreshing || operationsQuery.isFetching ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {operations.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma baixa parcial iniciada.</p>}
              {operations.map(operation => (
                <button
                  key={operation.id}
                  type="button"
                  onClick={() => setSelectedId(operation.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${selectedId === operation.id ? 'border-primary bg-primary/5' : 'bg-background hover:bg-muted/50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">#{operation.budget_code}</span>
                    <Badge variant="outline" className={statusClass(operation.status)}>{statusLabels[operation.status] || operation.status}</Badge>
                  </div>
                  <p className="mt-1 truncate text-sm">{operation.client_name}</p>
                  <p className="text-xs text-muted-foreground">{operation.document_type === 'os' ? 'Ordem de Serviço' : 'Venda'} · {fmtDate(operation.updated_at)}</p>
                </button>
              ))}
            </CardContent>
          </Card>

          {!selected ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Busque um orçamento ou uma venda, ou selecione uma operação.</CardContent></Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div>
                    <CardTitle>{operationIsExistingSale(selected) ? 'Venda' : 'Orçamento'} #{selected.budget_code}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selected.client_name} · {operationIsExistingSale(selected)
                        ? 'documento-mãe: Venda'
                        : `destino final: ${selected.document_type === 'os' ? 'OS' : 'Venda'}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={statusClass(selected.status)}>{statusLabels[selected.status] || selected.status}</Badge>
                    {canCancelSelected && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelOperation}
                        disabled={cancelling}
                        className="border-red-200 text-red-700 hover:bg-red-50"
                      >
                        {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                        Cancelar baixa parcial
                      </Button>
                    )}
                  </div>
                </div>

              </CardHeader>
              <CardContent className="space-y-5">
                {selected.status === 'reconciliation_required' && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Operação travada para conferência</AlertTitle>
                    <AlertDescription>{selected.reconciliation_reason || 'O estado do documento no GestãoClick precisa ser conferido antes de continuar.'}</AlertDescription>
                  </Alert>
                )}

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-muted/70 text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left">Produto</th>
                        <th className="px-3 py-2 text-right">Solicitado</th>
                        <th className="px-3 py-2 text-right">Já retirado</th>
                        <th className="px-3 py-2 text-right">Reservado</th>
                        <th className="px-3 py-2 text-right">Pendente</th>
                        <th className="px-3 py-2 text-right">Saldo GC</th>
                        <th className="px-3 py-2 text-right">Retirar agora</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map(item => {
                        const stock = stockQuery.data?.[item.id];
                        const max = Math.max(0, Math.min(Number(item.available_to_reserve_quantity), stock ?? Number(item.available_to_reserve_quantity)));
                        const disabled = max <= 0 || !['awaiting_separation', 'partial_separation', 'awaiting_balance'].includes(selected.status);
                        return (
                          <tr key={item.id} className="border-t">
                            <td className="px-3 py-2">
                              <p className="font-medium">{item.product_name}</p>
                              <p className="text-xs text-muted-foreground">{item.product_code || item.product_id}</p>
                            </td>
                            <td className="px-3 py-2 text-right">{fmtQty(item.original_quantity)}</td>
                            <td className="px-3 py-2 text-right font-medium text-green-700">{fmtQty(item.withdrawn_quantity)}</td>
                            <td className="px-3 py-2 text-right text-amber-700">{fmtQty(item.reserved_quantity)}</td>
                            <td className="px-3 py-2 text-right font-semibold">{fmtQty(item.pending_purchase_quantity)}</td>
                            <td className="px-3 py-2 text-right">{stockQuery.isLoading ? '…' : fmtQty(stock)}</td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                max={max}
                                value={quantities[item.id] || ''}
                                onChange={event => setQuantities(current => ({ ...current, [item.id]: event.target.value }))}
                                placeholder={max > 0 ? `máx. ${fmtQty(max)}` : 'sem saldo'}
                                disabled={disabled}
                                className="ml-auto w-32 text-right"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {['awaiting_separation', 'partial_separation', 'awaiting_balance'].includes(selected.status) && (
                  <div className="flex flex-col items-start justify-between gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center">
                    <div>
                      <p className="font-medium">Criar o próximo lote</p>
                      <p className="text-sm text-muted-foreground">O documento auxiliar aparecerá no Checkout e só movimentará estoque depois da conferência completa.</p>
                    </div>
                    <Button onClick={handlePrepare} disabled={preparing || requestedItems.length === 0 || stockQuery.isLoading}>
                      {preparing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                      Enviar ao Checkout
                    </Button>
                  </div>
                )}

                <Separator />
                <div>
                  <h3 className="mb-3 flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4" /> Histórico de retiradas</h3>
                  {selected.batches.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum lote criado.</p>
                  ) : (
                    <div className="space-y-2">
                      {selected.batches.map(batch => (
                        <div key={batch.id} className="flex flex-col justify-between gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
                          <div className="space-y-1">
                            <p className="font-medium">Lote {batch.sequence} · {batch.auxiliary_document_type === 'os' ? 'OS' : 'Venda'} #{batch.auxiliary_document_code || '—'}</p>
                            <p className="text-xs text-muted-foreground">{fmtDate(batch.created_at)} · {batch.marker}</p>
                            {batch.auvo_task_id ? (
                              <a
                                href={`https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${batch.auvo_task_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex text-xs font-medium text-primary underline"
                              >
                                Tarefa Auvo #{batch.auvo_task_id}
                              </a>
                            ) : (
                              <p className="text-xs text-destructive">
                                {batch.auvo_task_error ? `Tarefa Auvo não criada: ${batch.auvo_task_error}` : 'Sem tarefa Auvo vinculada'}
                              </p>
                            )}
                          </div>
                          <Badge variant="outline">{batch.status === 'awaiting_checkout' ? 'Aguardando Checkout' : batch.status === 'confirmed' ? 'Baixa aplicada' : batch.status}</Badge>
                        </div>
                      ))}

                    </div>
                  )}
                </div>

                {selected.status === 'ready_to_consolidate' && (
                  <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 text-blue-700" />
                      <div>
                        <p className="font-semibold">Todas as peças foram retiradas</p>
                        <p className="text-sm text-muted-foreground">
                          {operationIsExistingSale(selected)
                            ? 'Agora os auxiliares serão compensados e a venda original receberá a baixa definitiva de estoque, mantendo o financeiro que já existe.'
                            : 'Agora os auxiliares serão compensados e o documento definitivo completo será gerado com Auvo, serviços, financeiro e comissão normais.'}
                        </p>
                      </div>
                    </div>
                    {!operationIsExistingSale(selected) && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input value={auvoCustomerId} onChange={event => setAuvoCustomerId(event.target.value)} placeholder="ID cliente Auvo (se necessário)" />
                        <Input value={manualEquipment} onChange={event => setManualEquipment(event.target.value)} placeholder="Equipamento manual (opcional)" />
                      </div>
                    )}
                    <Button onClick={handleConsolidate} disabled={consolidating} className="bg-blue-700 hover:bg-blue-800">
                      {consolidating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {operationIsExistingSale(selected) ? 'Consolidar na venda original' : 'Consolidar documento definitivo'}
                    </Button>
                  </div>
                )}

                {selected.status === 'completed' && (
                  <Alert className="border-green-200 bg-green-50">
                    <CheckCircle2 className="h-4 w-4 text-green-700" />
                    <AlertTitle>Fluxo concluído</AlertTitle>
                    <AlertDescription>
                      {operationIsExistingSale(selected)
                        ? `Venda original #${selected.definitive_document_code} atualizada com a baixa definitiva de estoque.`
                        : `${selected.document_type === 'os' ? 'OS' : 'Venda'} definitiva #${selected.definitive_document_code} · Auvo #${selected.definitive_auvo_task_id || '—'}.`}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
