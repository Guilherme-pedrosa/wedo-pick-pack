import { useComprasStore } from '@/store/comprasStore';
import { ItemCompra } from '@/api/types';
import ComprasTable from './ComprasTable';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import {
  ShoppingCart, ShoppingBag, AlertTriangle, CheckCircle2, DollarSign,
  Download, Printer, Loader2, ChevronDown, RefreshCw, Clock, X,
} from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function exportCSV(itensList: ItemCompra[], scannedAt: string) {
  const header = ['Código', 'Produto', 'UN', 'Estoque Atual', 'Qtd Necessária', 'A Comprar', 'Em Pedido (Qtd)', 'Último Preço (R$)', 'Estimativa (R$)', 'Fornecedor', 'Telefone Fornecedor', 'Orçamentos', 'Pedidos de Compra'];
  const rows = itensList.map(i => [
    i.codigo_produto,
    i.nome_produto,
    i.sigla_unidade,
    i.estoque_atual,
    i.qtd_necessaria,
    i.qtd_efetiva_a_comprar,
    i.qtd_ja_em_compra,
    i.ultimo_preco.toFixed(2).replace('.', ','),
    i.estimativa.toFixed(2).replace('.', ','),
    i.fornecedor_nome || '',
    i.fornecedor_telefone || '',
    i.orcamentos.map(o => `${o.codigo}(${o.qtd})`).join(' | '),
    i.ordens_compra.map(o => `${o.codigo}(${o.qtd})`).join(' | '),
  ]);
  const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `lista-compras-${scannedAt.slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function handlePrint(result: NonNullable<ReturnType<typeof useComprasStore.getState>['result']>) {
  if (!result) return;
  const rows = result.itensList.map(i =>
    `<tr>
      <td style="padding:4px 8px;border:1px solid #ddd;font-family:monospace;font-size:11px">${i.codigo_produto}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;font-size:12px">${i.nome_produto}${!i.movimenta_estoque ? ' ⚠️' : ''}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center">${i.sigla_unidade}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;color:${i.estoque_atual < i.qtd_necessaria ? 'red' : 'green'}">${i.estoque_atual}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center">${i.qtd_necessaria}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center">${i.qtd_ja_em_compra > 0 ? i.qtd_ja_em_compra : '—'}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;font-weight:bold;color:red">${i.qtd_efetiva_a_comprar}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${i.ultimo_preco > 0 ? formatBRL(i.ultimo_preco) : '—'}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-weight:bold">${formatBRL(i.estimativa)}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px">${i.fornecedor_nome || '—'}<br><small>${i.fornecedor_telefone || ''}</small></td>
      <td style="padding:4px 8px;border:1px solid #ddd;font-size:10px">${i.orcamentos.map(o => `${o.codigo}(${o.qtd})`).join(', ')}</td>
    </tr>`
  ).join('');

  const date = new Date(result.scannedAt).toLocaleDateString('pt-BR');
  const html = `<!DOCTYPE html><html><head><title>Lista de Compras - WeDo</title></head><body style="font-family:Arial,sans-serif;padding:20px">
    <h1 style="text-align:center;margin-bottom:4px">🛒 WeDo — Lista de Compras</h1>
    <p style="text-align:center;color:#666">${date} · ${result.totalOrcamentos} orçamentos · ${result.totalProdutosSemEstoque} itens para comprar${(result.totalItensCobertosporPedido ?? 0) > 0 ? ` · ${result.totalItensCobertosporPedido} cobertos por pedido` : ''} · Estimativa: ${formatBRL(result.estimativaTotal)}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px">
      <thead><tr style="background:#f3f4f6">
        <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Código</th>
        <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Produto</th>
        <th style="padding:6px 8px;border:1px solid #ddd">UN</th>
        <th style="padding:6px 8px;border:1px solid #ddd">Estoque</th>
        <th style="padding:6px 8px;border:1px solid #ddd">Necessário</th>
        <th style="padding:6px 8px;border:1px solid #ddd">Em Pedido</th>
        <th style="padding:6px 8px;border:1px solid #ddd">A Comprar</th>
        <th style="padding:6px 8px;border:1px solid #ddd">Últ. Preço</th>
        <th style="padding:6px 8px;border:1px solid #ddd">Estimativa</th>
        <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Fornecedor</th>
        <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Orçamentos</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="text-align:center;color:#999;margin-top:24px;font-size:11px">Documento gerado pelo WeDo Compras · wedocorp.com</p>
  </body></html>`;

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); w.print(); }
}

export default function ComprasResultPanel() {
  const { result, isScanning, progress, clearResult } = useComprasStore();
  const [okExpanded, setOkExpanded] = useState(false);
  const [cobertosExpanded, setCobertosExpanded] = useState(false);
  const [convertidosDismissed, setConvertidosDismissed] = useState(false);

  const convertidos = result?.orcamentosConvertidos ?? [];
  const convertedOrcamentoIds = useMemo(
    () => new Set(convertidos.map(c => c.orcamento_id)),
    [convertidos]
  );

  useEffect(() => {
    setConvertidosDismissed(false);
  }, [result?.scannedAt]);

  if (!result && !isScanning) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
        <ShoppingCart className="h-16 w-16 mb-4 opacity-30" />
        <h2 className="text-lg font-semibold mb-1">Nenhuma varredura realizada</h2>
        <p className="text-sm text-center max-w-sm">
          Selecione as situações de orçamento ao lado e clique em <strong>"Gerar Lista de Compras"</strong> para iniciar.
        </p>
      </div>
    );
  }

  if (isScanning) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <h2 className="text-lg font-semibold mb-1">Gerando lista de compras…</h2>
        <p className="text-sm text-muted-foreground mb-4">{progress.step}</p>
        {progress.total > 0 && (
          <div className="w-64">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${(progress.checked / progress.total) * 100}%` }} />
            </div>
            <p className="text-xs text-center text-muted-foreground mt-1">{progress.checked}/{progress.total}</p>
          </div>
        )}
      </div>
    );
  }

  if (!result) return null;

  // Backward compat: old persisted results may lack new fields
  const itensCobertos = result.itensCobertosporPedido ?? [];
  const totalCobertos = result.totalItensCobertosporPedido ?? 0;

  const scannedDate = new Date(result.scannedAt).toLocaleString('pt-BR');

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border bg-card flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" /> Lista de Compras
          </h2>
          <p className="text-xs text-muted-foreground">{scannedDate}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCSV(result.itensList, result.scannedAt)}>
            <Download className="h-4 w-4 mr-1.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handlePrint(result)}>
            <Printer className="h-4 w-4 mr-1.5" /> Imprimir
          </Button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Converted budgets warning */}
        {convertidos.length > 0 && !convertidosDismissed && (
          <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-amber-900">
                  Atenção — {convertidos.length} orçamento(s) já convertido(s)
                </h3>
                <p className="text-sm text-amber-800 mt-1">
                  Os orçamentos abaixo já geraram OS no GestãoClick. Verifique antes de prosseguir com a compra.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {convertidos.map(c => (
                    <Badge
                      key={c.orcamento_id}
                      className="bg-amber-100 text-amber-900 border border-amber-300 text-xs font-mono"
                    >
                      {c.codigo} — {c.nome_cliente}
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConvertidosDismissed(true)}
                    className="gap-1.5"
                  >
                    <X className="h-3.5 w-3.5" /> Ignorar e continuar
                  </Button>
                  <Button
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
                    onClick={() => {
                      const el = document.getElementById('compras-table-section');
                      el?.scrollIntoView({ behavior: 'smooth' });
                    }}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" /> Revisar orçamentos
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100"><ShoppingBag className="h-5 w-5 text-blue-700" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Orçamentos</p>
              <p className="text-xl font-bold text-foreground">{result.totalOrcamentos}</p>
            </div>
          </Card>
          <Card className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100"><AlertTriangle className="h-5 w-5 text-red-700" /></div>
            <div>
              <p className="text-xs text-muted-foreground">A Comprar</p>
              <p className="text-xl font-bold text-destructive">{result.totalProdutosSemEstoque}</p>
            </div>
          </Card>
          <Card className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100"><Clock className="h-5 w-5 text-amber-700" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Pedido em aberto</p>
              <p className="text-xl font-bold text-amber-700">{totalCobertos}</p>
            </div>
          </Card>
          <Card className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100"><CheckCircle2 className="h-5 w-5 text-green-700" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Com Estoque</p>
              <p className="text-xl font-bold text-green-700">{result.totalProdutosOk}</p>
            </div>
          </Card>
          <Card className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100"><DollarSign className="h-5 w-5 text-purple-700" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Estimativa</p>
              <p className="text-xl font-bold text-purple-700">{formatBRL(result.estimativaTotal)}</p>
            </div>
          </Card>
        </div>

        {/* Main table */}
        {result.itensList.length > 0 && (
          <div id="compras-table-section">
            <h3 className="text-sm font-bold text-foreground mb-2">Itens para compra ({result.itensList.length})</h3>
            <ComprasTable items={result.itensList} convertedOrcamentoIds={convertedOrcamentoIds} />
          </div>
        )}

        {result.itensList.length === 0 && (
          <Card className="p-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto mb-2" />
            <p className="font-medium text-foreground">Todos os itens possuem estoque suficiente ou estão cobertos por pedidos!</p>
          </Card>
        )}

        {/* Covered by purchase orders */}
        {itensCobertos.length > 0 && (
          <Collapsible open={cobertosExpanded} onOpenChange={setCobertosExpanded}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between text-sm">
                <span>🔄 Itens cobertos por pedidos de compra ({itensCobertos.length})</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${cobertosExpanded ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ComprasTable items={itensCobertos} showCoveredStyle />
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* OK items */}
        {result.itensOkList.length > 0 && (
          <Collapsible open={okExpanded} onOpenChange={setOkExpanded}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between text-sm">
                <span>Produtos com estoque suficiente ({result.itensOkList.length})</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${okExpanded ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ComprasTable items={result.itensOkList} showOkStyle />
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground">Varredura realizada em {scannedDate}</p>
          <Button variant="outline" size="sm" onClick={clearResult} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Nova Varredura
          </Button>
        </div>
      </div>
    </div>
  );
}
