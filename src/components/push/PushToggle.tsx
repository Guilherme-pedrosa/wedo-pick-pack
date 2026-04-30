import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  pushSupported,
  pushBlockedHere,
  getCurrentSubscription,
  subscribePush,
  unsubscribePush,
  sendTestPush,
} from '@/lib/push';

interface Props {
  variant?: 'default' | 'compact';
}

export function PushToggle({ variant = 'default' }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();
  const preview = pushBlockedHere();

  useEffect(() => {
    if (!supported || preview) {
      setEnabled(false);
      return;
    }
    getCurrentSubscription().then((s) => setEnabled(!!s));
  }, [supported, preview]);

  if (!supported) {
    return variant === 'compact' ? null : (
      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <BellOff className="h-4 w-4" />
        Notificações não suportadas neste navegador.
      </div>
    );
  }

  if (preview) {
    return variant === 'compact' ? null : (
      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <BellOff className="h-4 w-4" />
        Notificações funcionam apenas no app publicado (item-handoff.lovable.app).
      </div>
    );
  }

  const handleToggle = async () => {
    setBusy(true);
    try {
      if (enabled) {
        await unsubscribePush();
        setEnabled(false);
        toast.success('Notificações desativadas');
      } else {
        const r = await subscribePush();
        if (r.ok) {
          setEnabled(true);
          toast.success('Notificações ativadas! 🔔');
        } else if (r.reason === 'denied') {
          toast.error('Permissão de notificação negada pelo navegador.');
        } else {
          toast.error('Falha ao ativar: ' + (r.reason || 'erro'));
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      await sendTestPush();
      toast.info('Push de teste enviado.');
    } catch {
      toast.error('Falha no teste.');
    } finally {
      setBusy(false);
    }
  };

  if (variant === 'compact') {
    return (
      <Button
        size="sm"
        variant={enabled ? 'default' : 'outline'}
        onClick={handleToggle}
        disabled={busy}
        title={enabled ? 'Desativar notificações' : 'Ativar notificações'}
      >
        {enabled ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button onClick={handleToggle} disabled={busy} variant={enabled ? 'destructive' : 'default'}>
        {enabled ? (
          <>
            <BellOff className="h-4 w-4 mr-2" /> Desativar notificações
          </>
        ) : (
          <>
            <Bell className="h-4 w-4 mr-2" /> Ativar notificações push
          </>
        )}
      </Button>
      {enabled && (
        <Button variant="outline" onClick={handleTest} disabled={busy}>
          <BellRing className="h-4 w-4 mr-2" /> Enviar teste
        </Button>
      )}
    </div>
  );
}
