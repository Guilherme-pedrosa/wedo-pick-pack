import { useState, useMemo } from 'react';
import { ItemCompra } from '@/api/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

type SortKey = 'codigo_produto' | 'nome_produto' | 'grupo' | 'estoque_atual' | 'qtd_necessaria' | 'qtd_efetiva_a_comprar' | 'qtd_ja_em_compra' | 'ultimo_preco' | 'estimativa' | 'fornecedor_nome';

interface Props {
  items: ItemCompra[];
  showOkStyle?: boolean;
  showCoveredStyle?: boolean;
  convertedOrcamentoIds?: Set<string>;
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatQty(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ComprasTable({ items, showOkStyle, showCoveredStyle, convertedOrcamentoIds }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('qtd_efetiva_a_comprar');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortAsc ? aVal - bVal : bVal - aVal;
      }
      return sortAsc
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [items, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const SortHeader = ({ label, col }: { label: string; col: SortKey }) => (
    <TableHead className="cursor-pointer select-none hover:bg-muted/50 text-xs whitespace-nowrap" onClick={() => handleSort(col)}>
      <span className="flex items-center gap-1">
        {label}
        {sortKey === col && (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </span>
    </TableHead>
  );

  const totalNecessario = items.reduce((s, i) => s + (i.qtd_necessaria ?? 0), 0);
  const totalEfetivo = items.reduce((s, i) => s + (i.qtd_efetiva_a_comprar ?? i.qtd_a_comprar ?? 0), 0);
  const totalEmPedido = items.reduce((s, i) => s + (i.qtd_ja_em_compra ?? 0), 0);
  const totalEstimativa = items.reduce((s, i) => s + (i.estimativa ?? 0), 0);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">Nenhum item nesta categoria</p>;
  }

  const rowBg = showOkStyle ? 'bg-green-50/50' : showCoveredStyle ? 'bg-amber-50/50' : '';

  return (
    <div className="overflow-x-auto border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <SortHeader label="Código" col="codigo_produto" />
            <SortHeader label="Produto" col="nome_produto" />
            <SortHeader label="Grupo" col="grupo" />
            <TableHead className="text-xs">UN</TableHead>
            <SortHeader label="Estoque GC" col="estoque_atual" />
            <TableHead className="text-xs">Reserv. OS</TableHead>
            <TableHead className="text-xs">Disponível</TableHead>
            <SortHeader label="Necessário" col="qtd_necessaria" />
            <SortHeader label="Em Pedido" col="qtd_ja_em_compra" />
            <SortHeader label="A Comprar" col="qtd_efetiva_a_comprar" />
            <SortHeader label="Últ. Preço" col="ultimo_preco" />
            <SortHeader label="Estimativa" col="estimativa" />
            <SortHeader label="Fornecedor" col="fornecedor_nome" />
            <TableHead className="text-xs">Orçamentos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(item => {
            const key = `${item.produto_id}::${item.variacao_id}`;
            const isExpanded = expandedRows.has(key);
            const ordensCompra = item.ordens_compra ?? [];
            const hasOrdens = ordensCompra.length > 0;
            const qtdJaEmCompra = item.qtd_ja_em_compra ?? 0;
            const qtdEfetiva = item.qtd_efetiva_a_comprar ?? item.qtd_a_comprar ?? 0;
            const orcamentos = item.orcamentos ?? [];
            return (
              <> 
                <TableRow key={key} className={rowBg}>
                  <TableCell className="font-mono text-xs">{item.codigo_produto}</TableCell>
                  <TableCell className="text-sm max-w-[200px]">
                    <span className="block truncate">{item.nome_produto}</span>
                    {!item.movimenta_estoque && (
                      <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] mt-0.5 gap-0.5">
                        <AlertTriangle className="h-2.5 w-2.5" /> Não mov. estoque
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{item.grupo || '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{item.sigla_unidade}</TableCell>
                  <TableCell className="text-sm font-medium">
                    {formatQty(item.estoque_atual)}
                  </TableCell>
                  {/* Reservado por OS */}
                  <TableCell className="text-sm">
                    {(item.estoque_reservado_os ?? 0) > 0 ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-amber-700 font-medium cursor-help">
                              −{formatQty(item.estoque_reservado_os)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p className="font-bold text-xs mb-1">Reservado por OS pendentes:</p>
                            {(item.os_reservas || []).map((r, i) => (
                              <p key={i} className="text-xs">OS #{r.os_codigo} — {r.nome_cliente} — Qtd: {r.qtd}</p>
                            ))}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {/* Disponível */}
                  <TableCell className={`text-sm font-bold ${(item.estoque_disponivel ?? item.estoque_atual) < item.qtd_necessaria ? 'text-destructive' : 'text-green-700'}`}>
                    {formatQty(item.estoque_disponivel ?? item.estoque_atual)}
                  </TableCell>
                  <TableCell className="text-sm">{formatQty(item.qtd_necessaria)}</TableCell>
                  {/* Em Pedido */}
                  <TableCell className="text-sm">
                    {qtdJaEmCompra === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="font-medium">{formatQty(qtdJaEmCompra)}</span>
                        {qtdJaEmCompra >= (item.qtd_a_comprar ?? 0) ? (
                          <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px] px-1">✅ Coberto</Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] px-1">⚠️ Parcial</Badge>
                        )}
                        {hasOrdens && (
                          <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]" onClick={() => toggleRow(key)}>
                            {ordensCompra.length}p
                            {isExpanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                  {/* A Comprar (efetivo) */}
                  <TableCell className={`text-sm font-bold ${qtdEfetiva > 0 ? 'text-destructive' : 'text-green-700'}`}>
                    {qtdEfetiva > 0 ? formatQty(qtdEfetiva) : '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.ultimo_preco > 0 ? formatBRL(item.ultimo_preco) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm font-bold">{formatBRL(item.estimativa)}</TableCell>
                  <TableCell className="text-xs">
                    {item.fornecedor_nome ? (
                      <div>
                        <span className="font-medium">{item.fornecedor_nome}</span>
                        {item.fornecedor_telefone && <span className="block text-muted-foreground">{item.fornecedor_telefone}</span>}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Sem fornecedor</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px]">
                    <div className="flex flex-wrap gap-1">
                      {orcamentos.map(orc => {
                        const isConverted = convertedOrcamentoIds?.has(orc.id);
                        return (
                          <TooltipProvider key={orc.id}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] font-mono whitespace-nowrap ${isConverted ? 'bg-amber-100 text-amber-800 border-amber-300' : ''}`}
                                >
                                  {orc.codigo} ({orc.qtd})
                                  {isConverted && (
                                    <span className="ml-1 text-[9px] font-semibold text-amber-700">• Convertido</span>
                                  )}
                                </Badge>
                              </TooltipTrigger>
                              {isConverted && (
                                <TooltipContent>
                                  <p>Este orçamento já gerou Venda ou OS no GestãoClick</p>
                                </TooltipContent>
                              )}
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })}
                    </div>
                  </TableCell>
                </TableRow>
                {/* Expanded purchase orders detail */}
                {isExpanded && hasOrdens && (
                  <TableRow key={`${key}-orders`} className="bg-amber-50/30">
                    <TableCell colSpan={14} className="py-2 px-6">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-muted-foreground mb-1">PEDIDOS DE COMPRA</p>
                        {ordensCompra.map(oc => (
                          <div key={oc.id} className="flex items-center gap-4 text-xs">
                            <Badge variant="outline" className="text-[10px] bg-amber-50">PC</Badge>
                            <span className="font-mono font-medium">{oc.codigo}</span>
                            <span className="text-muted-foreground truncate max-w-[160px]">{oc.nome_fornecedor}</span>
                            <span className="font-medium">Qtd: {oc.qtd}</span>
                            <Badge variant="outline" className="text-[10px]">{oc.situacao}</Badge>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow className="font-bold">
             <TableCell colSpan={7} className="text-right text-xs">TOTAL</TableCell>
            <TableCell className="text-sm">{formatQty(totalNecessario)}</TableCell>
            <TableCell className="text-sm text-amber-700">{totalEmPedido > 0 ? formatQty(totalEmPedido) : '—'}</TableCell>
            <TableCell className="text-sm text-destructive">{formatQty(totalEfetivo)}</TableCell>
            <TableCell />
            <TableCell className="text-sm">{formatBRL(totalEstimativa)}</TableCell>
            <TableCell colSpan={2} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
