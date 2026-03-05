import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Order, OrderType, PickingItem, PickingSession } from '@/api/types';

interface CheckoutConfig {
  osStatusToShow: string[];
  vendaStatusToShow: string[];
  defaultOSConclusionStatus: string;
  defaultVendaConclusionStatus: string;
  operatorName: string;
}

interface CheckoutStore {
  session: PickingSession | null;
  concludedSessions: string[];
  config: CheckoutConfig;
  startSession: (tipo: OrderType, order: Order) => void;
  confirmItem: (itemId: string, qtd?: number) => void;
  concludeSession: () => void;
  cancelSession: () => void;
  setConfig: (config: Partial<CheckoutConfig>) => void;
}

function buildItems(order: Order): PickingItem[] {
  return (order.produtos || []).map((p, i) => ({
    id: `${order.id}-${i}-${Date.now()}`,
    produto_id: p.produto.produto_id,
    variacao_id: p.produto.variacao_id,
    nome_produto: p.produto.nome_produto,
    codigo_produto: p.produto.codigo_produto,
    codigo_barras: p.produto.codigo_barras,
    sigla_unidade: p.produto.sigla_unidade,
    qtd_total: p.produto.quantidade,
    qtd_conferida: 0,
    conferido: false,
  }));
}

export const useCheckoutStore = create<CheckoutStore>()(
  persist(
    (set) => ({
      session: null,
      concludedSessions: [],
      config: {
        osStatusToShow: [],
        vendaStatusToShow: [],
        defaultOSConclusionStatus: '',
        defaultVendaConclusionStatus: '',
        operatorName: '',
      },
      startSession: (tipo, order) => {
        const session: PickingSession = {
          tipo,
          refId: order.id,
          codigo: order.codigo,
          nomeCliente: order.nome_cliente,
          nomeSituacao: order.nome_situacao,
          situacaoId: order.situacao_id,
          valorTotal: order.valor_total,
          rawOrder: order,
          items: buildItems(order),
          startedAt: new Date().toISOString(),
        };
        set({ session });
      },
      confirmItem: (itemId, qtd = 1) => {
        set((state) => {
          if (!state.session) return state;
          const items = state.session.items.map((item) => {
            if (item.id !== itemId) return item;
            const remaining = item.qtd_total - item.qtd_conferida;
            const toAdd = Math.min(qtd, remaining);
            const newQtd = item.qtd_conferida + toAdd;
            return {
              ...item,
              qtd_conferida: newQtd,
              conferido: newQtd >= item.qtd_total,
              confirmed_at: newQtd >= item.qtd_total ? new Date().toISOString() : item.confirmed_at,
            };
          });
          return { session: { ...state.session, items } };
        });
      },
      concludeSession: () => {
        set((state) => {
          if (!state.session) return state;
          return {
            session: { ...state.session, concludedAt: new Date().toISOString() },
            concludedSessions: [...state.concludedSessions, state.session.refId],
          };
        });
      },
      cancelSession: () => set({ session: null }),
      setConfig: (partial) => {
        set((state) => ({
          config: { ...state.config, ...partial },
        }));
      },
    }),
    {
      name: 'wedo-checkout-store',
    }
  )
);
