/** Venda não precisa ter uma tarefa de serviço anterior. Resolve o cliente
 * pelo documento fiscal exato e exige uma única correspondência no Auvo. */
export async function resolvePartialCustomer(clientId: string, ports: {
  customer(id: string): Promise<any>;
  lookup(document: string): Promise<any[]>;
}): Promise<number> {
  const client = await ports.customer(clientId);
  if (String(client?.id) !== clientId) throw new Error('Cliente GC não confirmado para a tarefa parcial.');
  const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
  const document = digits(client.cnpj || client.cpf || client.cpf_cnpj);
  if (![11,14].includes(document.length)) throw new Error('Cliente GC sem CPF/CNPJ válido para localizar no Auvo.');
  const matches = new Set((await ports.lookup(document))
    .filter(c => digits(c.cnpj || c.cpfCnpj) === document && /^[1-9]\d*$/.test(String(c.id)))
    .map(c => Number(c.id)).filter(Number.isSafeInteger));
  if (matches.size !== 1) throw new Error(matches.size ? 'Há mais de um cliente Auvo com este CPF/CNPJ. Selecione o cadastro correto.' : 'Nenhum cliente Auvo com o mesmo CPF/CNPJ do GC.');
  return [...matches][0];
}
