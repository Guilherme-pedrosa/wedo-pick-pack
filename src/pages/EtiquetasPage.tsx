import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tag } from 'lucide-react';
import SeletorEtiquetas from '@/components/etiquetas/SeletorEtiquetas';

/**
 * Tela de impressão de etiquetas.
 *
 * O botão dentro do Explorador de Peças continua valendo para uma ou duas
 * etiquetas no meio de outra tarefa. Esta página existe para o lote grande:
 * a lista cresce à vontade e o endereço fica no histórico do navegador.
 */
export default function EtiquetasPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
          <Tag className="h-7 w-7" /> Etiquetas
        </h1>
        <p className="text-sm text-muted-foreground">
          Imprima etiquetas de qualquer peça do estoque, sem precisar de um pedido de compra.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Peças a etiquetar</CardTitle>
          <CardDescription>
            Busque pelo código, pelo código de barras ou pelo nome. Cada peça escolhida fica na
            lista — continue buscando e juntando quantas quiser, ajuste a quantidade de cada uma e
            gere o PDF no fim. Bipar a mesma peça de novo soma uma etiqueta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SeletorEtiquetas alturaLista="max-h-[32rem]" />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        A etiqueta sai no formato da impressora (110 × 50 mm), uma por página, com o endereço do
        estoque no rodapé. Peça sem endereço no cadastro sai sem o <strong>LOCAL:</strong> e um
        aviso diz quais foram.
      </p>
    </div>
  );
}
