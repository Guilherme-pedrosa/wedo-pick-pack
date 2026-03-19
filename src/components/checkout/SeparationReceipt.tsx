import { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Printer, X } from 'lucide-react';
import { PickingItem } from '@/api/types';

interface Props {
  open: boolean;
  onClose: () => void;
  orderType: 'os' | 'venda';
  orderCode: string;
  clientName: string;
  operatorName: string;
  items: PickingItem[];
  startedAt: string;
  concludedAt: string;
  observations?: string;
}

export default function SeparationReceipt({
  open,
  onClose,
  orderType,
  orderCode,
  clientName,
  operatorName,
  items,
  startedAt,
  concludedAt,
  observations,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const confirmedItems = items.filter(i => i.conferido);
  const unconfirmedItems = items.filter(i => !i.conferido);

  const startDate = new Date(startedAt);
  const endDate = new Date(concludedAt);
  const diffMs = endDate.getTime() - startDate.getTime();
  const mins = Math.floor(diffMs / 60000);
  const secs = Math.floor((diffMs % 60000) / 1000);
  const duration = `${mins}min ${secs}s`;

  const formatDateTime = (d: Date) =>
    d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Termo de Separação - ${orderType === 'os' ? 'OS' : 'Venda'} #${orderCode}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; color: #111; }
            .header { text-align: center; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
            .header img { max-height: 48px; margin-bottom: 8px; }
            .header h1 { font-size: 16px; margin-bottom: 4px; }
            .header p { font-size: 11px; color: #555; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin-bottom: 16px; font-size: 12px; }
            .info-grid .label { font-weight: bold; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
            th { background: #f3f3f3; text-align: left; padding: 6px 8px; border: 1px solid #ccc; font-size: 11px; }
            td { padding: 5px 8px; border: 1px solid #ccc; font-size: 11px; }
            tr:nth-child(even) { background: #fafafa; }
            .unconfirmed { background: #fff3cd !important; }
            .disclaimer { margin-top: 20px; padding: 12px; border: 2px solid #111; font-size: 11px; line-height: 1.5; }
            .disclaimer h3 { font-size: 12px; margin-bottom: 6px; text-transform: uppercase; }
            .signature { margin-top: 40px; display: flex; justify-content: space-between; }
            .signature div { text-align: center; width: 45%; }
            .signature .line { border-top: 1px solid #111; margin-top: 40px; padding-top: 4px; font-size: 11px; }
            @media print { body { padding: 10px; } }
          </style>
        </head>
        <body>
          ${content.innerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Termo de Conferência e Responsabilidade
          </DialogTitle>
        </DialogHeader>

        <div ref={printRef}>
          <div className="header" style={{ textAlign: 'center', borderBottom: '2px solid', paddingBottom: 12, marginBottom: 16 }}>
            <img src="/images/logo-wedo-2.jpeg" alt="Logo" style={{ maxHeight: 48, marginBottom: 8 }} />
            <h1 style={{ fontSize: 16, fontWeight: 'bold' }}>TERMO DE CONFERÊNCIA E RESPONSABILIDADE</h1>
            <p style={{ fontSize: 11, color: '#666' }}>Separação de Materiais</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', marginBottom: 16, fontSize: 12 }}>
            <div><strong>Tipo:</strong> {orderType === 'os' ? 'Ordem de Serviço' : 'Venda'}</div>
            <div><strong>Código:</strong> #{orderCode}</div>
            <div><strong>Cliente:</strong> {clientName}</div>
            <div><strong>Operador:</strong> {operatorName}</div>
            <div><strong>Início:</strong> {formatDateTime(startDate)}</div>
            <div><strong>Conclusão:</strong> {formatDateTime(endDate)}</div>
            <div><strong>Duração:</strong> {duration}</div>
            <div><strong>Total de Itens:</strong> {items.length}</div>
          </div>

          <h3 style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>Itens Conferidos ({confirmedItems.length})</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#f3f3f3' }}>
                <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'left' }}>#</th>
                <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'left' }}>Código</th>
                <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'left' }}>Produto</th>
                <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'center' }}>Qtd Esperada</th>
                <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'center' }}>Qtd Conferida</th>
              </tr>
            </thead>
            <tbody>
              {confirmedItems.map((item, idx) => (
                <tr key={item.id} style={idx % 2 === 1 ? { background: '#fafafa' } : {}}>
                  <td style={{ padding: '5px 8px', border: '1px solid #ccc' }}>{idx + 1}</td>
                  <td style={{ padding: '5px 8px', border: '1px solid #ccc', fontFamily: 'monospace' }}>{item.codigo_produto}</td>
                  <td style={{ padding: '5px 8px', border: '1px solid #ccc' }}>{item.nome_produto}</td>
                  <td style={{ padding: '5px 8px', border: '1px solid #ccc', textAlign: 'center' }}>{item.qtd_total}</td>
                  <td style={{ padding: '5px 8px', border: '1px solid #ccc', textAlign: 'center' }}>{item.qtd_conferida}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {unconfirmedItems.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8, color: '#b45309' }}>
                ⚠️ Itens NÃO Conferidos ({unconfirmedItems.length})
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: 11 }}>
                <thead>
                  <tr style={{ background: '#fff3cd' }}>
                    <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'left' }}>#</th>
                    <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'left' }}>Código</th>
                    <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'left' }}>Produto</th>
                    <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'center' }}>Qtd Esperada</th>
                    <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'center' }}>Qtd Conferida</th>
                  </tr>
                </thead>
                <tbody>
                  {unconfirmedItems.map((item, idx) => (
                    <tr key={item.id} style={{ background: '#fff8e1' }}>
                      <td style={{ padding: '5px 8px', border: '1px solid #ccc' }}>{idx + 1}</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #ccc', fontFamily: 'monospace' }}>{item.codigo_produto}</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #ccc' }}>{item.nome_produto}</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #ccc', textAlign: 'center' }}>{item.qtd_total}</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #ccc', textAlign: 'center' }}>{item.qtd_conferida}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {observations && (
            <div style={{ marginTop: 16, padding: 10, background: '#f9f9f9', border: '1px solid #ccc', fontSize: 11, lineHeight: 1.5 }}>
              <strong>Observações:</strong> {observations}
            </div>
          )}

          <div style={{ marginTop: 20, padding: 12, border: '2px solid #111', fontSize: 11, lineHeight: 1.6 }}>
            <h3 style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 6, textTransform: 'uppercase' }}>
              Termo de Responsabilidade
            </h3>
            <p>
              Eu, <strong>{operatorName}</strong>, declaro que realizei a conferência de todos os itens
              acima listados referentes à {orderType === 'os' ? 'Ordem de Serviço' : 'Venda'} <strong>#{orderCode}</strong> do
              cliente <strong>{clientName}</strong>.
            </p>
            <p style={{ marginTop: 6 }}>
              Confirmo que verifiquei cada item por código e descrição, conferindo as quantidades indicadas.
              Qualquer divergência, falta ou erro na separação dos materiais acima descritos será de
              <strong> minha total responsabilidade</strong>, incluindo eventuais prejuízos financeiros
              decorrentes de itens faltantes, excedentes ou incorretamente separados.
            </p>
            <p style={{ marginTop: 6 }}>
              Data e hora da conferência: <strong>{formatDateTime(endDate)}</strong> | Duração: <strong>{duration}</strong>
            </p>
          </div>

          <div style={{ marginTop: 40, display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ textAlign: 'center', width: '45%' }}>
              <div style={{ borderTop: '1px solid #111', marginTop: 40, paddingTop: 4, fontSize: 11 }}>
                {operatorName}<br />Operador Responsável
              </div>
            </div>
            <div style={{ textAlign: 'center', width: '45%' }}>
              <div style={{ borderTop: '1px solid #111', marginTop: 40, paddingTop: 4, fontSize: 11 }}>
                Supervisor / Responsável
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            <X className="h-4 w-4 mr-1.5" />
            Fechar
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1.5" />
            Imprimir Termo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
