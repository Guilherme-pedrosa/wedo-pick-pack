import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ComprasResult } from '@/api/types';

interface ComprasConfig {
  situacoesOrcamentoSelecionadas: string[];
  situacoesCompraEmAndamento: string[];
}

interface ComprasProgress {
  step: string;
  checked: number;
  total: number;
}

interface OSIndexStatus {
  totalVinculos: number;
  builtAt: number;
  isExpired: boolean;
}

interface ComprasStore {
  result: ComprasResult | null;
  isScanning: boolean;
  progress: ComprasProgress;
  config: ComprasConfig;
  osIndexStatus: OSIndexStatus | null;
  setResult: (r: ComprasResult) => void;
  setScanning: (b: boolean) => void;
  setProgress: (p: ComprasProgress) => void;
  clearResult: () => void;
  setConfig: (c: Partial<ComprasConfig>) => void;
  setOSIndexStatus: (s: OSIndexStatus | null) => void;
}

export const useComprasStore = create<ComprasStore>()(
  persist(
    (set) => ({
      result: null,
      isScanning: false,
      progress: { step: '', checked: 0, total: 0 },
      config: { situacoesOrcamentoSelecionadas: [], situacoesCompraEmAndamento: [] },
      osIndexStatus: null,
      setResult: (r) => set({ result: r }),
      setScanning: (b) => set({ isScanning: b }),
      setProgress: (p) => set({ progress: p }),
      clearResult: () => set({ result: null }),
      setConfig: (c) => set(state => ({ config: { ...state.config, ...c } })),
      setOSIndexStatus: (s) => set({ osIndexStatus: s }),
    }),
    { name: 'wedo-compras-store' }
  )
);
