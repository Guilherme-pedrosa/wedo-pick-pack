import { useMemo, memo } from 'react';
import { PickingItem } from '@/api/types';
import { useCheckoutStore } from '@/store/checkoutStore';
import { CheckCircle2, Package, MapPin } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface Props {
  items: PickingItem[];
}

const fmtQtd = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(3).replace('.', ',');

const formatTime = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const ItemRow = memo(function ItemRow({ item, isMobile }: { item: PickingItem; isMobile: boolean }) {
  if (isMobile) {
    return (
      <div
        className={`rounded-lg border p-3 transition-colors ${
          item.conferido
            ? 'bg-green-50 border-green-200'
            : 'border-l-4 border-l-amber-400 border-border'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              {item.conferido ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              ) : (
                <Package className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className={`text-sm font-medium truncate ${item.conferido ? 'text-green-800' : ''}`}>
                {item.nome_produto}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground ml-5.5">
              {item.codigo_produto && <span className="font-mono">Cód: {item.codigo_produto}</span>}
              {item.codigo_barras && <span className="font-mono">EAN: {item.codigo_barras}</span>}
              <span>{item.sigla_unidade}</span>
            </div>
            {(item.localizacao_fisica || item.localizacao_rational) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs ml-5.5 mt-0.5">
                <MapPin className="h-3 w-3 text-primary shrink-0" />
                {item.localizacao_fisica && <span className="text-primary font-medium">{item.localizacao_fisica}</span>}
                {item.localizacao_rational && <span className="text-muted-foreground">Rational: {item.localizacao_rational}</span>}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-bold">
              {item.conferido
                ? `${fmtQtd(item.qtd_total)}/${fmtQtd(item.qtd_total)}`
                : `${fmtQtd(item.qtd_conferida)}/${fmtQtd(item.qtd_total)}`}
            </div>
            {item.conferido && <span className="text-green-600 text-xs">{formatTime(item.confirmed_at)}</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <tr
      className={`border-b border-border transition-colors ${
        item.conferido ? 'bg-green-50' : 'border-l-4 border-l-amber-400'
      }`}
    >
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2">
          {item.conferido && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
          <span className={item.conferido ? 'text-green-800' : 'font-medium'}>{item.nome_produto}</span>
        </div>
      </td>
      <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{item.codigo_produto || '—'}</td>
      <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{item.codigo_barras || '—'}</td>
      <td className="py-2.5 px-3 text-xs">
        {(item.localizacao_fisica || item.localizacao_rational) ? (
          <div className="flex items-start gap-1">
            <MapPin className="h-3 w-3 text-primary shrink-0 mt-0.5" />
            <div>
              {item.localizacao_fisica && <div className="text-primary font-medium">{item.localizacao_fisica}</div>}
              {item.localizacao_rational && <div className="text-muted-foreground">Rational: {item.localizacao_rational}</div>}
            </div>
          </div>
        ) : '—'}
      </td>
      <td className="py-2.5 px-3 text-center font-medium">
        {item.conferido
          ? `${fmtQtd(item.qtd_total)}/${fmtQtd(item.qtd_total)}`
          : `${fmtQtd(item.qtd_conferida)}/${fmtQtd(item.qtd_total)}`}
      </td>
      <td className="py-2.5 px-3 text-center">{fmtQtd(item.qtd_total)}</td>
      <td className="py-2.5 px-3 text-center text-muted-foreground">{item.sigla_unidade}</td>
      <td className="py-2.5 px-3 text-center">
        {item.conferido && <span className="text-green-600 text-xs">{formatTime(item.confirmed_at)}</span>}
      </td>
    </tr>
  );
});

function ItemsTable({ items }: Props) {
  const isMobile = useIsMobile();

  const sorted = useMemo(() => {
    const pending = items.filter(i => !i.conferido).sort((a, b) => a.nome_produto.localeCompare(b.nome_produto));
    const confirmed = items.filter(i => i.conferido);
    return [...pending, ...confirmed];
  }, [items]);

  if (isMobile) {
    return (
      <div className="space-y-2">
        {sorted.map(item => <ItemRow key={item.id} item={item} isMobile />)}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wider">
            <th className="py-2 px-3">Produto</th>
            <th className="py-2 px-3">Código</th>
            <th className="py-2 px-3">Cód. Barras</th>
            <th className="py-2 px-3">Localização</th>
            <th className="py-2 px-3 text-center">Conferidos</th>
            <th className="py-2 px-3 text-center">Total</th>
            <th className="py-2 px-3 text-center">Unid</th>
            <th className="py-2 px-3 text-center">Ação</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(item => <ItemRow key={item.id} item={item} isMobile={false} />)}
        </tbody>
      </table>
    </div>
  );
}

export default memo(ItemsTable);
