import { useState } from 'react';
import { Loader2, Printer, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import ProductSearchInput, { ProductResult } from '@/components/controle/ProductSearchInput';
import { enrichOrderProducts } from '@/api/gestaoclick';
import type { GCProdutoItem } from '@/api/types';
import { buildEtiquetasPdf, EtiquetaItem } from '@/lib/etiquetaPdf';

/**
 * Busca de peça e montagem da lista de etiquetas a imprimir.
 *
 * Fica separado da tela que o hospeda porque vive em dois lugares: a página
 * /etiquetas, para etiquetar lote grande, e o diálogo do Explorador de Peças,
 * para uma ou duas no meio de outra tarefa. A regra é uma só; muda o entorno.
 *
 * A localização não vem do índice de produtos — ela mora nos atributos do
 * produto no GC — então os itens só são enriquecidos na hora de imprimir, em
 * uma tacada só, para não estourar o limite de 3 req/s da API a cada peça
 * selecionada.
 */

interface Selecionado {
  produtoId: string;
  nome: string;
  codigoInterno: string;
  codigoBarra: string;
  quantidade: number;
}

interface Props {
  /** Altura máxima da lista. A página deixa crescer; o diálogo limita. */
  alturaLista?: string;
  /** Chamado após gerar o PDF — o diálogo usa para se fechar. */
  aoImprimir?: () => void;
}

export default function SeletorEtiquetas({ alturaLista = 'max-h-[28rem]', aoImprimir }: Props) {
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
      // que a pessoa quer dizer ao bipar a mesma peça duas vezes.
      const existente = atuais.find((i) => i.produtoId === p.produto_id);
      if (existente) {
        toast.info(`${p.nome}: ${existente.quantidade + 1} etiquetas`);
        return atuais.map((i) =>
          i.produtoId === p.produto_id ? { ...i, quantidade: i.quantidade + 1 } : i,
        );
      }
      return [
        ...atuais,
        { produtoId: p.produto_id, nome: p.nome, codigoInterno, codigoBarra, quantidade: 1 },
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
      const enriquecidos = await enrichOrderProducts(
        itens.map((i) => ({
          produto: {
            produto_id: i.produtoId,
            // O índice de busca não traz variação; etiqueta é do produto pai.
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

      buildEtiquetasPdf(etiquetas).save(`etiquetas-${totalEtiquetas}.pdf`);
      toast.success(`${totalEtiquetas} etiqueta(s) geradas.`);
      aoImprimir?.();
    } catch (e) {
      toast.error(`Falha ao gerar etiquetas: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="space-y-4">
      <ProductSearchInput
        onSelect={adicionar}
        placeholder="Código, código de barras ou nome da peça"
        autoFocus
      />

      {itens.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma peça escolhida ainda. Busque acima — cada peça escolhida fica nesta lista.
        </p>
      ) : (
        <div className={`${alturaLista} space-y-2 overflow-y-auto pr-1`}>
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

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
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
      </div>
    </div>
  );
}
