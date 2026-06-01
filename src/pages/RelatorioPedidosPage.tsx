import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { getStatusCompras } from '@/api/compras';
import {
  fetchAllPedidos,
  buildDemandIndex,
  attachVinculos,
  loadPedidosFromDB,
  syncPedidos,
  type PedidoCompra,
  type DemandIndex,
  type PedidoComVinculos,
  type VinculoDoc,
} from '@/api/relatorioPedidos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, RefreshCw, ChevronDown, ChevronRight, FileText,
  FileSpreadsheet, FileDown, Truck, Link2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

function fmtCurrency(v: number): string {
  return (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(s: string): string {
  if (!s) return '—';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

const VINCULO_LABEL: Record<string, string> = { os: 'OS', venda: 'Venda', orcamento: 'Orçamento' };

export default function RelatorioPedidosPage() {
  const [statuses, setStatuses] = useState<{ id: string; nome: string }[]>([]);
  const [selectedSit, setSelectedSit] = useState<string[]>([]);
  const [fornecedor, setFornecedor] = useState<string>(''); // fornecedor_id ('' = todos)
  const [forSearch, setForSearch] = useState('');
  const [dataInicial, setDataInicial] = useState('');
  const [dataFinal, setDataFinal] = useState('');

  const [allPedidos, setAllPedidos] = useState<PedidoCompra[]>([]);
  const [demandIndex, setDemandIndex] = useState<DemandIndex>({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    getStatusCompras()
      .then((s) => setStatuses(s.map((x) => ({ id: String(x.id), nome: String(x.nome) }))))
      .catch((e: any) => toast.error('Erro ao carregar situações', { description: e.message }));
  }, []);

  // Carrega os pedidos já salvos no banco assim que a página abre (instantâneo).
  useEffect(() => {
    (async () => {
      try {
        const pedidos = await loadPedidosFromDB();
        if (pedidos.length) {
          setAllPedidos(pedidos);
          setLoaded(true);
        }
      } catch (e: any) {
        console.warn('[RELATORIO] Falha ao carregar pedidos do banco', e);
      }
    })();
  }, []);

  const fornecedores = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of allPedidos) {
      if (p.fornecedor_id && !map.has(p.fornecedor_id)) map.set(p.fornecedor_id, p.nome_fornecedor);
    }
    return [...map.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [allPedidos]);

  const toggleSit = (id: string) =>
    setSelectedSit((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Sincroniza com o GestãoClick: insere os novos e atualiza só os alterados.
  const handleScan = async (full = false) => {
    setLoading(true);
    try {
      const result = await syncPedidos((step) => setProgress(step), full);
      const pedidos = await loadPedidosFromDB();
      setAllPedidos(pedidos);
      const idx = await buildDemandIndex((step) => setProgress(step));
      setDemandIndex(idx);
      setLoaded(true);
      toast.success(
        `Sincronizado: ${result.novos} novo(s), ${result.atualizados} atualizado(s)`,
        { description: `${pedidos.length} pedido(s) no total` },
      );
    } catch (e: any) {
      toast.error('Erro ao sincronizar pedidos', { description: e.message });
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  const filtered: PedidoComVinculos[] = useMemo(() => {
    let rows = allPedidos;
    if (fornecedor) rows = rows.filter((p) => p.fornecedor_id === fornecedor);
    if (selectedSit.length) rows = rows.filter((p) => selectedSit.includes(p.situacao_id));
    if (dataInicial) rows = rows.filter((p) => (p.data_emissao || '').slice(0, 10) >= dataInicial);
    if (dataFinal) rows = rows.filter((p) => (p.data_emissao || '').slice(0, 10) <= dataFinal);
    rows = [...rows].sort((a, b) => (b.data_emissao || '').localeCompare(a.data_emissao || ''));
    return attachVinculos(rows, demandIndex);
  }, [allPedidos, demandIndex, fornecedor, selectedSit, dataInicial, dataFinal]);

  const totals = useMemo(() => {
    let valor = 0, icms = 0;
    for (const p of filtered) { valor += p.valor_total; icms += p.icms; }
    return { count: filtered.length, valor, icms };
  }, [filtered]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const fornecedorLabel = fornecedor
    ? fornecedores.find((f) => f.id === fornecedor)?.nome ?? 'Fornecedor'
    : 'Todos os fornecedores';

  const norm = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const isSubsequence = (needle: string, hay: string) => {
    let i = 0;
    for (let j = 0; j < hay.length && i < needle.length; j++) {
      if (hay[j] === needle[i]) i++;
    }
    return i === needle.length;
  };
  const filteredForList = useMemo(() => {
    const q = norm(forSearch);
    if (!q) return fornecedores;
    return fornecedores.filter((f) => {
      const n = norm(f.nome);
      return n.includes(q) || isSubsequence(q, n);
    });
  }, [fornecedores, forSearch]);

  // ----- Exportações -----
  const vinculosText = (v: VinculoDoc[], sep = ' | '): string =>
    v.map((d) => `${VINCULO_LABEL[d.tipo]} #${d.codigo} — ${d.nome_cliente}${d.equipamento ? ` (${d.equipamento})` : ''} [${d.situacao}] ${d.qtd}×`).join(sep);

  const exportXLSX = () => {
    if (!filtered.length) return;
    const wb = XLSX.utils.book_new();

    const headers = [
      'Pedido', 'Fornecedor', 'Emissão', 'Situação', 'NF-e',
      'Valor Produtos (R$)', 'Frete (R$)', 'ICMS/Imposto (R$)', 'Valor Total (R$)',
      'Financeiro (parcelas)', 'Peça', 'Qtd', 'Vínculos (OS/Venda/Orçamento)',
    ];
    const rows: (string | number)[][] = [];
    for (const p of filtered) {
      const fin = p.financeiro
        .map((f) => `${fmtDate(f.data_vencimento)} ${f.nome_forma_pagamento} ${fmtCurrency(f.valor)}`)
        .join('\n');
      if (p.itens.length === 0) {
        rows.push([p.codigo, p.nome_fornecedor, fmtDate(p.data_emissao), p.nome_situacao, p.numero_nfe || '—',
          p.valor_produtos, p.valor_frete, p.icms, p.valor_total, fin, '', '', '']);
      } else {
        p.itens.forEach((item, i) => {
          rows.push([
            i === 0 ? p.codigo : '', i === 0 ? p.nome_fornecedor : '', i === 0 ? fmtDate(p.data_emissao) : '',
            i === 0 ? p.nome_situacao : '', i === 0 ? (p.numero_nfe || '—') : '',
            i === 0 ? p.valor_produtos : '', i === 0 ? p.valor_frete : '', i === 0 ? p.icms : '', i === 0 ? p.valor_total : '',
            i === 0 ? fin : '',
            item.nome_produto, item.quantidade, vinculosText(item.vinculos, ' || ') || '—',
          ]);
        });
      }
    }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
      { wch: 10 }, { wch: 38 }, { wch: 12 }, { wch: 22 }, { wch: 10 },
      { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 16 },
      { wch: 40 }, { wch: 42 }, { wch: 8 }, { wch: 60 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Pedidos');
    const slug = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `relatorio_pedidos_${slug}.xlsx`);
  };

  const exportPDF = () => {
    if (!filtered.length) return;
    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let html = `<html><head><meta charset="utf-8"><title>Relatório de Pedidos por Fornecedor</title><style>
      body{font-family:Arial,sans-serif;font-size:11px;margin:18px;color:#222}
      h1{font-size:16px;margin-bottom:2px}
      .meta{color:#666;font-size:10px;margin-bottom:12px}
      .summary{display:flex;gap:10px;margin-bottom:14px}
      .card{border:1px solid #ddd;border-radius:6px;padding:6px 12px;text-align:center}
      .card .val{font-size:15px;font-weight:700}
      .card .lab{font-size:9px;color:#888}
      .pedido{border:1px solid #ddd;border-radius:6px;margin-bottom:12px;padding:8px;page-break-inside:avoid}
      .ptitle{font-weight:700;font-size:12px;margin-bottom:4px}
      .pmeta{font-size:10px;color:#555;margin-bottom:6px}
      table{width:100%;border-collapse:collapse;margin-top:4px}
      th,td{border:1px solid #e2e2e2;padding:3px 5px;text-align:left;font-size:9.5px;vertical-align:top}
      th{background:#f5f5f5}
      .right{text-align:right}
      .vinc{font-size:9px;color:#444}
      .tag{display:inline-block;background:#eef;border-radius:3px;padding:0 4px;margin:1px 2px 1px 0}
      @media print{body{margin:8px}@page{size:landscape;margin:8mm}}
    </style></head><body>`;
    html += `<h1>Relatório de Pedidos por Fornecedor</h1>`;
    html += `<div class="meta">${new Date().toLocaleString('pt-BR')} · ${fornecedorLabel}${
      dataInicial || dataFinal ? ` · ${fmtDate(dataInicial)} a ${fmtDate(dataFinal)}` : ''
    }</div>`;
    html += `<div class="summary">
      <div class="card"><div class="val">${totals.count}</div><div class="lab">Pedidos</div></div>
      <div class="card"><div class="val">${fmtCurrency(totals.valor)}</div><div class="lab">Valor total</div></div>
      <div class="card"><div class="val">${fmtCurrency(totals.icms)}</div><div class="lab">ICMS/Imposto</div></div>
    </div>`;

    for (const p of filtered) {
      html += `<div class="pedido">`;
      html += `<div class="ptitle">Pedido #${escapeHtml(p.codigo)} — ${escapeHtml(p.nome_fornecedor)}</div>`;
      html += `<div class="pmeta">Emissão: ${fmtDate(p.data_emissao)} · Situação: ${escapeHtml(p.nome_situacao)} · NF-e: ${escapeHtml(p.numero_nfe || '—')} · Produtos: ${fmtCurrency(p.valor_produtos)} · Frete: ${fmtCurrency(p.valor_frete)} · ICMS: ${fmtCurrency(p.icms)} · <b>Total: ${fmtCurrency(p.valor_total)}</b></div>`;

      if (p.financeiro.length) {
        html += `<table><thead><tr><th>Vencimento</th><th>Forma</th><th>Plano de contas</th><th class="right">Valor</th></tr></thead><tbody>`;
        for (const f of p.financeiro) {
          html += `<tr><td>${fmtDate(f.data_vencimento)}</td><td>${escapeHtml(f.nome_forma_pagamento)}</td><td>${escapeHtml(f.nome_plano_conta)}</td><td class="right">${fmtCurrency(f.valor)}</td></tr>`;
        }
        html += `</tbody></table>`;
      }

      html += `<table><thead><tr><th>Peça</th><th class="right">Qtd</th><th>Vínculos não executados (OS / Venda / Orçamento)</th></tr></thead><tbody>`;
      for (const item of p.itens) {
        const vinc = item.vinculos.length
          ? item.vinculos.map((d) =>
              `<span class="tag">${VINCULO_LABEL[d.tipo]} #${escapeHtml(d.codigo)} — ${escapeHtml(d.nome_cliente)}${d.equipamento ? ` (${escapeHtml(d.equipamento)})` : ''} · ${escapeHtml(d.situacao)} · ${d.qtd}×</span>`,
            ).join(' ')
          : '—';
        html += `<tr><td>${escapeHtml(item.nome_produto)}</td><td class="right">${item.quantidade}</td><td class="vinc">${vinc}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }
    html += `</body></html>`;
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 500);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Truck className="h-6 w-6 text-primary" />
          Relatório de Pedidos por Fornecedor
        </h1>
        <p className="text-sm text-muted-foreground">
          Filtre os pedidos de compra por fornecedor, período e situação. O relatório inclui valor, ICMS,
          financeiro e os vínculos de OS, vendas e orçamentos ainda não executados que pedem cada peça.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Fornecedor */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Fornecedor</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between font-normal" disabled={!loaded}>
                    <span className="truncate text-left">{fornecedorLabel}</span>
                    <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[360px] p-0" align="start">
                  <div className="p-2 border-b">
                    <Input
                      placeholder="Buscar fornecedor…"
                      value={forSearch}
                      onChange={(e) => setForSearch(e.target.value)}
                      className="h-8"
                    />
                  </div>
                  <ScrollArea className="max-h-[320px]">
                    <div className="p-1">
                      <button
                        className={cn('w-full text-left px-2 py-1.5 rounded hover:bg-accent text-sm', !fornecedor && 'bg-accent')}
                        onClick={() => setFornecedor('')}
                      >
                        Todos os fornecedores
                      </button>
                      {filteredForList.map((f) => (
                        <button
                          key={f.id}
                          className={cn('w-full text-left px-2 py-1.5 rounded hover:bg-accent text-sm', fornecedor === f.id && 'bg-accent')}
                          onClick={() => setFornecedor(f.id)}
                        >
                          {f.nome}
                        </button>
                      ))}
                      {filteredForList.length === 0 && (
                        <div className="p-3 text-sm text-muted-foreground">Nenhum fornecedor</div>
                      )}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            </div>

            {/* Data inicial */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Data inicial (emissão)</label>
              <Input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} />
            </div>
            {/* Data final */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Data final (emissão)</label>
              <Input type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} />
            </div>

            {/* Situação */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Situação (vazio = todas)</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between font-normal">
                    <span className="truncate text-left">
                      {selectedSit.length === 0
                        ? 'Todas as situações'
                        : selectedSit.length === 1
                          ? statuses.find((s) => s.id === selectedSit[0])?.nome
                          : `${selectedSit.length} selecionadas`}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[360px] p-0" align="start">
                  <ScrollArea className="max-h-[320px]">
                    <div className="p-2">
                      {statuses.map((s) => (
                        <label key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm">
                          <Checkbox checked={selectedSit.includes(s.id)} onCheckedChange={() => toggleSit(s.id)} />
                          <span className="flex-1">{s.nome}</span>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                  {selectedSit.length > 0 && (
                    <div className="border-t p-2">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedSit([])}>Limpar</Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => handleScan(false)} disabled={loading}>
              {loading ? (<><Loader2 className="h-4 w-4 animate-spin" /> Sincronizando…</>) : (<><RefreshCw className="h-4 w-4" /> {loaded ? 'Sincronizar (novos/alterados)' : 'Buscar pedidos'}</>)}
            </Button>
            {loaded && (
              <Button variant="outline" onClick={() => handleScan(true)} disabled={loading} className="gap-1.5">
                <RefreshCw className="h-4 w-4" /> Sincronização completa
              </Button>
            )}
            {loaded && (
              <>
                <Button variant="outline" onClick={exportXLSX} disabled={!filtered.length} className="gap-1.5">
                  <FileSpreadsheet className="h-4 w-4" /> Excel
                </Button>
                <Button variant="outline" onClick={exportPDF} disabled={!filtered.length} className="gap-1.5">
                  <FileDown className="h-4 w-4" /> PDF
                </Button>
              </>
            )}
          </div>

          {loading && progress && (
            <div className="text-sm text-muted-foreground italic">{progress}</div>
          )}
        </CardContent>
      </Card>

      {loaded && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">{totals.count} pedido(s)</Badge>
          <Badge variant="secondary">Total: {fmtCurrency(totals.valor)}</Badge>
          <Badge variant="secondary">ICMS/Imposto: {fmtCurrency(totals.icms)}</Badge>
        </div>
      )}

      {loaded && filtered.length === 0 && (
        <div className="text-sm text-muted-foreground p-6 text-center border rounded-lg">
          Nenhum pedido encontrado com os filtros selecionados.
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((p) => {
          const isOpen = expanded.has(p.id);
          const totalVinc = p.itens.reduce((s, i) => s + i.vinculos.length, 0);
          return (
            <Card key={p.id}>
              <button
                className="w-full text-left p-4 flex items-start gap-3"
                onClick={() => toggleExpand(p.id)}
              >
                {isOpen ? <ChevronDown className="h-4 w-4 mt-1 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 mt-1 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">Pedido #{p.codigo}</span>
                    <Badge variant="outline">{p.nome_situacao}</Badge>
                    {p.numero_nfe && <Badge variant="secondary">NF-e {p.numero_nfe}</Badge>}
                    {totalVinc > 0 && (
                      <Badge className="gap-1 bg-primary/10 text-primary hover:bg-primary/20 border-primary/20">
                        <Link2 className="h-3 w-3" /> {totalVinc} vínculo(s)
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground truncate">{p.nome_fornecedor}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Emissão {fmtDate(p.data_emissao)} · ICMS {fmtCurrency(p.icms)}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-bold">{fmtCurrency(p.valor_total)}</div>
                  <div className="text-xs text-muted-foreground">Produtos {fmtCurrency(p.valor_produtos)}</div>
                </div>
              </button>

              {isOpen && (
                <CardContent className="pt-0 space-y-4">
                  {/* Financeiro */}
                  <div>
                    <div className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" /> Financeiro
                    </div>
                    {p.financeiro.length === 0 ? (
                      <div className="text-sm text-muted-foreground">Sem parcelas registradas.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-muted-foreground border-b">
                              <th className="py-1 pr-3">Vencimento</th>
                              <th className="py-1 pr-3">Forma</th>
                              <th className="py-1 pr-3">Plano de contas</th>
                              <th className="py-1 text-right">Valor</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.financeiro.map((f, i) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="py-1 pr-3">{fmtDate(f.data_vencimento)}</td>
                                <td className="py-1 pr-3">{f.nome_forma_pagamento || '—'}</td>
                                <td className="py-1 pr-3 text-muted-foreground">{f.nome_plano_conta || '—'}</td>
                                <td className="py-1 text-right font-medium">{fmtCurrency(f.valor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Peças + vínculos */}
                  <div>
                    <div className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">
                      Peças e vínculos
                    </div>
                    <div className="space-y-2">
                      {p.itens.map((item, i) => (
                        <div key={i} className="border rounded-md p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{item.nome_produto}</span>
                            <span className="text-xs text-muted-foreground flex-shrink-0">Qtd {item.quantidade}</span>
                          </div>
                          {item.vinculos.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {item.vinculos.map((d, j) => (
                                <Badge key={j} variant="outline" className="text-[11px] font-normal">
                                  {VINCULO_LABEL[d.tipo]} #{d.codigo} — {d.nome_cliente}
                                  {d.equipamento ? ` (${d.equipamento})` : ''} · {d.situacao} · {d.qtd}×
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground mt-1">Sem OS/venda/orçamento pendente para esta peça.</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
