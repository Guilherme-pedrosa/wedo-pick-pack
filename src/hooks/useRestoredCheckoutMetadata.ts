import { useEffect } from 'react';
import { toast } from 'sonner';
import { enrichOrderProducts } from '@/api/gestaoclick';
import { useCheckoutStore } from '@/store/checkoutStore';

/** Continue a metadata read interrupted by reload without restarting picking. */
export function useRestoredCheckoutMetadata() {
  const session = useCheckoutStore(state => state.session);

  useEffect(() => {
    const store = useCheckoutStore.getState();
    const requestId = store.resumeProductMetadata();
    if (!requestId) return; // Normal opening already owns its metadata request.
    const current = useCheckoutStore.getState().session!;

    void enrichOrderProducts(current.rawOrder.produtos, {
      checkStock: String(current.rawOrder.situacao_estoque) !== '1',
      onProgress: products => store.applyProductMetadata(requestId, products, false),
      onStockWarning: message => {
        if (useCheckoutStore.getState().metadataRequestId === requestId) toast.warning(message, { duration: 10000 });
      },
    }).then(
      products => store.applyProductMetadata(requestId, products),
      () => {
        if (useCheckoutStore.getState().metadataRequestId === requestId) {
          store.applyProductMetadata(requestId);
          toast.warning('Conferência preservada, mas não foi possível completar os códigos e localizações.');
        }
      },
    );
  }, [session?.operatorUserId, session?.tipo, session?.refId, session?.startedAt, session?.productMetadataPending]);
}
