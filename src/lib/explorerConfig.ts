// Local storage config for the Product Explorer index/filters.
// If a list is empty, the explorer falls back to the keyword-based "open status" heuristic.

export interface ExplorerConfig {
  osSituacaoIds: string[];
  orcSituacaoIds: string[];
  compraSituacaoIds: string[];
  vendaSituacaoIds: string[];
  /** YYYY-MM-DD — only consider records on/after this date during indexing. Empty = no filter. */
  fromDate: string;
}

const STORAGE_KEY = 'wedo-product-explorer-config-v1';

const EMPTY: ExplorerConfig = {
  osSituacaoIds: [],
  orcSituacaoIds: [],
  compraSituacaoIds: [],
  vendaSituacaoIds: [],
  fromDate: '',
};

export function getExplorerConfig(): ExplorerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return {
      osSituacaoIds: Array.isArray(parsed.osSituacaoIds) ? parsed.osSituacaoIds.map(String) : [],
      orcSituacaoIds: Array.isArray(parsed.orcSituacaoIds) ? parsed.orcSituacaoIds.map(String) : [],
      compraSituacaoIds: Array.isArray(parsed.compraSituacaoIds) ? parsed.compraSituacaoIds.map(String) : [],
      vendaSituacaoIds: Array.isArray(parsed.vendaSituacaoIds) ? parsed.vendaSituacaoIds.map(String) : [],
      fromDate: typeof parsed.fromDate === 'string' ? parsed.fromDate : '',
    };
  } catch {
    return { ...EMPTY };
  }
}

export function setExplorerConfig(cfg: ExplorerConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}
