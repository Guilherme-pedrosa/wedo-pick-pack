import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => {
  const saved=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>saved.get(k)??null,setItem:(k:string,v:string)=>saved.set(k,v),removeItem:(k:string)=>saved.delete(k)}});
  return { getOS: vi.fn(), getVenda: vi.fn(), enrich: vi.fn(), findPartial: vi.fn(), stockGuard: vi.fn(), updateOS: vi.fn(), updateVenda: vi.fn(), confirmPartial: vi.fn(), error: vi.fn(), mobile: false };
});
const product = (id: string, quantity: number) => ({ produto: { produto_id: id, variacao_id: '', nome_produto: `Produto ${id}`, codigo_produto: `COD-${id}`, codigo_barras: '', quantidade: quantity, sigla_unidade: 'UN' } });
const order = (id: string, code: string, quantity=2) => ({ id, codigo: code, cliente_id: 'client', nome_cliente: 'Cliente', situacao_id: 'waiting', nome_situacao: 'PEDIDO EM CONFERENCIA', valor_total: '100', data: '2026-09-11', produtos: [product(id,quantity)] });
const partial = { batchId:'batch',operationId:'operation',budgetCode:'6438',marker:'marker',type:'os' as const,documentId:'partial',documentCode:'10226',clientName:'AMBEV',createdAt:'2026-09-11' };
vi.mock('@/api/gestaoclick', () => ({
  listOS: async () => ({ data: [order('normal','4559')] }), listVendas: async () => ({ data: [order('sale','8000')] }),
  listOSMultiStatus: async () => ({ data: [order('normal','4559')] }), listVendasMultiStatus: async () => ({ data: [order('sale','8000')] }),
  getOS: m.getOS, getVenda: m.getVenda, enrichOrderProducts: m.enrich,
  getStatusOS: async () => [{id:'waiting',nome:'PEDIDO EM CONFERENCIA'},{id:'stock',nome:'PEDIDO CONFERIDO'}],
  getStatusVendas: async () => [{id:'stock',nome:'SEPARADO'}],
  checkStockForOrders: vi.fn(), updateOSStatus:m.updateOS, updateVendaStatus:m.updateVenda,
}));
vi.mock('@/api/partialWriteoff', () => ({ getPartialCheckoutQueue: async () => [partial], findPartialBatchByDocument:m.findPartial, confirmPartialBatch:m.confirmPartial }));
vi.mock('@/api/checkoutStockGuard', () => ({ assertCheckoutStock:m.stockGuard }));
vi.mock('@/api/separations', () => ({ getValidSeparatedOrderIds: async () => new Set(), createSeparation:vi.fn(), snapshotPickingItems:vi.fn() }));
vi.mock('@/lib/systemLog', () => ({ logSystemAction:vi.fn() }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => m.mobile }));
vi.mock('sonner', () => ({ toast:{error:m.error,warning:vi.fn(),info:vi.fn(),success:vi.fn()} }));
import CheckoutPage from '@/pages/CheckoutPage';
import { useCheckoutStore } from '@/store/checkoutStore';
const deferred = <T,>() => { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; };
let clients: QueryClient[]=[];
beforeEach(() => {
  vi.clearAllMocks(); m.mobile=false;
  useCheckoutStore.getState().cancelSession();
  useCheckoutStore.getState().setConfig({osStatusToShow:[],vendaStatusToShow:[],defaultOSConclusionStatus:'stock',defaultVendaConclusionStatus:'stock'});
  m.getOS.mockImplementation(async id => id==='partial' ? order(id,'10226',3) : order(id,'4559'));
  m.getVenda.mockResolvedValue(order('sale','8000'));
  m.findPartial.mockResolvedValue(null); m.enrich.mockImplementation(async products=>products);
  m.stockGuard.mockResolvedValue(order('normal','4559'));
});
afterEach(() => { cleanup(); clients.forEach(c=>c.clear()); clients=[]; });
function show(url='/checkout') { const client=new QueryClient({defaultOptions:{queries:{retry:false}}}); clients.push(client); render(<MemoryRouter initialEntries={[url]}><QueryClientProvider client={client}><CheckoutPage /></QueryClientProvider></MemoryRouter>); }

describe('fila → itens → conferência do Checkout', () => {
  it.each([false, true])('retoma apenas o lote do link da baixa parcial (mobile=%s)', async mobile => {
    m.mobile = mobile; show('/checkout?partialBatch=batch');
    await screen.findByText('Produto partial');
    expect(m.getOS).toHaveBeenCalledExactlyOnceWith('partial');
    expect(useCheckoutStore.getState().session?.partialWriteoff?.batchId).toBe('batch');
    expect(m.stockGuard).not.toHaveBeenCalled();
  });
  it.each([false, true])('preserva outra conferência se cancelar a retomada pelo link (mobile=%s)', async mobile => {
    m.mobile = mobile;
    useCheckoutStore.getState().startSession('os', order('normal','4559'));
    const item = useCheckoutStore.getState().session!.items[0];
    useCheckoutStore.getState().confirmItem(item.id, 1);
    show('/checkout?partialBatch=batch');
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Cancelar')!);
    expect(useCheckoutStore.getState().session?.refId).toBe('normal');
    expect(useCheckoutStore.getState().session?.items[0].qtd_conferida).toBe(1);
    expect(m.getOS).not.toHaveBeenCalled();
  });
  it.each([false,true])('mostra os itens sem esperar códigos ou varredura global (mobile=%s)', async mobile => {
    m.mobile=mobile; const details=deferred<any>(); m.enrich.mockReturnValue(details.promise); show();
    fireEvent.click(await screen.findByText('OS #10226'));
    expect(await screen.findByText('Produto partial')).toBeInTheDocument();
    expect(screen.getByText(/Conferindo os produtos deste pedido/)).toBeInTheDocument();
    expect(useCheckoutStore.getState().session?.partialWriteoff?.batchId).toBe('batch');
    expect(m.getOS).toHaveBeenCalledExactlyOnceWith('partial');
    expect(m.stockGuard).not.toHaveBeenCalled();
    expect(m.enrich).toHaveBeenCalledWith(order('partial','10226',3).produtos,expect.objectContaining({checkStock:true}));
    const item=useCheckoutStore.getState().session!.items[0];
    act(()=>useCheckoutStore.getState().confirmItem(item.id,1));
    await act(async()=>details.resolve([{produto:{...product('partial',999).produto,codigo_barras:'789000',localizacao_fisica:'PR-13 A1'}}]));
    expect(useCheckoutStore.getState().session?.items[0]).toMatchObject({id:item.id,qtd_total:3,qtd_conferida:1,codigo_barras:'789000',localizacao_fisica:'PR-13 A1'});
    expect(useCheckoutStore.getState().session?.rawOrder.produtos[0].produto.quantidade).toBe(3);
    expect(useCheckoutStore.getState().productMetadataLoading).toBe(false);
  });
  it('preserva o vínculo do lote ao trocar uma OS comum por baixa parcial e ignora metadados antigos', async () => {
    const oldDetails=deferred<any>(); m.enrich.mockImplementation(products=>products[0].produto.produto_id==='normal'?oldDetails.promise:Promise.resolve(products)); show();
    fireEvent.click(await screen.findByText('#4559')); await screen.findByText('Produto normal');
    fireEvent.click(screen.getByText('OS #10226')); fireEvent.click(await screen.findByText('Sim, iniciar nova'));
    await screen.findByText('Produto partial');
    expect(useCheckoutStore.getState().session?.partialWriteoff?.batchId).toBe('batch');
    await act(async()=>oldDetails.resolve([{produto:{...product('normal',99).produto,codigo_barras:'WRONG'}}]));
    expect(useCheckoutStore.getState().session?.items[0]).toMatchObject({produto_id:'partial',qtd_total:3,codigo_barras:''});
  });
  it('mantém a conferência anterior quando o novo pedido falha', async () => {
    show(); fireEvent.click(await screen.findByText('#4559')); await screen.findByText('Produto normal');
    m.getOS.mockRejectedValue(new Error('TIMEOUT'));
    fireEvent.click(screen.getByText('OS #10226')); fireEvent.click(await screen.findByText('Sim, iniciar nova'));
    await waitFor(()=>expect(m.error).toHaveBeenCalled());
    expect(useCheckoutStore.getState().session?.refId).toBe('normal');
    expect(screen.queryByText('Carregando itens do pedido…')).not.toBeInTheDocument();
  });
  it('carrega venda e não consulta OS', async () => {
    show(); fireEvent.click(await screen.findByRole('button',{name:'Vendas'})); fireEvent.click(await screen.findByText('#8000'));
    expect(await screen.findByText('Produto sale')).toBeInTheDocument();
    expect(useCheckoutStore.getState().session?.tipo).toBe('venda'); expect(m.getOS).not.toHaveBeenCalled();
  });
  it('continua bloqueando baixa com conflito de estoque na confirmação final', async () => {
    m.stockGuard.mockRejectedValue(new Error('Conflito de estoque')); show();
    fireEvent.click(await screen.findByText('#4559')); await screen.findByText('Produto normal');
    const item=useCheckoutStore.getState().session!.items[0];
    act(()=>useCheckoutStore.getState().confirmItem(item.id,2));
    fireEvent.click(screen.getByRole('button',{name:/Concluir Separação/}));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button',{name:/Confirmar e Atualizar/}));
    await waitFor(()=>expect(m.stockGuard).toHaveBeenCalledOnce());
    expect(m.updateOS).not.toHaveBeenCalled(); expect(m.updateVenda).not.toHaveBeenCalled();
    expect(useCheckoutStore.getState().session?.concludedAt).toBeUndefined();
  });
  it('conclui um lote pelo fluxo parcial, sem cair na atualização comum de OS/venda', async () => {
    show(); fireEvent.click(await screen.findByText('OS #10226')); await screen.findByText('Produto partial');
    const item=useCheckoutStore.getState().session!.items[0];
    act(()=>useCheckoutStore.getState().confirmItem(item.id,3));
    fireEvent.click(screen.getByRole('button',{name:/Concluir Separação/}));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button',{name:/Confirmar e Atualizar/}));
    await waitFor(()=>expect(m.confirmPartial).toHaveBeenCalledExactlyOnceWith('batch'));
    expect(m.updateOS).not.toHaveBeenCalled(); expect(m.updateVenda).not.toHaveBeenCalled();
  });
});
