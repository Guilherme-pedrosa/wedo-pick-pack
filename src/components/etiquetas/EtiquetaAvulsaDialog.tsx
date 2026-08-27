import { Tag } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import SeletorEtiquetas from '@/components/etiquetas/SeletorEtiquetas';

/**
 * O mesmo seletor da página /etiquetas, em janela.
 *
 * Serve para imprimir uma ou duas etiquetas sem sair da tela em que se está —
 * no Explorador de Peças, tipicamente. Para lote grande a página é melhor.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function EtiquetaAvulsaDialog({ open, onOpenChange }: Props) {
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

        <SeletorEtiquetas alturaLista="max-h-72" aoImprimir={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
