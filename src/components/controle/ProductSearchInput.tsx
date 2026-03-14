import { useState, useRef, useEffect } from "react";
import { Search, Loader2, Barcode, ScanLine } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export interface ProductResult {
  produto_id: string;
  nome: string;
  codigo_interno: string | null;
  codigo_barra: string | null;
  ativo: boolean;
}

interface Props {
  onSelect: (product: ProductResult) => void;
  onScanRequest?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export default function ProductSearchInput({ onSelect, onScanRequest, placeholder, autoFocus }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const search = async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("search-products-index", {
        body: { query: q.trim(), source: "box_add_item" },
      });
      if (error) throw error;
      const items = (data?.data || []) as ProductResult[];
      setResults(items);
      setOpen(items.length > 0);

      // Auto-select if single exact match (barcode/code)
      if (items.length === 1) {
        const item = items[0];
        if (
          item.codigo_barra === q.trim() ||
          item.codigo_interno === q.trim()
        ) {
          handleSelect(item);
          return;
        }
      }
    } catch (e) {
      console.error("Search error:", e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  };

  const handleSelect = (product: ProductResult) => {
    onSelect(product);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && results.length === 1) {
      handleSelect(results[0]);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder={placeholder || "Buscar por nome, código ou barcode..."}
            className="pl-9 pr-8"
            autoFocus={autoFocus}
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
        {onScanRequest && (
          <Button variant="outline" size="icon" onClick={onScanRequest} title="Escanear código de barras">
            <ScanLine className="h-4 w-4" />
          </Button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg max-h-[240px] overflow-y-auto">
          {results.map((item) => (
            <button
              key={item.produto_id}
              className="w-full text-left px-3 py-2 hover:bg-accent/50 transition-colors border-b border-border/50 last:border-0"
              onClick={() => handleSelect(item)}
            >
              <p className="text-sm font-medium text-foreground truncate">{item.nome}</p>
              <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                {item.codigo_interno && <span>Cód: {item.codigo_interno}</span>}
                {item.codigo_barra && (
                  <span className="flex items-center gap-1">
                    <Barcode className="h-3 w-3" />
                    {item.codigo_barra}
                  </span>
                )}
                <span className="text-muted-foreground/60">ID: {item.produto_id}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
