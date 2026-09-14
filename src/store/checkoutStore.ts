import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Order, OrderType, PickingItem, PickingSession } from '@/api/types';

interface CheckoutConfig {
  operatorUserId: string;
  osStatusToShow: string[];
  vendaStatusToShow: string[];
  defaultOSConclusionStatus: string;
  defaultVendaConclusionStatus: string;
  operatorName: string;
  gcUsuarioId: string;
}

interface CheckoutStore {
  sessionsByUser: Record<string, PickingSession | null>;
  session: PickingSession | null;
  productMetadataLoading: boolean;
  metadataRequestId: string | null;
  concludedSessions: string[];
  config: CheckoutConfig;
  startSession: (tipo: OrderType, order: Order, partialWriteoff?: PickingSession['partialWriteoff']) => string;
  resumeProductMetadata: () => string | null;
  applyProductMetadata: (requestId: string, products?: Order['produtos'], complete?: boolean) => void;
  confirmItem: (itemId: string, qtd?: number) => void;
  concludeSession: () => void;
  recordGCConfirmation: (confirmation: NonNullable<PickingSession['gcConfirmation']>) => void;
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
    (set, get) => ({
      session: null,
      sessionsByUser: {},
      productMetadataLoading: false,
      metadataRequestId: null,
      concludedSessions: [],
      config: {
        operatorUserId: '',
        osStatusToShow: [],
        vendaStatusToShow: [],
        defaultOSConclusionStatus: '',
        defaultVendaConclusionStatus: '',
        operatorName: '',
        gcUsuarioId: '',
      },
      startSession: (tipo, order, partialWriteoff) => {
        if (get().session?.gcConfirmation && !get().session?.concludedAt) throw new Error('Salve o histórico da separação já confirmada antes de abrir outro pedido.');
        // Extract equipment name from OS equipamentos array
        let equipmentName: string | undefined;
        if ('equipamentos' in order && Array.isArray(order.equipamentos) && order.equipamentos.length > 0) {
          equipmentName = order.equipamentos
            .map(e => e.equipamento?.equipamento || '')
            .filter(Boolean)
            .join(', ');
        }

        const session: PickingSession = {
          operatorUserId: get().config.operatorUserId,
          productMetadataPending: true,
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
          partialWriteoff,
        };
        const metadataRequestId = crypto.randomUUID();
        set({ session, productMetadataLoading: true, metadataRequestId });
        return metadataRequestId;
      },
      resumeProductMetadata: () => {
        const { session, metadataRequestId } = get();
        if (!session || session.concludedAt || session.gcConfirmation || metadataRequestId || session.productMetadataPending === false) return null;
        // Old persisted sessions have no marker. Refresh their metadata once;
        // claiming the request synchronously also prevents StrictMode repeats.
        const requestId = crypto.randomUUID();
        set({ session: { ...session, productMetadataPending: true }, productMetadataLoading: true, metadataRequestId: requestId });
        return requestId;
      },
      applyProductMetadata: (requestId, products, complete = true) => {
        set(state => {
          if (!state.session || state.metadataRequestId !== requestId) return state;
          const items = state.session.items.map((item, index) => {
            const product = products?.[index]?.produto;
            if (!product || product.produto_id !== item.produto_id || product.variacao_id !== item.variacao_id) return item;
            return { ...item,
              codigo_produto: product.codigo_produto || item.codigo_produto,
              codigo_barras: product.codigo_barras || item.codigo_barras,
              localizacao_fisica: product.localizacao_fisica || item.localizacao_fisica,
              localizacao_rational: product.localizacao_rational || item.localizacao_rational,
            };
          });
          // Preserve scanned quantities, item IDs and the original GC document.
          return { session: { ...state.session, items, productMetadataPending: !complete }, productMetadataLoading: !complete, metadataRequestId: complete ? null : requestId };
        });
      },
      confirmItem: (itemId, qtd = 1) => {
        set((state) => {
          if (!state.session || state.session.concludedAt || state.session.gcConfirmation || !Number.isFinite(qtd) || qtd <= 0) return state;

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
      recordGCConfirmation: confirmation => set(state => state.session ? { session: { ...state.session, gcConfirmation: confirmation } } : state),
      cancelSession: () => set(state => state.session?.gcConfirmation && !state.session.concludedAt ? state : { session: null, productMetadataLoading: false, metadataRequestId: null }),
      setConfig: (partial) => {
        set(state => {
          const config = { ...state.config, ...partial };
          if (partial.operatorUserId && partial.operatorUserId !== state.config.operatorUserId) {
            const sessionsByUser = { ...state.sessionsByUser };
            if (state.config.operatorUserId) sessionsByUser[state.config.operatorUserId] = state.session;
            return { config, sessionsByUser, session: sessionsByUser[partial.operatorUserId] || null, productMetadataLoading: false, metadataRequestId: null };
          }
          return { config };
        });
      },
    }),
    {
      name: 'wedo-checkout-store',
      partialize: (state) => ({
        session: state.session,
        sessionsByUser: state.sessionsByUser,
        concludedSessions: state.concludedSessions,
        config: state.config,
      }),
    }
  )
);
