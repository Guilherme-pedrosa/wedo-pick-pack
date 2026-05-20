// Local storage config for the Product Explorer index/filters.
// If a list is empty, the explorer falls back to the keyword-based "open status" heuristic.

export interface ExplorerConfig {
  osSituacaoIds: string[];
  orcSituacaoIds: string[];
  compraSituacaoIds: string[];
}

const STORAGE_KEY = 'wedo-product-explorer-config-v1';

export function getExplorerConfig(): ExplorerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { osSituacaoIds: [], orcSituacaoIds: [], compraSituacaoIds: [] };
    const parsed = JSON.parse(raw);
    return {
      osSituacaoIds: Array.isArray(parsed.osSituacaoIds) ? parsed.osSituacaoIds.map(String) : [],
      orcSituacaoIds: Array.isArray(parsed.orcSituacaoIds) ? parsed.orcSituacaoIds.map(String) : [],
      compraSituacaoIds: Array.isArray(parsed.compraSituacaoIds) ? parsed.compraSituacaoIds.map(String) : [],
    };
  } catch {
    return { osSituacaoIds: [], orcSituacaoIds: [], compraSituacaoIds: [] };
  }
}

export function setExplorerConfig(cfg: ExplorerConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}
