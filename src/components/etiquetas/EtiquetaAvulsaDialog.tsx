import { useState } from 'react';
import { Loader2, Printer, Trash2, Tag } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import ProductSearchInput, { ProductResult } from '@/components/controle/ProductSearchInput';
import { enrichOrderProducts } from '@/api/gestaoclick';
import type { GCProdutoItem } from '@/api/types';
import { buildEtiquetasPdf, EtiquetaItem } from '@/lib/etiquetaPdf';

/**
 * Impressão avulsa de etiquetas, sem depender de um pedido de compra.
 *
 * O fluxo de etiquetas existente só nasce do Acompanhamento de Pedidos, o que
 * não ajuda quando a peça já está na prateleira sem etiqueta. Aqui a busca é
 * a mesma do Checkout (índice de produtos, por código ou nome), o item
 * escolhido fica fixo numa lista e dá para ir juntando quantos quiser antes de
 * gerar o PDF.
 *
 * A localização não vem do índice — ela mora nos atributos do produto no GC —
 * então os itens só são enriquecidos na hora de imprimir, em uma tacada só,
 * para não bater na API a cada peça selecionada.
 */

interface Selecionado {
  produtoId: string;
  nome: string;
  codigoInterno: string;
  codigoBarra: string;
  quantidade: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function EtiquetaAvulsaDialog({ open, onOpenChange }: Props) {
  const [itens, setItens] = useState<Selecionado[]>([]);
  const [gerando, setGerando] = useState(false);

  const adicionar = (p: ProductResult) => {
    const codigoInterno = (p.codigo_interno ?? '').trim();
    const codigoBarra = (p.codigo_barra ?? '').trim();

    if (!codigoInterno && !codigoBarra) {
      toast.error(`${p.nome} não tem código no cadastro — sem código não há etiqueta.`);
      return;
    }

    setItens((atuais) => {
      // Selecionar de novo soma uma etiqueta em vez de duplicar a linha: é o
      // que a pessoa quer dizer ao escanear a mesma peça duas vezes.
      const existente = atuais.find((i) => i.produtoId === p.produto_id);
      if (existente) {
        toast.info(`${p.nome}: ${existente.quantidade + 1} etiquetas`);
        return atuais.map((i) =>
          i.produtoId === p.produto_id ? { ...i, quantidade: i.quantidade + 1 } : i,
        );
      }
      return [
        ...atuais,
        {
          produtoId: p.produto_id,
          nome: p.nome,
          codigoInterno,
          codigoBarra,
          quantidade: 1,
        },
      ];
    });
  };

  const alterarQuantidade = (produtoId: string, valor: string) => {
    const n = Number.parseInt(valor, 10);
    setItens((atuais) =>
      atuais.map((i) =>
        i.produtoId === produtoId
          ? { ...i, quantidade: Number.isFinite(n) && n > 0 ? Math.min(n, 99) : 1 }
          : i,
      ),
    );
  };

  const remover = (produtoId: string) =>
    setItens((atuais) => atuais.filter((i) => i.produtoId !== produtoId));

  const totalEtiquetas = itens.reduce((soma, i) => soma + i.quantidade, 0);

  const imprimir = async () => {
    if (!itens.length) return;
    setGerando(true);
    try {
      // O endereço do estoque está nos atributos do produto no GC, não no
      // índice de busca. Uma chamada só, com a lista fechada.
      const enriquecidos = await enrichOrderProducts(
        itens.map((i) => ({
          produto: {
            produto_id: i.produtoId,
            // O indice de busca nao traz variacao; etiqueta e sempre do produto pai.
            variacao_id: '',
            nome_produto: i.nome,
            codigo_produto: i.codigoInterno,
            codigo_barras: i.codigoBarra,
            sigla_unidade: 'UN',
            quantidade: i.quantidade,
          } satisfies GCProdutoItem,
        })),
      );

      const etiquetas: EtiquetaItem[] = enriquecidos.map(({ produto }, idx) => {
        const item = itens[idx];
        const codigo = (produto.codigo_produto || item.codigoInterno || '').trim();
        const barcodeValue = (produto.codigo_barras || item.codigoBarra || '').trim() || codigo;
        return {
          nome: produto.nome_produto || item.nome,
          codigo: codigo || barcodeValue,
          barcodeValue,
          localizacao: produto.localizacao_fisica,
          localizacaoRational: produto.localizacao_rational,
          copies: item.quantidade,
        };
      });

      const semEndereco = etiquetas.filter(
        (e) => !e.localizacao?.trim() && !e.localizacaoRational?.trim(),
      );
      if (semEndereco.length) {
        toast.warning(
          `Sem endereço no cadastro (etiqueta sai sem o LOCAL): ${semEndereco
            .map((e) => e.codigo)
            .join(', ')}`,
          { duration: 8000 },
        );
      }

      const doc = buildEtiquetasPdf(etiquetas);
      doc.save(`etiquetas-${totalEtiquetas}.pdf`);
      toast.success(`${totalEtiquetas} etiqueta(s) geradas.`);
    } catch (e) {
      toast.error(`Falha ao gerar etiquetas: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGerando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" /> Imprimir etiquetas
          </DialogTitle>
          <DialogDescription>
            Busque pelo código ou pelo nome. Cada peça escolhida fica na lista abaixo — pode
            continuar buscando e juntando quantas quiser antes de gerar o PDF.
          </DialogDescription>
        </DialogHeader>

        <ProductSearchInput
          onSelect={adicionar}
          placeholder="Código, código de barras ou nome da peça"
          autoFocus
        />

        {itens.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma peça escolhida ainda.
          </p>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {itens.map((item) => (
              <div
                key={item.produtoId}
                className="flex items-center gap-3 rounded-lg border border-border p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.nome}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {item.codigoInterno && <Badge variant="secondary">{item.codigoInterno}</Badge>}
                    {item.codigoBarra && <span>EAN {item.codigoBarra}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-muted-foreground" htmlFor={`qtd-${item.produtoId}`}>
                    Qtd
                  </label>
                  <Input
                    id={`qtd-${item.produtoId}`}
                    type="number"
                    min={1}
                    max={99}
                    value={item.quantidade}
                    onChange={(e) => alterarQuantidade(item.produtoId, e.target.value)}
                    className="h-8 w-16 text-center"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => remover(item.produtoId)}
                  aria-label={`Remover ${item.nome}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {itens.length} peça(s) · {totalEtiquetas} etiqueta(s)
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setItens([])} disabled={!itens.length}>
              Limpar
            </Button>
            <Button onClick={imprimir} disabled={!itens.length || gerando} className="gap-2">
              {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              Imprimir {totalEtiquetas || ''}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
