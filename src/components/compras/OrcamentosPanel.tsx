import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStatusOrcamentos, getStatusCompras, listOrcamentos, buildListaCompras } from '@/api/compras';
import { useComprasStore } from '@/store/comprasStore';
import { GCOrcamento } from '@/api/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { FileText, RefreshCw, ShoppingCart, Loader2, Package } from 'lucide-react';
import { toast } from 'sonner';

export default function OrcamentosPanel() {
  const { config, setConfig, isScanning, setScanning, setProgress, setResult, progress } = useComprasStore();
  const [selectedSituacoes, setSelectedSituacoes] = useState<string[]>(config.situacoesOrcamentoSelecionadas ?? []);
  const [selectedCompra, setSelectedCompra] = useState<string[]>(config.situacoesCompraEmAndamento ?? []);
  const [orcamentos, setOrcamentos] = useState<GCOrcamento[]>([]);
  const [loadingOrc, setLoadingOrc] = useState(false);

  const statusQuery = useQuery({
    queryKey: ['status-orcamentos'],
    queryFn: getStatusOrcamentos,
  });

  const statusCompraQuery = useQuery({
    queryKey: ['status-compras'],
    queryFn: getStatusCompras,
  });

  // Auto-select purchase order statuses that don't move stock (tipo_lancamento "0")
  useEffect(() => {
    if (statusCompraQuery.data && (config.situacoesCompraEmAndamento ?? []).length === 0) {
      const autoSelect = statusCompraQuery.data
        .filter(s => s.tipo_lancamento === '0')
        .map(s => s.id);
      if (autoSelect.length > 0) {
        setSelectedCompra(autoSelect);
        setConfig({ situacoesCompraEmAndamento: autoSelect });
      }
    }
  }, [statusCompraQuery.data]);

  const toggleSituacao = (id: string) => {
    setSelectedSituacoes(prev => {
      const next = prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id];
      setConfig({ situacoesOrcamentoSelecionadas: next });
      return next;
    });
  };

  const toggleCompra = (id: string) => {
    setSelectedCompra(prev => {
      const next = prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id];
      setConfig({ situacoesCompraEmAndamento: next });
      return next;
    });
  };

  useEffect(() => {
    if (selectedSituacoes.length === 0) { setOrcamentos([]); return; }
    let cancelled = false;
    setLoadingOrc(true);
    Promise.all(selectedSituacoes.map(sid => listOrcamentos(sid)))
      .then(results => {
        if (cancelled) return;
        const all = results.flatMap(r => r.data);
        setOrcamentos([...new Map(all.map(o => [o.id, o])).values()]);
      })
      .catch(() => { if (!cancelled) toast.error('Erro ao carregar orçamentos'); })
      .finally(() => { if (!cancelled) setLoadingOrc(false); });
    return () => { cancelled = true; };
  }, [selectedSituacoes]);

  const handleGenerate = async () => {
    if (selectedSituacoes.length === 0) return;
    setScanning(true);
    setProgress({ step: 'Iniciando…', checked: 0, total: 0 });
    try {
      const result = await buildListaCompras(
        selectedSituacoes,
        selectedCompra,
        (step, checked, total) => setProgress({ step, checked, total }),
      );
      setResult(result);
      const parts = [`${result.totalProdutosSemEstoque} itens para comprar`];
      if (result.totalItensCobertosporPedido > 0) parts.push(`${result.totalItensCobertosporPedido} cobertos por pedido`);
      parts.push(`${result.totalProdutosOk} com estoque`);
      toast.success(`Lista gerada! ${parts.join(', ')}.`);
    } catch (err) {
      toast.error('Erro ao gerar lista de compras');
      console.error(err);
    } finally {
      setScanning(false);
    }
  };

  const formatDate = (d: string) => {
    try { const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; } catch { return d; }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 bg-card z-10 p-3 space-y-3 border-b border-border">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-bold text-foreground">Orçamentos</h2>
        </div>
        <p className="text-xs text-muted-foreground">Selecione as situações aprovadas</p>

        {statusQuery.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(statusQuery.data || []).map(s => (
              <label key={s.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <Checkbox
                  checked={selectedSituacoes.includes(s.id)}
                  onCheckedChange={() => toggleSituacao(s.id)}
                  disabled={isScanning}
                />
                {s.nome}
              </label>
            ))}
          </div>
        )}

        <Separator />

        {/* Purchase order cross-reference */}
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-amber-600" />
          <h3 className="text-xs font-bold text-foreground">Pedidos de Compra — Cruzamento</h3>
        </div>
        <p className="text-[11px] text-muted-foreground leading-tight">
          Situações que indicam que a peça já está sendo comprada. Itens cobertos não entrarão na lista.
        </p>

        {statusCompraQuery.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(statusCompraQuery.data || []).map(s => (
              <label key={s.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <Checkbox
                  checked={selectedCompra.includes(s.id)}
                  onCheckedChange={() => toggleCompra(s.id)}
                  disabled={isScanning}
                />
                <span>{s.nome}</span>
                {s.tipo_lancamento === '0' && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground">Não lança est.</Badge>
                )}
              </label>
            ))}
          </div>
        )}

        <Separator />

        <Button
          variant="outline" size="sm" className="w-full text-xs gap-1.5"
          onClick={() => {
            statusQuery.refetch();
            statusCompraQuery.refetch();
            if (selectedSituacoes.length > 0) {
              setLoadingOrc(true);
              Promise.all(selectedSituacoes.map(sid => listOrcamentos(sid)))
                .then(results => {
                  const all = results.flatMap(r => r.data);
                  setOrcamentos([...new Map(all.map(o => [o.id, o])).values()]);
                })
                .finally(() => setLoadingOrc(false));
            }
          }}
          disabled={loadingOrc || isScanning}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingOrc ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* Orcamentos list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {selectedSituacoes.length === 0 && (
          <p className="text-center text-xs text-muted-foreground py-6">Selecione ao menos uma situação acima</p>
        )}
        {loadingOrc && (
          <div className="text-center text-muted-foreground py-6 text-xs">
            <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" /> Carregando…
          </div>
        )}
        {!loadingOrc && selectedSituacoes.length > 0 && orcamentos.length === 0 && (
          <p className="text-center text-xs text-muted-foreground py-6">Nenhum orçamento encontrado</p>
        )}
        {orcamentos.map(orc => (
          <Card key={orc.id} className="p-3 border-l-4 border-l-green-500">
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-green-700 text-primary-foreground text-[10px] px-1.5">ORC</Badge>
              <span className="font-semibold text-sm">#{orc.codigo}</span>
            </div>
            <p className="text-sm font-medium text-foreground truncate">{orc.nome_cliente}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <span>{formatDate(orc.data)}</span>
              <span>·</span>
              <span className="font-medium text-foreground">R$ {orc.valor_total}</span>
              <span>·</span>
              <span>{orc.produtos?.length || 0} itens</span>
            </div>
          </Card>
        ))}
      </div>

      {/* Bottom action */}
      <div className="sticky bottom-0 bg-card border-t border-border p-3 space-y-2">
        {isScanning && (
          <div className="space-y-1">
            <Progress value={progress.total > 0 ? (progress.checked / progress.total) * 100 : 0} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              {progress.step} {progress.total > 0 ? `${progress.checked}/${progress.total}` : ''}
            </p>
          </div>
        )}
        <Button className="w-full gap-2" size="lg" onClick={handleGenerate}
          disabled={selectedSituacoes.length === 0 || isScanning}>
          {isScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
          🛒 Gerar Lista de Compras
        </Button>
        {orcamentos.length > 0 && (
          <p className="text-xs text-center text-muted-foreground">{orcamentos.length} orçamento(s) selecionado(s)</p>
        )}
      </div>
    </div>
  );
}
