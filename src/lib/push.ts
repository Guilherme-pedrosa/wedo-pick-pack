/**
 * Web Push helper. SW só registra fora do iframe/preview da Lovable.
 * Envia/remove subscription via edge function `push-subscribe`.
 */
import { supabase } from '@/integrations/supabase/client';

const VAPID_PUBLIC_KEY = 'BFXpSUA9MT1ChlpF1R9D7seXs7BbcKBNsooWkV8gsGUPpSKyCKEw8KfZH-Dp3F8V_coQUltUKWdTJHAxqRgHzNs';

function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isPreviewHost(): boolean {
  const h = window.location.hostname;
  return h.includes('id-preview--') || h.includes('lovableproject.com');
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushBlockedHere(): boolean {
  return isInIframe() || isPreviewHost();
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function ensureSWRegistered(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  if (pushBlockedHere()) {
    // Limpa SW antigo se existir no preview
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch {}
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    return reg;
  } catch (e) {
    console.error('[push] SW register failed', e);
    return null;
  }
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await ensureSWRegistered();
  if (!reg) return null;
  return await reg.pushManager.getSubscription();
}

export async function subscribePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  if (pushBlockedHere()) return { ok: false, reason: 'preview' };

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'denied' };

  const reg = await ensureSWRegistered();
  if (!reg) return { ok: false, reason: 'sw-failed' };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
  }

  const json = sub.toJSON() as any;
  const payload = {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh || arrayBufferToBase64(sub.getKey('p256dh')),
    auth: json.keys?.auth || arrayBufferToBase64(sub.getKey('auth')),
    user_agent: navigator.userAgent,
  };

  const { error } = await supabase.functions.invoke('push-subscribe', {
    body: { action: 'subscribe', ...payload },
  });
  if (error) {
    console.error('[push] subscribe save failed', error);
    return { ok: false, reason: 'save-failed' };
  }
  return { ok: true };
}

export async function unsubscribePush(): Promise<boolean> {
  const sub = await getCurrentSubscription();
  if (!sub) return true;
  try {
    await supabase.functions.invoke('push-subscribe', {
      body: { action: 'unsubscribe', endpoint: sub.endpoint },
    });
  } catch {}
  return await sub.unsubscribe();
}

export async function sendTestPush(): Promise<void> {
  await supabase.functions.invoke('push-send', {
    body: {
      test: true,
      title: 'WeDo — Teste',
      body: 'Notificações funcionando! 🎉',
      url: '/checkout',
    },
  });
}
