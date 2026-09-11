import { supabase } from '@/integrations/supabase/client';
import type { GcRecord } from './partialExecution';
import { pendingOsLines, excluded, type OsStockCommitment } from '../../supabase/functions/_shared/osStockCommitments';
export { pendingOsLines, STOCK_COMMITMENT_STATUSES, type OsStockCommitment } from '../../supabase/functions/_shared/osStockCommitments';
const id = (v: unknown) => ['0', 'null', 'undefined'].includes(String(v)) ? '' : String(v ?? '').trim();
const number = (v: unknown) => Number(String(v ?? '').includes(',') ? String(v).replace(/\./g, '').replace(',', '.') : v);

async function gc(path: string): Promise<GcRecord> {
  const { data, error } = await supabase.functions.invoke('gc-proxy', { body: { path, method: 'GET' } });
  if (error || !data?._proxy?.ok) throw new Error('Não foi possível consultar todas as OS. Atualize antes de enviar ao Checkout.');
  return data;
}

/** Só publica resultado após validar a paginação completa. Nunca transforma erro em estoque disponível. */
export async function readAllOsCommitments(request: (path: string) => Promise<GcRecord>): Promise<OsStockCommitment[]> {
  const result: OsStockCommitment[] = [];
  const seen = new Set<string>();
  let pages = 1;
  let records: number | undefined;
  for (let page = 1; page <= pages; page++) {
    const response = await request(`/api/ordens_servicos?limite=100&pagina=${page}`);
    const total = Number(response.meta?.total_paginas);
    const count = Number(response.meta?.total_registros);
    if (!Array.isArray(response.data) || !Number.isInteger(total) || total < 0 || !Number.isInteger(count) || count < 0
      || Number(response.meta?.pagina_atual) !== page || (page > 1 && (total !== pages || count !== records))) {
      throw new Error('Consulta incompleta das OS: envio bloqueado.');
    }
    pages = total; records = count;
    for (const entry of response.data) {
      let os = entry.OrdemServico || entry.ordem_servico || entry;
      const osId = id(os.id);
      if (!osId || seen.has(osId)) throw new Error('Paginação inconsistente das OS: atualize e tente novamente.');
      seen.add(osId);
      if (excluded(os)) continue;
      if ((!Array.isArray(os.produtos) && number(os.valor_produtos) !== 0) || os.situacao_estoque == null) {
        os = (await request(`/api/ordens_servicos/${encodeURIComponent(osId)}`)).data;
        if (!os || id(os.id) !== osId) throw new Error('Detalhe inconsistente da OS.');
      }
      result.push(...pendingOsLines(os));
    }
  }
  if (seen.size !== records) throw new Error('Há OS ausentes na consulta: envio bloqueado.');
  return result;
}

export async function fetchOsStockCommitments(): Promise<OsStockCommitment[]> {
  const rows = await readAllOsCommitments(gc);
  const localIds = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('partial_writeoff_batches').select('auxiliary_document_id')
      .eq('auxiliary_document_type', 'os').in('status', ['creating', 'awaiting_checkout', 'confirming', 'reconciliation_required']).range(from, from + 999);
    if (error) throw new Error('Não foi possível validar as reservas dos lotes.');
    for (const b of data || []) if (b.auxiliary_document_id) localIds.add(String(b.auxiliary_document_id));
    if ((data || []).length < 1000) break;
  }
  // A RPC já conta a reserva local desses documentos. Não contar a mesma peça duas vezes.
  return rows.filter(r => !localIds.has(r.osId));
}

export function commitmentFor(lines: OsStockCommitment[], productId: string, variationId: string, excludeOsId?: string) {
  const sources = lines.filter(l => l.osId !== excludeOsId && l.productId === productId && (!l.variationId || !variationId || l.variationId === variationId));
  const quantity = sources.reduce((n, l) => n + l.quantity, 0);
  return { sources, quantity, outstanding: quantity };
}

export function assertStockConflict(stock: number, requested: number, localReserved: number, lines: OsStockCommitment[], productId: string, variationId: string, excludeOsId?: string): void {
  const commitment = commitmentFor(lines, productId, variationId, excludeOsId);
  if (requested > Math.max(0, stock - localReserved - commitment.outstanding)) {
    throw new Error(`Conflito de estoque: solicitado ${requested}, estoque GC ${stock}, reservas locais ${localReserved}. `
      + `OS que disputam a peça: ${commitment.sources.map(s => `#${s.code} (${s.quantity}; ${s.status})`).join(', ') || 'outros lotes de baixa parcial'}.`);
  }
}
