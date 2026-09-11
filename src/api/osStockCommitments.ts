import { supabase } from '@/integrations/supabase/client';
import { normalizedStatus, type GcRecord } from './partialExecution';

export interface OsStockCommitment {
  osId: string; code: string; client: string; status: string;
  productId: string; variationId: string; quantity: number;
}
const id = (v: unknown) => ['0', 'null', 'undefined'].includes(String(v)) ? '' : String(v ?? '').trim();
const number = (v: unknown) => Number(String(v ?? '').includes(',') ? String(v).replace(/\./g, '').replace(',', '.') : v);
// Lista explícita confirmada pelo usuário. Saída de estoque nunca é compromisso.
export const STOCK_COMMITMENT_STATUSES = new Set([
  'AGUARDANDO COMPRA DE PECAS',
  'AGUARDANDO CHEGADA DE PECAS',
  'AGUARDANDO FABRICACAO',
  'PEDIDO EM CONFERENCIA',
  'SERVICO AGUARDANDO EXECUCAO',
  'PEDIDO CONFERIDO AGUARDANDO EXECUCAO',
]);
const excluded = (os: GcRecord) => !STOCK_COMMITMENT_STATUSES.has(normalizedStatus(os.nome_situacao)) || String(os.situacao_estoque) === '1';

export function pendingOsLines(os: GcRecord): OsStockCommitment[] {
  if (excluded(os)) return [];
  if (!os.nome_situacao || !['0', '1'].includes(String(os.situacao_estoque))) throw new Error(`Não foi possível validar a OS #${os.codigo || os.id}.`);
  if (!Array.isArray(os.produtos) && number(os.valor_produtos) !== 0) throw new Error(`Itens incompletos na OS #${os.codigo || os.id}.`);
  return (os.produtos || []).flatMap((line: GcRecord) => {
    const p = line.produto || line;
    if (String(p.movimenta_estoque) === '0') return [];
    // Linhas avulsas sem produto_id não vinculam nenhuma peça do cadastro GC.
    // Associá-las por semelhança de nome inventaria um compromisso de outro produto.
    if (!id(p.produto_id)) return [];
    const quantity = number(p.quantidade);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Item inválido na OS #${os.codigo}.`);
    return quantity === 0 ? [] : [{ osId: id(os.id), code: String(os.codigo || os.id), client: String(os.nome_cliente || ''),
      status: String(os.nome_situacao), productId: id(p.produto_id), variationId: String(p.possui_variacao) === '0' ? '' : id(p.variacao_id), quantity }];
  });
}

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
