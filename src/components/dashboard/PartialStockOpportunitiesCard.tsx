import { ArrowRight, PackageCheck, RefreshCw, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { PartialStockScan } from '@/api/partialStockOpportunities';

const quantity = (n: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(n);
export default function PartialStockOpportunitiesCard({ data, error, fetching, onRefresh }: {
  data?: PartialStockScan; error: Error | null; fetching: boolean; onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const open = (id: string) => navigate(`/baixa-parcial?operation=${encodeURIComponent(id)}`);
  const operations = new Set(data?.opportunities.map(i => i.operationId)).size;
  return <Card className="rounded-2xl border-emerald-200 dark:border-emerald-900" id="baixas-disponiveis">
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
      <div>
        <CardTitle className="flex items-center gap-2 text-lg"><PackageCheck className="h-5 w-5 text-emerald-600" />Peças disponíveis para baixa parcial</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">Estoque livre para continuar as baixas abertas, após descontar reservas e comprometimentos válidos.</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={fetching}>
        <RefreshCw className={`mr-2 h-4 w-4 ${fetching ? 'animate-spin' : ''}`} />{fetching ? 'Varrendo estoque…' : 'Atualizar varredura'}
      </Button>
    </CardHeader>
    <CardContent className="space-y-4">
      {error ? <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
        <p className="font-semibold">Não foi possível concluir a varredura</p><p>{error.message}</p>
        <p className="mt-1">As sugestões anteriores ficam ocultas até uma nova conferência.</p>
      </div> : !data ? <p role="status" className="text-sm text-muted-foreground">Conferindo todas as baixas abertas, os orçamentos e o estoque no GC. O restante do dashboard continua disponível.</p> : <>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">{operations} {operations === 1 ? 'baixa com peças' : 'baixas com peças'}</Badge>
          <Badge variant="secondary">{data.opportunities.length} {data.opportunities.length === 1 ? 'item disponível' : 'itens disponíveis'}</Badge>
          <span>{data.operationsChecked} operações abertas verificadas · {new Date(data.checkedAt).toLocaleString('pt-BR')}</span>
        </div>
        {data.opportunities.length === 0 ? <p className="text-sm text-muted-foreground">{data.issues.length ? 'Nenhuma sugestão liberada nas operações validadas. Confira as pendências abaixo.' : 'Nenhuma peça pendente tem estoque livre para nova baixa neste momento.'}</p> : <div className="max-h-[28rem] overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left"><tr>
              <th className="px-3 py-2">Orçamento / venda</th><th className="min-w-52 px-3 py-2">Produto</th>
              <th className="px-3 py-2 text-right">Pendente</th><th className="px-3 py-2 text-right">Estoque GC</th>
              <th className="px-3 py-2 text-right">Comprometido</th><th className="px-3 py-2 text-right">Pode baixar</th><th className="px-3 py-2"><span className="sr-only">Abrir baixa</span></th>
            </tr></thead>
            <tbody>{data.opportunities.map(item => <tr key={`${item.operationId}:${item.itemId}`} className="border-t">
              <td className="px-3 py-3"><span className="font-semibold">{item.sourceKind === 'venda' ? 'Venda' : 'Orçamento'} #{item.budgetCode}</span><p className="max-w-64 text-xs text-muted-foreground">{item.clientName}</p></td>
              <td className="px-3 py-3">{item.productName}{item.productCode && <p className="text-xs text-muted-foreground">{item.productCode}</p>}</td>
              <td className="px-3 py-3 text-right tabular-nums">{quantity(item.pendingQuantity)} {item.unit}</td>
              <td className="px-3 py-3 text-right tabular-nums">{quantity(item.stockQuantity)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{quantity(item.committedQuantity)}</td>
              <td className="px-3 py-3 text-right"><strong className="whitespace-nowrap text-emerald-700 dark:text-emerald-400">{quantity(item.suggestedQuantity)} {item.unit}</strong>
                <p className="text-xs text-muted-foreground">{item.suggestedQuantity === item.pendingQuantity ? 'Cobre a pendência' : 'Cobre parte da pendência'}</p>
                {item.allocatedEarlier > 0 && <p className="text-xs text-muted-foreground">{quantity(item.allocatedEarlier)} sugerido(s) antes</p>}
              </td>
              <td className="px-3 py-3"><Button size="sm" variant="outline" onClick={() => open(item.operationId)} aria-label={`Abrir baixa ${item.budgetCode}`}>Abrir baixa<ArrowRight className="ml-1 h-3.5 w-3.5" /></Button></td>
            </tr>)}</tbody>
          </table>
        </div>}
        {data.issues.length > 0 && <details className="rounded-lg border border-amber-200 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-amber-800 dark:text-amber-300"><AlertTriangle className="mr-2 inline h-4 w-4" />{data.issues.length} pendência(s) de conferência</summary>
          <ul className="mt-2 space-y-2">{data.issues.map((issue, index) => <li key={`${issue.operationId}:${index}`}>
            <button className="font-medium underline underline-offset-2" onClick={() => open(issue.operationId)}>#{issue.budgetCode}</button> — {issue.message}
          </li>)}</ul>
        </details>}
      </>}
      <p className="text-xs text-muted-foreground">Atualização a cada 5 minutos enquanto o dashboard estiver aberto. Peças compartilhadas são distribuídas entre as baixas mais antigas. Esta consulta não reserva nem baixa estoque; a disponibilidade será conferida novamente na operação.</p>
    </CardContent>
  </Card>;
}
