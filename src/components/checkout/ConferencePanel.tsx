import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCheckoutStore } from '@/store/checkoutStore';
import { matchItemByCode } from '@/lib/scanMatcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { PackageCheck, Scan, Clock, X, Printer, Camera } from 'lucide-react';
import { toast } from 'sonner';
import ItemsTable from './ItemsTable';
import ConclusionModal, { ReceiptData } from './ConclusionModal';
import SeparationReceipt from './SeparationReceipt';

// Lazy load the heavy barcode scanner (html5-qrcode)
const BarcodeScannerModal = lazy(() => import('./BarcodeScannerModal'));

export default function ConferencePanel() {
  const session = useCheckoutStore(s => s.session);
  const confirmItem = useCheckoutStore(s => s.confirmItem);
  const cancelSession = useCheckoutStore(s => s.cancelSession);
  const config = useCheckoutStore(s => s.config);

  const isMobile = useIsMobile();
  const [scanQty, setScanQty] = useState('1');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [elapsed, setElapsed] = useState('00:00');
  const [conclusionOpen, setConclusionOpen] = useState(false);
  const [forced, setForced] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);






  // Timer - only update the elapsed string, not the whole component
  useEffect(() => {
    if (!session || session.concludedAt) return;
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000);
      const m = String(Math.floor(diff / 60)).padStart(2, '0');
      const s = String(diff % 60).padStart(2, '0');
      setElapsed(prev => {
        const next = `${m}:${s}`;
        return prev === next ? prev : next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [session?.startedAt, session?.concludedAt]);

  // Document title
  useEffect(() => {
    document.title = session && !session.concludedAt
      ? `WeDo Checkout | #${session.codigo}`
      : 'WeDo Checkout';
    return () => { document.title = 'WeDo Checkout'; };
  }, [session?.codigo, session?.concludedAt]);

  // Desktop: captura GLOBAL do coletor por timing (efeito definido abaixo,
  // após processScan/scanQtyValue).
  const scanBufferRef = useRef<{ chars: string[]; times: number[] }>({ chars: [], times: [] });
  const [scannerActivity, setScannerActivity] = useState(false);





  // Clear feedback
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 2500);
    return () => clearTimeout(t);
  }, [feedback]);

  const processScan = useCallback((code: string, qty: number): boolean => {
    if (!session || !code.trim()) return false;

    const match = matchItemByCode(code, session.items);
    if (!match) {
      setFeedback({ type: 'error', msg: 'Código não encontrado nesta OS/Venda' });
      toast.error('Código não encontrado nesta OS/Venda');
      return false;
    } else if (match.conferido) {
      setFeedback({ type: 'error', msg: `${match.nome_produto} — já completamente conferido` });
      toast.error(`${match.nome_produto} — já completamente conferido`);
      return false;
    } else {
      const remaining = match.qtd_total - match.qtd_conferida;
      if (qty > remaining) {
        setFeedback({ type: 'error', msg: `${match.nome_produto} — quantidade informada (${qty}) excede o restante (${remaining})` });
        toast.error(`Quantidade informada (${qty}) excede o restante na OS (${remaining})`);
        return false;
      } else {
        confirmItem(match.id, qty);
        const newQtd = match.qtd_conferida + qty;
        if (newQtd >= match.qtd_total) {
          setFeedback({ type: 'success', msg: `✓ ${match.nome_produto} — completo!` });
          toast.success(`✓ ${match.nome_produto} — completo!`);
        } else {
          setFeedback({ type: 'success', msg: `✓ ${match.nome_produto} — ${newQtd}/${match.qtd_total} conferidos` });
          toast.success(`✓ ${match.nome_produto} — ${newQtd}/${match.qtd_total}`);
        }
        return true;
      }
    }
  }, [session, confirmItem]);

  const parseScanQty = useCallback((value: string) => {
    const raw = String(value ?? '').trim();
    if (!raw) return 1;

    const normalized = raw.includes(',')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw;

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
  }, []);

  const formatScanQty = useCallback((value: number) => {
    if (!Number.isFinite(value) || value <= 0) return '1';
    return Number.isInteger(value)
      ? String(value)
      : String(value).replace('.', ',');
  }, []);

  const scanQtyValue = useCallback(() => {
    const hasFractional = session?.items.some(i => i.qtd_total % 1 !== 0);
    const hasLargeQty = session?.items.some(i => i.qtd_total >= 5);
    return (hasLargeQty || hasFractional) ? parseScanQty(scanQty) : 1;
  }, [scanQty, session?.items, parseScanQty]);

  // Desktop: captura GLOBAL do coletor por timing. Coletor envia caracteres
  // em milissegundos + Enter. Digitação manual (lenta) é bloqueada.
  useEffect(() => {
    if (isMobile) return;
    if (!session || session.concludedAt) return;

    const MAX_GAP_MS = 60;     // intervalo máx. entre teclas do coletor
    const MIN_LENGTH = 3;      // tamanho mínimo de código válido

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Permite digitar no campo de Qtd, ignorando a captura global
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      const now = Date.now();
      const buf = scanBufferRef.current;

      if (e.key === 'Enter') {
        const code = buf.chars.join('');
        const times = buf.times.slice();
        scanBufferRef.current = { chars: [], times: [] };
        setScannerActivity(false);
        if (code.length < MIN_LENGTH) return;

        let maxGap = 0;
        for (let i = 1; i < times.length; i++) {
          maxGap = Math.max(maxGap, times[i] - times[i - 1]);
        }
        if (maxGap > MAX_GAP_MS) {
          setFeedback({ type: 'error', msg: 'Digitação manual bloqueada — use o coletor de código de barras' });
          toast.error('Digitação manual não é permitida. Use o coletor.');
          return;
        }
        processScan(code, scanQtyValue());
        return;
      }

      if (e.key.length === 1) {
        // reinicia o buffer se houve pausa longa (início de nova leitura)
        if (buf.times.length && now - buf.times[buf.times.length - 1] > 100) {
          buf.chars = [];
          buf.times = [];
        }
        buf.chars.push(e.key);
        buf.times.push(now);
        setScannerActivity(true);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobile, session?.refId, session?.concludedAt, processScan, scanQtyValue]);





  const handlePrint = useCallback(() => {
    if (!session) return;
    const items = session.items;
    const logoUrl = window.location.origin + '/images/logo-wedo-2.jpeg';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Relatório de Separação</title>
<style>body{font-family:Arial,sans-serif;padding:20px;font-size:12px}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
th{background:#f0f0f0;font-size:11px}
h1{font-size:18px;margin:0}h2{font-size:14px;color:#666;margin:4px 0 16px}
.meta{margin-bottom:8px;font-size:12px}
.footer{margin-top:24px;font-size:10px;color:#999;text-align:center}
.header{display:flex;align-items:center;gap:16px;margin-bottom:16px}
.header img{height:60px}
.disclaimer{margin-top:24px;padding:12px;border:1px solid #ccc;border-radius:6px;font-size:11px;line-height:1.6;color:#333;background:#fafafa}
.disclaimer p{margin:0 0 8px 0}
.disclaimer p:last-child{margin-bottom:0}
@media print{.disclaimer{break-inside:avoid}}
</style></head><body>
<div class="header">
  <img src="${logoUrl}" alt="WeDo" />
  <div>
    <h1>WeDo — Relatório de Separação</h1>
    <h2>${session.tipo === 'os' ? 'Ordem de Serviço' : 'Venda'} #${session.codigo}</h2>
  </div>
</div>
<div class="meta"><strong>Cliente:</strong> ${session.nomeCliente}</div>
${session.equipmentName ? `<div class="meta"><strong>Equipamento:</strong> ${session.equipmentName}</div>` : ''}
<div class="meta"><strong>Situação:</strong> ${session.nomeSituacao} · <strong>Valor:</strong> R$ ${session.valorTotal}</div>
<div class="meta"><strong>Operador:</strong> ${config.operatorName || '—'}</div>
<div class="meta"><strong>Início:</strong> ${new Date(session.startedAt).toLocaleString('pt-BR')} · <strong>Conclusão:</strong> ${session.concludedAt ? new Date(session.concludedAt).toLocaleString('pt-BR') : '—'}</div>
<table><thead><tr><th>Produto</th><th>Cód. Produto</th><th>Qtd. Total</th><th>Qtd. Conferida</th><th>Horário</th><th>Status</th></tr></thead><tbody>
${items.map(i => `<tr><td>${i.nome_produto}</td><td>${i.codigo_produto}</td><td>${i.qtd_total}</td><td>${i.qtd_conferida}</td><td>${i.confirmed_at ? new Date(i.confirmed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</td><td>${i.conferido ? '✓ Conferido' : '⚠ Pendente'}</td></tr>`).join('')}
</tbody></table>
<div class="disclaimer">
  <p>Ao retirar estas peças, o técnico assume total responsabilidade.</p>
  <p>Em caso de perda, extravio, dano, desaparecimento ou uso/montagem sem autorização e em equipamento que não é o indicado, deverá ressarcir integralmente o valor da peça constante neste recibo.</p>
  <p>Caso empreste, transfira ou permita o uso delas por outro técnico ou terceiro, sem autorização expressa da direção, continuará sendo o responsável por qualquer perda, dano, extravio, desaparecimento ou uso indevido.</p>
  <p>Não é necessária assinatura, pois o técnico foi verbalmente avisado e manteve uma cópia deste recibo.</p>
</div>
<div class="footer">Documento gerado pelo WeDo Checkout · wedocorp.com</div>
<script>window.onload=function(){window.print()}</script>
</body></html>`;
    const w = window.open('', '_blank');
    w?.document.write(html);
    w?.document.close();
  }, [session, config.operatorName]);

  // Memoize computed values
  const { allConfirmed, confirmedCount, totalCount, showQtyField, progress, hasAnyConfirmed } = useMemo(() => {
    if (!session) return { allConfirmed: false, confirmedCount: 0, totalCount: 0, showQtyField: false, progress: 0, hasAnyConfirmed: false };
    const items = session.items;
    const confirmed = items.filter(i => i.conferido).length;
    const total = items.length;
    return {
      allConfirmed: items.every(i => i.conferido),
      confirmedCount: confirmed,
      totalCount: total,
      showQtyField: items.some(i => i.qtd_total >= 5 || i.qtd_total % 1 !== 0),
      progress: total > 0 ? Math.round((confirmed / total) * 100) : 0,
      hasAnyConfirmed: items.some(i => i.qtd_conferida > 0),
    };
  }, [session?.items]);

  // No active session
  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <PackageCheck className="h-16 w-16 md:h-20 md:w-20 text-muted-foreground/40 mb-4" />
        <h2 className="text-lg md:text-xl font-semibold text-foreground mb-2">Nenhuma separação ativa</h2>
        <p className="text-sm text-muted-foreground">Selecione um pedido na fila para iniciar a conferência</p>
      </div>
    );
  }

  // Concluded view
  if (session.concludedAt) {
    return (
      <div className="flex flex-col h-full">
        <div className="bg-green-100 border-b border-green-200 p-3 md:p-4 text-green-800 font-medium text-xs md:text-sm">
          ✅ Separação concluída — {new Date(session.concludedAt).toLocaleString('pt-BR')} · Operador: {config.operatorName || '—'}
        </div>
        <div className="flex-1 overflow-y-auto p-3 md:p-4">
          <ItemsTable items={session.items} />
        </div>
        <div className="border-t border-border p-3 md:p-4 flex flex-col sm:flex-row gap-2">
          <Button variant="outline" className="gap-2 w-full sm:w-auto" onClick={handlePrint}>
            <Printer className="h-4 w-4" /> Imprimir Relatório
          </Button>
          <Button onClick={cancelSession} className="gap-2 w-full sm:w-auto">
            + Nova Separação
          </Button>
        </div>
        <ConclusionModal open={conclusionOpen} onClose={() => setConclusionOpen(false)} forced={forced} onConcluded={setReceiptData} />
        {receiptData && <SeparationReceipt open={true} onClose={() => setReceiptData(null)} {...receiptData} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Order header */}
      <div className="bg-card border-b border-border p-3 md:p-4 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={session.tipo === 'os' ? 'bg-primary text-primary-foreground' : 'bg-purple-700 text-primary-foreground'}>
              {session.tipo === 'os' ? 'OS' : 'VENDA'}
            </Badge>
            <span className="font-bold text-base md:text-lg">#{session.codigo}</span>
            <span className="text-sm text-muted-foreground truncate max-w-[160px] md:max-w-none">{session.nomeCliente}</span>
            {session.equipmentName && (
              <span className="text-xs text-muted-foreground truncate max-w-[200px] md:max-w-none" title={session.equipmentName}>
                🔧 {session.equipmentName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 justify-between md:justify-end">
            <span className="text-success font-bold text-base md:text-lg">R$ {session.valorTotal}</span>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="font-mono text-sm">{elapsed}</span>
            </div>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-8 px-2" onClick={cancelSession}>
              <X className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Cancelar</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Scan zone — desktop: coletor/scanner USB · mobile: câmera */}
      <div className="border-2 border-secondary bg-secondary/10 mx-3 md:mx-4 mt-3 md:mt-4 rounded-lg p-3">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Scan className="h-3.5 w-3.5" />
            {isMobile ? 'Leitura por câmera' : 'Leitura por coletor (scanner)'}
          </label>
          <div className="flex gap-2">
            {isMobile ? (
              <Button
                className="flex-1 h-[52px] gap-2 text-base"
                onClick={() => setCameraOpen(true)}
              >
                <Camera className="h-5 w-5" />
                {cameraOpen ? 'Escaneando…' : 'Escanear código de barras'}
              </Button>
            ) : (
              <div
                className={`flex-1 h-[52px] rounded-md border-2 flex items-center gap-2 px-3 text-base select-none transition-colors ${
                  scannerActivity ? 'border-primary bg-primary/5 text-foreground' : 'border-dashed border-secondary text-muted-foreground'
                }`}
              >
                <Scan className={`h-5 w-5 shrink-0 ${scannerActivity ? 'text-primary animate-pulse' : ''}`} />
                {scannerActivity ? 'Lendo código…' : 'Aguardando leitura do coletor… (a digitação manual é bloqueada)'}
              </div>
            )}

            {showQtyField && (
              <div className="w-24">
                <label className="text-[10px] font-medium text-muted-foreground">Qtd por leitura</label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={scanQty}
                  onChange={e => {
                    const raw = e.target.value;
                    const sanitized = raw.replace(/[^\d,\.]/g, '');
                    setScanQty(sanitized);
                  }}
                  onBlur={() => {
                    const parsed = parseScanQty(scanQty);
                    setScanQty(formatScanQty(parsed));
                  }}
                  className="text-base py-3 text-center"
                />
              </div>
            )}
          </div>
        </div>
        {feedback && (
          <p className={`mt-2 text-sm font-medium ${feedback.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
            {feedback.msg}
          </p>
        )}

      </div>

      {/* Lazy-loaded barcode scanner (leitura contínua) */}
      {cameraOpen && (
        <Suspense fallback={null}>
          <BarcodeScannerModal
            open={cameraOpen}
            onClose={() => setCameraOpen(false)}
            onScan={(code) => processScan(code, scanQtyValue())}
          />
        </Suspense>
      )}


      {/* Progress */}
      <div className="px-3 md:px-4 py-2">
        <div className="flex items-center justify-between text-xs md:text-sm mb-1">
          <span>{confirmedCount}/{totalCount} itens · {progress}%</span>
        </div>
        <Progress
          value={progress}
          className={`h-2.5 md:h-3 ${allConfirmed ? 'pulse-once' : ''}`}
        />
      </div>

      {/* Items list */}
      <div className="flex-1 overflow-y-auto px-3 md:px-4 pb-3 md:pb-4">
        <ItemsTable items={session.items} />
      </div>

      {/* Footer actions */}
      <div className="border-t border-border bg-card p-3 md:p-4 shadow-[0_-2px_8px_rgba(0,0,0,0.05)]">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="text-xs md:text-sm text-muted-foreground">
            <span>{confirmedCount}/{totalCount} itens separados</span>
            <span className="mx-1.5">·</span>
            <span>Início {new Date(session.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="flex gap-2">
            {hasAnyConfirmed && !allConfirmed && (
              <Button
                variant="outline"
                size="sm"
                className="border-warning text-warning hover:bg-warning/10 flex-1 md:flex-none text-xs md:text-sm"
                onClick={() => { setForced(true); setConclusionOpen(true); }}
              >
                Forçar Conclusão
              </Button>
            )}
            <Button
              size="sm"
              disabled={!allConfirmed}
              className={`bg-success text-success-foreground hover:bg-success/90 flex-1 md:flex-none text-xs md:text-sm ${allConfirmed ? 'pulse-once' : ''}`}
              onClick={() => { setForced(false); setConclusionOpen(true); }}
            >
              Concluir Separação
            </Button>
          </div>
        </div>
      </div>

      <ConclusionModal open={conclusionOpen} onClose={() => setConclusionOpen(false)} forced={forced} onConcluded={setReceiptData} />
      {receiptData && <SeparationReceipt open={true} onClose={() => setReceiptData(null)} {...receiptData} />}
    </div>
  );
}
