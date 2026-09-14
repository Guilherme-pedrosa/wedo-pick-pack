import { assertDefinitiveContents, assertStatusOnlyChange, writableDocument } from './partialConsolidation';
import type { GcRecord } from './partialExecution';

type Request = (path: string, options?: { method?: string; body?: string }) => Promise<any>;

/** O documento recém-lido é a referência. Não redistribuir parcelas, arredondar
 * preços, recuperar campos apagados de um cache antigo nem repetir um PUT incerto. */
export async function changeDocumentStatus<T extends GcRecord>(request: Request, type: 'os' | 'venda', id: string,
  expected: T, status: string, operator?: string, customNote?: string): Promise<T> {
  const path = `/api/${type === 'os' ? 'ordens_servicos' : 'vendas'}/${encodeURIComponent(id)}`;
  const current = (await request(path))?.data;
  if (!current || String(current.id) !== id) throw new Error('Não foi possível conferir o documento atual no GestãoClick. Nenhuma atualização enviada.');
  assertDefinitiveContents(expected, current);
  const payload = writableDocument(current);
  if (current.tipo != null) payload.tipo = current.tipo;
  payload.situacao_id = status;
  const now = new Date().toLocaleString('pt-BR');
  const append = (value: unknown, note: string) => [String(value ?? ''), note].filter(Boolean).join('\n');
  if (customNote || operator) {
    payload.observacoes = append(current.observacoes, `[WeDo Checkout] ${customNote || `Separação por: ${operator}`} em ${now}`);
    payload.observacoes_interna = append(current.observacoes_interna, `[WeDo Checkout] ${customNote || `Separação realizada por: ${operator}`} em ${now}`);
  }
  // As linhas planas são o formato de escrita do endpoint; seus valores são copiados exatamente.
  const wire = { ...payload };
  for (const [field, wrapper] of [['produtos', 'produto'], ['servicos', 'servico']]) {
    if (Array.isArray(wire[field])) wire[field] = wire[field].map((line: GcRecord) => line[wrapper] || line);
  }
  await request(path, { method: 'PUT', body: JSON.stringify(wire) });
  const reference = { ...current,
    ...(payload.observacoes != null ? { observacoes: payload.observacoes } : {}),
    ...(payload.observacoes_interna != null ? { observacoes_interna: payload.observacoes_interna } : {}),
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const verified = (await request(path))?.data;
    if (!verified || String(verified.id) !== id) throw new Error('Atualização enviada, mas o documento não pôde ser conferido no GestãoClick. Consulte o pedido antes de tentar novamente.');
    assertStatusOnlyChange(reference, verified);
    if (String(verified.situacao_id) === String(status)) return verified as T;
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 900));
  }
  throw new Error('STATUS_NOT_APPLIED');
}
