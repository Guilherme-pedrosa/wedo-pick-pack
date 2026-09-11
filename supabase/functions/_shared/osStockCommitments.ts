import { normalizedStatus, type GcRecord } from './partialExecution.ts';

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
export const excluded = (os: GcRecord) => !STOCK_COMMITMENT_STATUSES.has(normalizedStatus(os.nome_situacao)) || String(os.situacao_estoque) === '1';

export function pendingOsLines(os: GcRecord): OsStockCommitment[] {
  if (excluded(os)) return [];
  return documentStockLines(os);
}

/** Produtos da OS/venda selecionada. A lista de situações filtra compromissos
 * externos; nunca pode dispensar a validação da baixa que será feita agora. */
export function documentStockLines(os: GcRecord): OsStockCommitment[] {
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

