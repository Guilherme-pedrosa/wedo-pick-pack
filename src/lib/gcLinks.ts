// Helpers para gerar links clicáveis para o GestãoClick.

/** URL de visualização de um Pedido de Compra no GestãoClick (usa o ID interno). */
export function gcCompraUrl(id: string | number | undefined | null): string | null {
  const raw = String(id ?? '').trim();
  if (!raw) return null;
  return `https://gestaoclick.com/estoque/compras/compras_produtos/visualizar/${raw}`;
}

/** URL de visualização de um Orçamento no GestãoClick (usa o ID interno). */
export function gcOrcamentoUrl(id: string | number | undefined | null): string | null {
  const raw = String(id ?? '').trim();
  if (!raw) return null;
  return `https://gestaoclick.com/orcamentos/editar/${raw}`;
}

/** URL de visualização de uma Ordem de Serviço no GestãoClick (usa o ID interno). */
export function gcOsUrl(id: string | number | undefined | null): string | null {
  const raw = String(id ?? '').trim();
  if (!raw) return null;
  return `https://gestaoclick.com/ordens_servicos/editar/${raw}`;
}
