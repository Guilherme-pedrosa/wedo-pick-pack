// Helpers para gerar links clicáveis para o GestãoClick.

/** URL de visualização de um Pedido de Compra no GestãoClick (usa o ID interno). */
export function gcCompraUrl(id: string | number | undefined | null): string | null {
  const raw = String(id ?? '').trim();
  if (!raw) return null;
  return `https://gestaoclick.com/estoque/compras/compras_produtos/visualizar/${raw}`;
}
