import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ProductResult } from '@/components/controle/ProductSearchInput';

/**
 * O diálogo depende da busca no índice de produtos e da API do GestãoClick.
 * Aqui os dois viram dublês: o que importa testar é o comportamento da lista
 * — item escolhido fica fixo, escolher de novo soma em vez de duplicar, e a
 * quantidade de cada linha vira o número de páginas do PDF.
 */

const selecionar = vi.fn<(p: ProductResult) => void>();

vi.mock('@/components/controle/ProductSearchInput', () => ({
  default: ({ onSelect }: { onSelect: (p: ProductResult) => void }) => {
    selecionar.mockImplementation(onSelect);
    return <div data-testid="busca" />;
  },
}));

const enrich = vi.fn();
vi.mock('@/api/gestaoclick', () => ({
  enrichOrderProducts: (itens: unknown[]) => enrich(itens),
}));

const build = vi.fn((_itens: unknown[]) => ({ save: vi.fn() }));
vi.mock('@/lib/etiquetaPdf', () => ({
  buildEtiquetasPdf: (itens: unknown[]) => build(itens),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const { default: EtiquetaAvulsaDialog } = await import('./EtiquetaAvulsaDialog');

const peca = (id: string, nome: string, codigo: string): ProductResult => ({
  produto_id: id,
  nome,
  codigo_interno: codigo,
  codigo_barra: null,
  ativo: true,
});

beforeEach(() => {
  enrich.mockReset();
  build.mockReset().mockReturnValue({ save: vi.fn() });
  // O enriquecimento devolve a mesma lista, com endereço vindo do GC.
  enrich.mockImplementation((itens: Array<{ produto: Record<string, unknown> }>) =>
    Promise.resolve(
      itens.map(({ produto }) => ({ produto: { ...produto, localizacao_fisica: 'E3-P2' } })),
    ),
  );
});

describe('EtiquetaAvulsaDialog', () => {
  it('mantém na lista cada peça escolhida, e vai acumulando', () => {
    render(<EtiquetaAvulsaDialog open onOpenChange={() => {}} />);
    expect(screen.getByText('Nenhuma peça escolhida ainda.')).toBeInTheDocument();

    act(() => selecionar(peca('1', 'TUBO DO DRENO UNOX', '124654')));
    act(() => selecionar(peca('2', 'JUNTA DE ENTRADA DE AR', 'KGN1544A')));

    expect(screen.getByText('TUBO DO DRENO UNOX')).toBeInTheDocument();
    expect(screen.getByText('JUNTA DE ENTRADA DE AR')).toBeInTheDocument();
    expect(screen.getByText('2 peça(s) · 2 etiqueta(s)')).toBeInTheDocument();
  });

  it('escolher a mesma peça de novo soma uma etiqueta em vez de duplicar a linha', () => {
    render(<EtiquetaAvulsaDialog open onOpenChange={() => {}} />);
    act(() => selecionar(peca('1', 'TUBO DO DRENO UNOX', '124654')));
    act(() => selecionar(peca('1', 'TUBO DO DRENO UNOX', '124654')));

    expect(screen.getAllByText('TUBO DO DRENO UNOX')).toHaveLength(1);
    expect(screen.getByText('1 peça(s) · 2 etiqueta(s)')).toBeInTheDocument();
  });

  it('recusa peça sem código — sem código não há código de barras', () => {
    render(<EtiquetaAvulsaDialog open onOpenChange={() => {}} />);
    act(() => selecionar({ produto_id: '9', nome: 'PECA SEM CODIGO', codigo_interno: null, codigo_barra: null, ativo: true }));
    expect(screen.getByText('Nenhuma peça escolhida ainda.')).toBeInTheDocument();
  });

  it('a quantidade de cada linha vira o número de cópias no PDF', async () => {
    render(<EtiquetaAvulsaDialog open onOpenChange={() => {}} />);
    act(() => selecionar(peca('1', 'TUBO DO DRENO UNOX', '124654')));

    fireEvent.change(screen.getByLabelText('Qtd'), { target: { value: '5' } });
    expect(screen.getByText('1 peça(s) · 5 etiqueta(s)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Imprimir/ }));

    await waitFor(() => expect(build).toHaveBeenCalled());
    const etiquetas = build.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(etiquetas).toHaveLength(1);
    expect(etiquetas[0]).toMatchObject({
      codigo: '124654',
      barcodeValue: '124654',
      localizacao: 'E3-P2',
      copies: 5,
    });
  });

  it('quantidade inválida não zera a lista nem gera PDF vazio', () => {
    render(<EtiquetaAvulsaDialog open onOpenChange={() => {}} />);
    act(() => selecionar(peca('1', 'TUBO DO DRENO UNOX', '124654')));

    fireEvent.change(screen.getByLabelText('Qtd'), { target: { value: '0' } });
    expect(screen.getByText('1 peça(s) · 1 etiqueta(s)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Qtd'), { target: { value: 'abc' } });
    expect(screen.getByText('1 peça(s) · 1 etiqueta(s)')).toBeInTheDocument();
  });

  it('remove a peça da lista', () => {
    render(<EtiquetaAvulsaDialog open onOpenChange={() => {}} />);
    act(() => selecionar(peca('1', 'TUBO DO DRENO UNOX', '124654')));
    fireEvent.click(screen.getByRole('button', { name: 'Remover TUBO DO DRENO UNOX' }));
    expect(screen.getByText('Nenhuma peça escolhida ainda.')).toBeInTheDocument();
  });
});
