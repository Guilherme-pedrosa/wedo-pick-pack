import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Order, OrderType, PickingItem, PickingSession } from '@/api/types';

interface CheckoutConfig {
  osStatusToShow: string[];
  vendaStatusToShow: string[];
  defaultOSConclusionStatus: string;
  defaultVendaConclusionStatus: string;
  operatorName: string;
  gcUsuarioId: string;
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

function parseGCQuantity(val: string | number): number {
  if (typeof val === 'number') return val;
  const num = parseFloat(val);
  return isNaN(num) ? 0 : num;
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
    qtd_total: parseGCQuantity(p.produto.quantidade),
    qtd_conferida: 0,
    conferido: false,
    localizacao_fisica: p.produto.localizacao_fisica,
    localizacao_rational: p.produto.localizacao_rational,
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
        gcUsuarioId: '',
      },
      startSession: (tipo, order) => {
        // Extract equipment name from OS equipamentos array
        let equipmentName: string | undefined;
        if ('equipamentos' in order && Array.isArray(order.equipamentos) && order.equipamentos.length > 0) {
          equipmentName = order.equipamentos
            .map(e => e.equipamento?.equipamento || '')
            .filter(Boolean)
            .join(', ');
        }

        const session: PickingSession = {
          tipo,
          refId: order.id,
          codigo: order.codigo,
          nomeCliente: order.nome_cliente,
          nomeSituacao: order.nome_situacao,
          situacaoId: order.situacao_id,
          valorTotal: order.valor_total,
          equipmentName: equipmentName || undefined,
          rawOrder: order,
          items: buildItems(order),
          startedAt: new Date().toISOString(),
        };
        set({ session });
      },
      confirmItem: (itemId, qtd = 1) => {
        set((state) => {
          if (!state.session) return state;

          const items = state.session.items;
          const idx = items.findIndex((item) => item.id === itemId);
          if (idx === -1) return state;

          const current = items[idx];
          const remaining = current.qtd_total - current.qtd_conferida;
          const toAdd = Math.min(qtd, remaining);
          const newQtd = current.qtd_conferida + toAdd;

          const updated = {
            ...current,
            qtd_conferida: newQtd,
            conferido: newQtd >= current.qtd_total,
            confirmed_at: newQtd >= current.qtd_total ? new Date().toISOString() : current.confirmed_at,
          };

          const newItems = items.slice();
          newItems[idx] = updated;

          return { session: { ...state.session, items: newItems } };
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
      partialize: (state) => ({
        concludedSessions: state.concludedSessions,
        config: state.config,
      }),
    }
  )
);
