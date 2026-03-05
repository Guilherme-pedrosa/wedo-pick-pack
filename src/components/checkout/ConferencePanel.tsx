import { useState, useRef, useEffect, useCallback } from 'react';
import { useCheckoutStore } from '@/store/checkoutStore';
import { matchItemByCode } from '@/lib/scanMatcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { PackageCheck, Scan, Clock, X, Printer, Camera } from 'lucide-react';
import { toast } from 'sonner';
import ItemsTable from './ItemsTable';
import ConclusionModal from './ConclusionModal';
import BarcodeScannerModal from './BarcodeScannerModal';

export default function ConferencePanel() {
  const session = useCheckoutStore(s => s.session);
  const confirmItem = useCheckoutStore(s => s.confirmItem);
  const cancelSession = useCheckoutStore(s => s.cancelSession);
  const config = useCheckoutStore(s => s.config);

  const [scanCode, setScanCode] = useState('');
  const [scanQty, setScanQty] = useState<number | string>(1);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [elapsed, setElapsed] = useState('00:00');
  const [conclusionOpen, setConclusionOpen] = useState(false);
  const [forced, setForced] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  // Timer
  useEffect(() => {
    if (!session || session.concludedAt) return;
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000);
      const m = String(Math.floor(diff / 60)).padStart(2, '0');
      const s = String(diff % 60).padStart(2, '0');
      setElapsed(`${m}:${s}`);
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

  // Auto-focus scan input
  useEffect(() => {
    if (session && !session.concludedAt) {
      scanRef.current?.focus();
    }
  }, [session?.items, session?.concludedAt]);

  // F2 shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        scanRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Clear feedback
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 2500);
    return () => clearTimeout(t);
  }, [feedback]);

  const processScan = useCallback((code: string, qty: number) => {
    if (!session || !code.trim()) return;

    const match = matchItemByCode(code, session.items);
    if (!match) {
      setFeedback({ type: 'error', msg: 'Código não encontrado nesta OS/Venda' });
      toast.error('Código não encontrado nesta OS/Venda');
      scanRef.current?.classList.add('scan-shake');
      setTimeout(() => scanRef.current?.classList.remove('scan-shake'), 500);
    } else if (match.conferido) {
      setFeedback({ type: 'error', msg: `${match.nome_produto} — já completamente conferido` });
      toast.error(`${match.nome_produto} — já completamente conferido`);
    } else {
      const remaining = match.qtd_total - match.qtd_conferida;
      const toConfirm = Math.min(qty, remaining);
      confirmItem(match.id, toConfirm);
      const newQtd = match.qtd_conferida + toConfirm;
      if (newQtd >= match.qtd_total) {
        setFeedback({ type: 'success', msg: `✓ ${match.nome_produto} — completo!` });
        toast.success(`✓ ${match.nome_produto} — completo!`);
      } else {
        setFeedback({ type: 'success', msg: `✓ ${match.nome_produto} — ${newQtd}/${match.qtd_total} conferidos` });
        toast.success(`✓ ${match.nome_produto} — ${newQtd}/${match.qtd_total}`);
      }
    }
  }, [session, confirmItem]);

  const handleScan = useCallback(() => {
    const itemCount = session?.items.length || 0;
    const effectiveQty = itemCount > 20 ? (Number(scanQty) || 1) : 1;
    processScan(scanCode, effectiveQty);
    setScanCode('');
    setScanQty(1);
    scanRef.current?.focus();
  }, [scanCode, scanQty, processScan, session?.items.length]);

  const handlePrint = () => {
    if (!session) return;
    const items = session.items;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Relatório de Separação</title>
<style>body{font-family:Arial,sans-serif;padding:20px;font-size:12px}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
th{background:#f0f0f0;font-size:11px}
h1{font-size:18px;margin:0}h2{font-size:14px;color:#666;margin:4px 0 16px}
.meta{margin-bottom:8px;font-size:12px}
.footer{margin-top:24px;font-size:10px;color:#999;text-align:center}
</style></head><body>
<h1>WeDo — Relatório de Separação</h1>
<h2>${session.tipo === 'os' ? 'Ordem de Serviço' : 'Venda'} #${session.codigo}</h2>
<div class="meta"><strong>Cliente:</strong> ${session.nomeCliente}</div>
<div class="meta"><strong>Situação:</strong> ${session.nomeSituacao} · <strong>Valor:</strong> R$ ${session.valorTotal}</div>
<div class="meta"><strong>Operador:</strong> ${config.operatorName || '—'}</div>
<div class="meta"><strong>Início:</strong> ${new Date(session.startedAt).toLocaleString('pt-BR')} · <strong>Conclusão:</strong> ${session.concludedAt ? new Date(session.concludedAt).toLocaleString('pt-BR') : '—'}</div>
<table><thead><tr><th>Produto</th><th>Cód. Produto</th><th>Qtd. Total</th><th>Qtd. Conferida</th><th>Horário</th><th>Status</th></tr></thead><tbody>
${items.map(i => `<tr><td>${i.nome_produto}</td><td>${i.codigo_produto}</td><td>${i.qtd_total}</td><td>${i.qtd_conferida}</td><td>${i.confirmed_at ? new Date(i.confirmed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</td><td>${i.conferido ? '✓ Conferido' : '⚠ Pendente'}</td></tr>`).join('')}
</tbody></table>
<div class="footer">Documento gerado pelo WeDo Checkout · wedocorp.com</div>
<script>window.onload=function(){window.print()}</script>
</body></html>`;
    const w = window.open('', '_blank');
    w?.document.write(html);
    w?.document.close();
  };

  // No active session
  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <PackageCheck className="h-20 w-20 text-muted-foreground/40 mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Nenhuma separação ativa</h2>
        <p className="text-muted-foreground">Selecione um pedido na fila ao lado para iniciar a conferência</p>
      </div>
    );
  }

  const allConfirmed = session.items.every(i => i.conferido);
  const confirmedCount = session.items.filter(i => i.conferido).length;
  const totalCount = session.items.length;
  const showQtyField = totalCount > 20;
  const progress = totalCount > 0 ? Math.round((confirmedCount / totalCount) * 100) : 0;
  const hasAnyConfirmed = session.items.some(i => i.qtd_conferida > 0);

  // Concluded view
  if (session.concludedAt) {
    return (
      <div className="flex flex-col h-full">
        <div className="bg-green-100 border-b border-green-200 p-4 text-green-800 font-medium text-sm">
          ✅ Separação concluída — {new Date(session.concludedAt).toLocaleString('pt-BR')} · Operador: {config.operatorName || '—'}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <ItemsTable items={session.items} />
        </div>
        <div className="border-t border-border p-4 flex gap-3">
          <Button variant="outline" className="gap-2" onClick={handlePrint}>
            <Printer className="h-4 w-4" /> Imprimir Relatório
          </Button>
          <Button onClick={cancelSession} className="gap-2">
            + Nova Separação
          </Button>
        </div>
        <ConclusionModal open={conclusionOpen} onClose={() => setConclusionOpen(false)} forced={forced} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Order header */}
      <div className="bg-card border-b border-border p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge className={session.tipo === 'os' ? 'bg-primary text-primary-foreground' : 'bg-purple-700 text-primary-foreground'}>
              {session.tipo === 'os' ? 'OS' : 'VENDA'}
            </Badge>
            <span className="font-bold text-lg">#{session.codigo}</span>
            <span className="text-muted-foreground">{session.nomeCliente}</span>
            <Badge variant="outline" className="text-xs">{session.nomeSituacao}</Badge>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-success font-bold text-lg">R$ {session.valorTotal}</span>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="font-mono text-sm">{elapsed}</span>
            </div>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={cancelSession}>
              <X className="h-4 w-4 mr-1" /> Cancelar
            </Button>
          </div>
        </div>
      </div>

      {/* Scan zone */}
      <div className="border-2 border-secondary bg-secondary/10 m-4 rounded-lg p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Scan className="h-3.5 w-3.5" /> Código do item
            </label>
            <div className="flex gap-2">
              <Input
                ref={scanRef}
                value={scanCode}
                onChange={e => setScanCode(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } }}
                placeholder="Código de barras ou produto…"
                className="text-base sm:text-lg py-3 border-2 border-secondary focus:border-secondary"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
              <Button
                variant="secondary"
                size="icon"
                className="h-[50px] w-[50px] shrink-0"
                onClick={() => setCameraOpen(true)}
                title="Escanear com câmera"
              >
                <Camera className="h-5 w-5" />
              </Button>
            </div>
          </div>
          {showQtyField && (
            <div className="flex gap-2 sm:gap-3">
              <div className="w-20 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Qtd</label>
                <Input
                  type="number"
                  value={scanQty}
                  onChange={e => setScanQty(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 1))}
                  onBlur={() => { if (scanQty === '' || Number(scanQty) < 1) setScanQty(1); }}
                  min={1}
                  className="text-base sm:text-lg py-3 text-center"
                />
              </div>
              <div className="flex items-end">
                <Button onClick={handleScan} className="h-[50px] px-6">OK</Button>
              </div>
            </div>
          )}
        </div>
        {feedback && (
          <p className={`mt-2 text-sm font-medium ${feedback.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
            {feedback.msg}
          </p>
        )}
      </div>

      <BarcodeScannerModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScan={(code) => {
          const itemCount = session?.items.length || 0;
          processScan(code, itemCount > 20 ? (Number(scanQty) || 1) : 1);
          scanRef.current?.focus();
        }}
      />

      {/* Progress */}
      <div className="px-4 pb-2">
        <div className="flex items-center justify-between text-sm mb-1">
          <span>Progresso: {confirmedCount} de {totalCount} itens · {progress}%</span>
        </div>
        <Progress
          value={progress}
          className={`h-3 ${allConfirmed ? 'pulse-once' : ''}`}
        />
      </div>

      {/* Items table */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <ItemsTable items={session.items} />
      </div>

      {/* Footer actions */}
      <div className="border-t border-border bg-card p-4 shadow-[0_-2px_8px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground space-y-0.5">
            <p>{confirmedCount}/{totalCount} itens separados</p>
            <p>Iniciado às {new Date(session.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
          </div>
          <div className="flex gap-2">
            {hasAnyConfirmed && !allConfirmed && (
              <Button
                variant="outline"
                className="border-warning text-warning hover:bg-warning/10"
                onClick={() => { setForced(true); setConclusionOpen(true); }}
              >
                Forçar Conclusão
              </Button>
            )}
            <Button
              disabled={!allConfirmed}
              className={`bg-success text-success-foreground hover:bg-success/90 ${allConfirmed ? 'pulse-once' : ''}`}
              onClick={() => { setForced(false); setConclusionOpen(true); }}
            >
              Concluir Separação
            </Button>
          </div>
        </div>
      </div>

      <ConclusionModal open={conclusionOpen} onClose={() => setConclusionOpen(false)} forced={forced} />
    </div>
  );
}
