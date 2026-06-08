import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  History, Loader2, PlayCircle, PackageCheck, UserPlus, UserMinus, Undo2,
  XCircle, FileText, AlertTriangle, MessageSquare, Radio, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSeparationHistory, SeparationHistory, TimelineEvent } from '@/api/separationHistory';
import type { SeparationRecord } from '@/api/separations';

interface Props {
  open: boolean;
  onClose: () => void;
  separation: SeparationRecord | null;
}

const KIND_META: Record<string, { icon: React.ElementType; color: string }> = {
  started: { icon: PlayCircle, color: 'text-blue-600' },
  concluded: { icon: PackageCheck, color: 'text-green-600' },
  'tech-link': { icon: UserPlus, color: 'text-primary' },
  'tech-unlink': { icon: UserMinus, color: 'text-amber-600' },
  return: { icon: Undo2, color: 'text-amber-600' },
  invalidated: { icon: XCircle, color: 'text-destructive' },
  'os-generated': { icon: FileText, color: 'text-purple-600' },
  'os-gen-failed': { icon: AlertTriangle, color: 'text-destructive' },
  'gc-change': { icon: RefreshCw, color: 'text-sky-600' },
  system: { icon: History, color: 'text-muted-foreground' },
};

function fmt(at: string | null): string {
  if (!at) return '—';
  return new Date(at).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function EventRow({ ev }: { ev: TimelineEvent }) {
  const meta = KIND_META[ev.kind] || KIND_META.system;
  const Icon = meta.icon;
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={cn('rounded-full bg-muted p-1.5', meta.color)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="w-px flex-1 bg-border my-1" />
      </div>
      <div className="pb-4 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{ev.title}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {ev.kind === 'gc-change' ? 'GestãoClick' : ev.source === 'separation' ? 'Sistema' : ev.source === 'system' ? 'Log' : ev.source === 'os_gen' ? 'Geração OS' : 'GC'}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{fmt(ev.at)}{ev.actor ? ` • ${ev.actor}` : ''}</p>
        {ev.description && (
          <p className="text-xs text-foreground/80 mt-1 break-words">{ev.description}</p>
        )}
      </div>
    </div>
  );
}

export default function SeparationHistoryDialog({ open, onClose, separation }: Props) {
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<SeparationHistory | null>(null);

  useEffect(() => {
    if (!open || !separation) return;
    let active = true;
    setLoading(true);
    setHistory(null);
    getSeparationHistory(separation)
      .then((h) => { if (active) setHistory(h); })
      .catch((e) => console.error('history load error', e))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, separation]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4" />
            Histórico completo {separation ? `— ${separation.order_type === 'os' ? 'OS' : 'Venda'} #${separation.order_code}` : ''}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mb-2" />
              <p className="text-xs">Reunindo tudo que já aconteceu com esta OS...</p>
            </div>
          )}

          {!loading && history && (
            <div className="space-y-4">
              {separation && (
                <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1">
                  <p className="font-medium text-foreground">{separation.client_name}</p>
                  {separation.equipment_name && <p className="text-muted-foreground">🔧 {separation.equipment_name}</p>}
                  {history.gcStatusAtual && (
                    <p className="flex items-center gap-1.5 text-muted-foreground">
                      <Radio className="h-3 w-3 text-green-500 animate-pulse" />
                      Status atual no GC: <span className="font-medium text-foreground">{history.gcStatusAtual}</span>
                    </p>
                  )}
                </div>
              )}

              {/* Timeline */}
              {history.events.length > 0 ? (
                <div>
                  {history.events.map((ev, i) => <EventRow key={i} ev={ev} />)}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-6">Nenhum evento registrado para esta OS.</p>
              )}

              {/* GC observations (full accumulated trail) */}
              {(history.gcObservacoes || history.gcObservacoesInterna) && (
                <div className="space-y-2">
                  {history.gcObservacoesInterna && (
                    <div className="rounded-lg border bg-card p-3">
                      <p className="text-xs font-medium text-foreground flex items-center gap-1.5 mb-1">
                        <MessageSquare className="h-3.5 w-3.5" /> Observações internas (GC)
                      </p>
                      <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-words font-sans">{history.gcObservacoesInterna}</pre>
                    </div>
                  )}
                  {history.gcObservacoes && (
                    <div className="rounded-lg border bg-card p-3">
                      <p className="text-xs font-medium text-foreground flex items-center gap-1.5 mb-1">
                        <MessageSquare className="h-3.5 w-3.5" /> Observações (GC)
                      </p>
                      <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-words font-sans">{history.gcObservacoes}</pre>
                    </div>
                  )}
                </div>
              )}

              {history.gcError && (
                <p className="text-[11px] text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Não foi possível buscar observações no GC: {history.gcError}
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
