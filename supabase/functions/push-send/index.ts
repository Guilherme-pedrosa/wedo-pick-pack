// supabase/functions/push-send/index.ts
// Envia notificações Web Push para usuários inscritos.
// Body: { user_ids?: string[], event_type?: string, title, body, url?, tag?, data?, test? }
// - test=true envia somente para o usuário autenticado
// - sem user_ids => todos os subscribers que aceitam o event_type

import webpush from 'https://esm.sh/web-push@3.6.7';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@wedo.app';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const {
      user_ids,
      event_type,
      title,
      body: msgBody,
      url,
      tag,
      data,
      test,
    } = body || {};

    if (!title) throw new Error('title required');

    let targetUserIds: string[] | null = user_ids ?? null;

    // For test mode, restrict to the authenticated user only
    if (test) {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const token = authHeader.replace('Bearer ', '');
      const { data: claims } = await userClient.auth.getClaims(token);
      if (!claims?.claims?.sub) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      targetUserIds = [claims.claims.sub];
    }

    let q = admin.from('push_subscriptions').select('*').eq('enabled', true);
    if (targetUserIds && targetUserIds.length) {
      q = q.in('user_id', targetUserIds);
    }
    const { data: subs, error } = await q;
    if (error) throw error;

    const filtered = (subs || []).filter((s: any) => {
      if (!event_type) return true;
      const ev = Array.isArray(s.events) ? s.events : [];
      return ev.includes(event_type);
    });

    const payload = JSON.stringify({
      title,
      body: msgBody || '',
      url: url || '/checkout',
      tag,
      data,
    });

    const results = await Promise.allSettled(
      filtered.map(async (s: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: 60 * 60 }
          );
          return { id: s.id, ok: true };
        } catch (err: any) {
          const status = err?.statusCode || err?.status;
          // Gone / Not registered → cleanup
          if (status === 404 || status === 410) {
            await admin.from('push_subscriptions').delete().eq('id', s.id);
          }
          return { id: s.id, ok: false, status, msg: String(err?.message || err) };
        }
      })
    );

    const sent = results.filter((r) => r.status === 'fulfilled' && (r as any).value.ok).length;
    return new Response(
      JSON.stringify({ ok: true, total: filtered.length, sent }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    console.error('[push-send]', e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
