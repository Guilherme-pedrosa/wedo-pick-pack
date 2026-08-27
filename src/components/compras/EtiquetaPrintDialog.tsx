import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { enrichOrderProducts } from '@/api/gestaoclick';
import { GCProdutoItem } from '@/api/types';
import { buildEtiquetasPdf, EtiquetaItem } from '@/lib/etiquetaPdf';

export interface EtiquetaDialogItem {
  produto_id: string;
  variacao_id: string;
  nome_produto: string;
  quantidade: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Código do pedido de compra (usado no nome do arquivo). */
  orderCode: string;
  /** Itens pré-selecionados (pedido inteiro ou um item só). */
  items: EtiquetaDialogItem[];
}

/**
 * Seleção de quantidade de etiquetas por peça e geração do PDF.
 * Cada etiqueta sai numa página própria, todas no mesmo arquivo.
 * O código e a localização física são buscados no cadastro do produto no GC.
 */
export default function EtiquetaPrintDialog({ open, onClose, orderCode, items }: Props) {
  const [copies, setCopies] = useState<number[]>([]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (open) setCopies(items.map(it => Math.max(1, Math.round(it.quantidade) || 1)));
  }, [open, items]);

  const setCopy = (index: number, raw: string) => {
    const value = Math.max(0, Math.floor(Number(raw) || 0));
    setCopies(prev => prev.map((c, i) => (i === index ? value : c)));
  };

  const totalEtiquetas = copies.reduce((sum, c) => sum + c, 0);

  const handleGenerate = async () => {
    const selected = items
      .map((item, i) => ({ item, copies: copies[i] || 0 }))
      .filter(entry => entry.copies > 0);
    if (!selected.length) {
      toast.warning('Informe ao menos uma etiqueta.');
      return;
    }
    setGenerating(true);
    try {
      // Busca código interno, código de barras e localização física no cadastro
      // do produto (mesmo enriquecimento usado pelo Checkout).
      const enriched = await enrichOrderProducts(selected.map(({ item }) => ({
        produto: {
          produto_id: item.produto_id,
          variacao_id: item.variacao_id,
          nome_produto: item.nome_produto,
          codigo_produto: '',
          codigo_barras: '',
          sigla_unidade: 'UN',
          quantidade: item.quantidade,
        } satisfies GCProdutoItem,
      })));

      const etiquetas: EtiquetaItem[] = [];
      const semCodigo: string[] = [];
      enriched.forEach(({ produto }, i) => {
        const codigo = (produto.codigo_produto || '').trim();
        const barcodeValue = (produto.codigo_barras || '').trim() || codigo;
        if (!barcodeValue) {
          semCodigo.push(produto.nome_produto);
          return;
        }
        etiquetas.push({
          nome: produto.nome_produto,
          codigo: codigo || barcodeValue,
          barcodeValue,
          localizacao: produto.localizacao_fisica,
          copies: selected[i].copies,
        });
      });

      if (semCodigo.length) {
        toast.warning(`Sem código no cadastro (etiqueta não gerada): ${semCodigo.join(', ')}`, { duration: 8000 });
      }
      if (!etiquetas.length) {
        toast.error('Nenhuma peça com código para gerar etiquetas.');
        return;
      }

      const doc = buildEtiquetasPdf(etiquetas);
      doc.save(`etiquetas-pedido-${orderCode || 'compra'}.pdf`);
      toast.success(`${etiquetas.reduce((sum, e) => sum + e.copies, 0)} etiqueta(s) gerada(s).`);
      onClose();
    } catch (error) {
      toast.error(`Erro ao gerar etiquetas: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => !generating && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            Etiquetas do pedido #{orderCode}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Cada etiqueta sai em uma página do mesmo PDF, com código da peça, código de barras
          (lido pelo GestãoClick) e localização física do estoque.
        </p>

        <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
          {items.map((item, i) => (
            <div key={`${item.produto_id}-${i}`} className="flex items-center gap-3 rounded-md border p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={item.nome_produto}>{item.nome_produto || '—'}</p>
                <p className="text-xs text-muted-foreground">Qtd no pedido: {item.quantidade}</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Etiquetas</label>
                <Input
                  type="number"
                  min={0}
                  value={copies[i] ?? 0}
                  onChange={e => setCopy(i, e.target.value)}
                  className="h-8 w-20 text-right"
                  disabled={generating}
                />
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="flex items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">{totalEtiquetas} etiqueta(s) no total</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={generating}>Cancelar</Button>
            <Button onClick={handleGenerate} disabled={generating || totalEtiquetas === 0}>
              {generating ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Buscando dados das peças…</>
              ) : (
                <><Printer className="mr-2 h-4 w-4" /> Gerar PDF</>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
