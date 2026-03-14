import { useRef } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface BoxItem {
  nome_produto: string;
  quantidade: number;
  preco_unitario: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  boxName: string;
  technicianName: string;
  technicianGcId: string;
  items: BoxItem[];
  date: string;
}

export default function BoxHandoffReceipt({
  open,
  onClose,
  boxName,
  technicianName,
  technicianGcId,
  items,
  date,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const totalValue = items.reduce(
    (sum, i) => sum + i.quantidade * (i.preco_unitario || 0),
    0
  );
  const totalItems = items.reduce((sum, i) => sum + i.quantidade, 0);

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const formatDate = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const logoUrl = window.location.origin + "/images/logo-wedo.jpeg";
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Recibo - ${boxName}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #1a1a1a; font-size: 12px; }
          .company-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 2px solid #333; }
          .company-header img { height: 50px; }
          .company-header .company-info { flex: 1; }
          .company-header .company-info h2 { font-size: 13px; font-weight: 700; margin-bottom: 2px; }
          .company-header .company-info p { font-size: 9px; color: #666; line-height: 1.4; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 12px; }
          .header h1 { font-size: 16px; font-weight: 700; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px; }
          .header p { font-size: 11px; color: #666; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; padding: 10px; background: #f5f5f5; border-radius: 4px; }
          .info-item label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; display: block; }
          .info-item span { font-size: 12px; font-weight: 600; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
          th { background: #333; color: white; padding: 6px 8px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
          th:last-child, th:nth-child(3) { text-align: right; }
          th:nth-child(2) { text-align: center; }
          td { padding: 5px 8px; border-bottom: 1px solid #e0e0e0; font-size: 11px; }
          td:nth-child(2) { text-align: center; }
          td:nth-child(3), td:last-child { text-align: right; }
          tr:nth-child(even) { background: #fafafa; }
          .totals { display: flex; justify-content: flex-end; gap: 24px; padding: 8px 0; border-top: 2px solid #333; margin-bottom: 20px; font-size: 12px; font-weight: 700; }
          .termo { border: 1px solid #ccc; border-radius: 4px; padding: 14px; margin-bottom: 16px; }
          .termo h3 { font-size: 12px; font-weight: 700; margin-bottom: 8px; text-transform: uppercase; text-align: center; letter-spacing: 1px; }
          .termo p { font-size: 10px; line-height: 1.6; color: #444; margin-bottom: 6px; }
          .footer { text-align: center; font-size: 9px; color: #999; margin-top: 20px; padding-top: 10px; border-top: 1px solid #ddd; }
          @media print { body { padding: 12px; } }
        </style>
      </head>
      <body>
        ${content.innerHTML}
      </body>
      </html>
    `);

    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Recibo de Saída
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div
            ref={printRef}
            className="bg-white text-black p-4 rounded border border-border text-xs"
          >
            {/* Company Header */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px", paddingBottom: "12px", borderBottom: "2px solid #333" }}>
              <img src="/images/logo-wedo.jpeg" alt="WeDo" style={{ height: "50px" }} />
              <div>
                <h2 style={{ fontSize: "13px", fontWeight: 700, marginBottom: "2px" }}>WD Comércio e Importação</h2>
                <p style={{ fontSize: "9px", color: "#666", lineHeight: 1.4, margin: 0 }}>CNPJ: 43.572.954/0001-81</p>
                <p style={{ fontSize: "9px", color: "#666", lineHeight: 1.4, margin: 0 }}>Rua PB48 Q 5 L 57 – Pq Brasília, Anápolis – GO</p>
              </div>
            </div>

            <div style={{ textAlign: "center", marginBottom: "16px" }}>
              <h1 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>
                Recibo de Saída de Materiais
              </h1>
              <p style={{ fontSize: "11px", color: "#666" }}>
                Documento gerado automaticamente pelo sistema WeDo
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "16px", padding: "10px", background: "#f5f5f5", borderRadius: "4px" }}>
              <div>
                <label style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px", display: "block" }}>Técnico</label>
                <span style={{ fontSize: "12px", fontWeight: 600 }}>{technicianName}</span>
              </div>
              <div>
                <label style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px", display: "block" }}>ID Funcionário</label>
                <span style={{ fontSize: "12px", fontWeight: 600 }}>{technicianGcId}</span>
              </div>
              <div>
                <label style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px", display: "block" }}>Caixa</label>
                <span style={{ fontSize: "12px", fontWeight: 600 }}>{boxName}</span>
              </div>
              <div>
                <label style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px", display: "block" }}>Data de Saída</label>
                <span style={{ fontSize: "12px", fontWeight: 600 }}>{formatDate(date)}</span>
              </div>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "16px" }}>
              <thead>
                <tr>
                  <th style={{ background: "#333", color: "white", padding: "6px 8px", textAlign: "left", fontSize: "10px", textTransform: "uppercase" }}>Produto</th>
                  <th style={{ background: "#333", color: "white", padding: "6px 8px", textAlign: "center", fontSize: "10px", textTransform: "uppercase" }}>Qtd</th>
                  <th style={{ background: "#333", color: "white", padding: "6px 8px", textAlign: "right", fontSize: "10px", textTransform: "uppercase" }}>Unit.</th>
                  <th style={{ background: "#333", color: "white", padding: "6px 8px", textAlign: "right", fontSize: "10px", textTransform: "uppercase" }}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} style={{ background: idx % 2 === 0 ? "white" : "#fafafa" }}>
                    <td style={{ padding: "5px 8px", borderBottom: "1px solid #e0e0e0", fontSize: "11px" }}>
                      {item.nome_produto}
                    </td>
                    <td style={{ padding: "5px 8px", borderBottom: "1px solid #e0e0e0", fontSize: "11px", textAlign: "center" }}>
                      {item.quantidade}
                    </td>
                    <td style={{ padding: "5px 8px", borderBottom: "1px solid #e0e0e0", fontSize: "11px", textAlign: "right" }}>
                      {item.preco_unitario ? formatCurrency(item.preco_unitario) : "—"}
                    </td>
                    <td style={{ padding: "5px 8px", borderBottom: "1px solid #e0e0e0", fontSize: "11px", textAlign: "right" }}>
                      {item.preco_unitario
                        ? formatCurrency(item.quantidade * item.preco_unitario)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "24px", padding: "8px 0", borderTop: "2px solid #333", marginBottom: "20px", fontSize: "12px", fontWeight: 700 }}>
              <span>Total de itens: {totalItems}</span>
              {totalValue > 0 && <span>Valor total: {formatCurrency(totalValue)}</span>}
            </div>

            <div style={{ border: "1px solid #ccc", borderRadius: "4px", padding: "14px", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "12px", fontWeight: 700, marginBottom: "8px", textTransform: "uppercase", textAlign: "center", letterSpacing: "1px" }}>
                Termo de Responsabilidade
              </h3>
              <p style={{ fontSize: "10px", lineHeight: 1.6, color: "#444", marginBottom: "6px" }}>
                Ao retirar esta caixa, o técnico assume total responsabilidade pelas peças e itens nela contidos.
              </p>
              <p style={{ fontSize: "10px", lineHeight: 1.6, color: "#444", marginBottom: "6px" }}>
                Em caso de perda, extravio, dano, desaparecimento ou uso/montagem sem autorização, deverá ressarcir integralmente o valor da peça constante neste recibo.
              </p>
              <p style={{ fontSize: "10px", lineHeight: 1.6, color: "#444", marginBottom: "6px" }}>
                Caso empreste, transfira ou permita o uso da caixa por outro técnico ou terceiro, sem autorização expressa da direção, continuará sendo o responsável por qualquer perda, dano, extravio, desaparecimento ou uso indevido.
              </p>
              <p style={{ fontSize: "10px", lineHeight: 1.6, color: "#444" }}>
                Não é necessária assinatura, pois o técnico foi verbalmente avisado e manteve uma cópia deste recibo.
              </p>
            </div>

            <div style={{ textAlign: "center", fontSize: "9px", color: "#999", marginTop: "20px", paddingTop: "10px", borderTop: "1px solid #ddd" }}>
              Documento gerado em {formatDate(new Date().toISOString())} · Sistema WeDo
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            Imprimir / PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
