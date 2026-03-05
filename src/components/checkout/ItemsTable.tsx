import { PickingItem } from '@/api/types';
import { useCheckoutStore } from '@/store/checkoutStore';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  items: PickingItem[];
}

export default function ItemsTable({ items }: Props) {
  const confirmItem = useCheckoutStore(s => s.confirmItem);

  const pending = items.filter(i => !i.conferido).sort((a, b) => a.nome_produto.localeCompare(b.nome_produto));
  const confirmed = items.filter(i => i.conferido);
  const sorted = [...pending, ...confirmed];

  const formatTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wider">
            <th className="py-2 px-3">Produto</th>
            <th className="py-2 px-3">Localização</th>
            <th className="py-2 px-3 text-center">Conferidos</th>
            <th className="py-2 px-3 text-center">Total</th>
            <th className="py-2 px-3 text-center">Unid</th>
            <th className="py-2 px-3 text-center">Ação</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(item => (
            <tr
              key={item.id}
              className={`border-b border-border transition-colors ${
                item.conferido
                  ? 'bg-green-50'
                  : 'border-l-4 border-l-amber-400'
              }`}
            >
              <td className="py-2.5 px-3">
                <div className="flex items-center gap-2">
                  {item.conferido && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
                  <span className={item.conferido ? 'text-green-800' : 'font-medium'}>{item.nome_produto}</span>
                </div>
              </td>
              <td className="py-2.5 px-3 text-muted-foreground font-mono text-xs">{item.codigo_produto}</td>
              <td className="py-2.5 px-3 text-center font-medium">
                {item.conferido
                  ? `${item.qtd_total}/${item.qtd_total}`
                  : `${item.qtd_conferida}/${item.qtd_total}`}
              </td>
              <td className="py-2.5 px-3 text-center">{item.qtd_total}</td>
              <td className="py-2.5 px-3 text-center text-muted-foreground">{item.sigla_unidade}</td>
              <td className="py-2.5 px-3 text-center">
                {item.conferido ? (
                  <span className="text-green-600 text-xs">{formatTime(item.confirmed_at)}</span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => confirmItem(item.id, 1)}
                  >
                    Confirmar
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
