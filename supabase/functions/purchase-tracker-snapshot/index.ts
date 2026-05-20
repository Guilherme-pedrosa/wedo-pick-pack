import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GC_API_URL = 'https://api.gestaoclick.com';

function parseFlexibleDate(s: string): Date | null {
  if (!s) return null;
  const t = s.trim();
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    let year = Number(br[3]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return new Date(year, month - 1, day);
  }
  const brShort = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (brShort) {
    const day = Number(brShort[1]);
    const month = Number(brShort[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return new Date(new Date().getFullYear(), month - 1, day);
  }
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return null;
}

function parseGCDate(s: string): Date | null {
  if (!s) return null;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

async function gcGet(path: string) {
  const url = `${GC_API_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      'access-token': Deno.env.get('GC_ACCESS_TOKEN') ?? '',
      'secret-access-token': Deno.env.get('GC_SECRET_TOKEN') ?? '',
      'Accept': 'application/json',
    },
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`GC ${res.status}: ${txt.slice(0, 200)}`);
  return JSON.parse(txt);
}

interface Row {
  id: string;
  codigo: string;
  fornecedor: string;
  situacao: string;
  ultima: string | null;
  previsao: string | null;
  stuckDays: number;
  arrOverdue: number;
}

function extractRow(raw: any): Row {
  const c = raw?.Compra ?? raw;
  const hist = (c?.situacoes || [])
    .map((w: any) => w?.situacao)
    .filter(Boolean)
    .sort((a: any, b: any) => {
      const da = parseGCDate(String(a.data ?? ''))?.getTime() ?? 0;
      const db = parseGCDate(String(b.data ?? ''))?.getTime() ?? 0;
      return db - da;
    });
  const ultima: string | null = hist[0]?.data ?? null;
  let previsao: string | null = null;
  for (const w of c?.campos_extras || []) {
    const e = w?.extras ?? w;
    const desc = String(e?.descricao ?? '').toUpperCase();
    if (desc.includes('CHEGADA') && desc.includes('PE')) {
      const v = String(e?.conteudo ?? '').trim();
      if (v) { previsao = v; break; }
    }
  }
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dUlt = ultima ? parseGCDate(ultima) : null;
  const dPrev = previsao ? parseFlexibleDate(previsao) : null;
  return {
    id: String(c?.id ?? ''),
    codigo: String(c?.codigo ?? ''),
    fornecedor: String(c?.nome_fornecedor ?? ''),
    situacao: String(c?.nome_situacao ?? ''),
    ultima,
    previsao,
    stuckDays: dUlt ? daysBetween(dUlt, now) : -1,
    arrOverdue: dPrev ? daysBetween(dPrev, today0) : -Infinity,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const started = Date.now();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    const { data: settings } = await supabase
      .from('purchase_tracker_settings')
      .select('watched_situacao_ids')
      .limit(1)
      .maybeSingle();

    const ids: string[] = settings?.watched_situacao_ids ?? [];
    if (!ids.length) {
      await supabase.from('purchase_tracker_snapshots').insert({
        status: 'skipped',
        error_message: 'Nenhuma situação configurada',
        duration_ms: Date.now() - started,
      });
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const all = new Map<string, Row>();
    for (const sid of ids) {
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const res = await gcGet(`/api/compras?pagina=${page}&situacao_id=${sid}`);
        totalPages = res?.meta?.total_paginas ?? 1;
        for (const item of res?.data || []) {
          const row = extractRow(item);
          if (!row.id) continue;
          const sitMatch = ids.includes(String((item?.Compra ?? item)?.situacao_id ?? ''));
          if (!sitMatch) continue;
          all.set(row.id, row);
        }
        page++;
        if (page <= totalPages) await new Promise(r => setTimeout(r, 400));
      }
    }

    const rows = [...all.values()];
    let warn = 0, crit = 0, arr = 0;
    const critRows: any[] = [];
    const arrRows: any[] = [];
    for (const r of rows) {
      if (r.stuckDays > 30) { crit++; critRows.push({ codigo: r.codigo, fornecedor: r.fornecedor, situacao: r.situacao, dias: r.stuckDays }); }
      else if (r.stuckDays > 15) warn++;
      if (r.arrOverdue > 0) { arr++; arrRows.push({ codigo: r.codigo, fornecedor: r.fornecedor, previsao: r.previsao, atraso: r.arrOverdue }); }
    }

    critRows.sort((a, b) => b.dias - a.dias);
    arrRows.sort((a, b) => b.atraso - a.atraso);

    const { data: inserted, error: insErr } = await supabase
      .from('purchase_tracker_snapshots')
      .insert({
        status: 'success',
        total: rows.length,
        warn_count: warn,
        crit_count: crit,
        arrival_overdue_count: arr,
        crit_rows: critRows.slice(0, 20),
        arrival_rows: arrRows.slice(0, 20),
        duration_ms: Date.now() - started,
      })
      .select()
      .single();

    if (insErr) throw insErr;

    return new Response(JSON.stringify({ ok: true, snapshot: inserted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('purchase-tracker-snapshot error', e);
    await supabase.from('purchase_tracker_snapshots').insert({
      status: 'error',
      error_message: String(e?.message ?? e).slice(0, 500),
      duration_ms: Date.now() - started,
    });
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
