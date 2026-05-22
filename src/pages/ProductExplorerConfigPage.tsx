import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save, ArrowLeft, Wrench, FileText, ShoppingCart, Receipt, CalendarRange } from 'lucide-react';
import { toast } from 'sonner';
import { getStatusOS, getStatusVendas } from '@/api/gestaoclick';
import { getStatusOrcamentos, getStatusCompras } from '@/api/compras';
import { getExplorerConfig, setExplorerConfig, ExplorerConfig } from '@/lib/explorerConfig';
import { clearExplorerIndex } from '@/api/produtoExplorer';
import { logSystemAction } from '@/lib/systemLog';

interface SitOption { id: string; nome: string }

export default function ProductExplorerConfigPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [osList, setOsList] = useState<SitOption[]>([]);
  const [orcList, setOrcList] = useState<SitOption[]>([]);
  const [compraList, setCompraList] = useState<SitOption[]>([]);
  const [vendaList, setVendaList] = useState<SitOption[]>([]);
  const [cfg, setCfg] = useState<ExplorerConfig>(getExplorerConfig());

  useEffect(() => {
    logSystemAction({ module: 'compras', action: 'Acessou Configuração do Explorador de Peças' });
    const CACHE_KEYS = {
      os: 'wedo-cache-status-os',
      orc: 'wedo-cache-status-orcamentos',
      comp: 'wedo-cache-status-compras',
      vend: 'wedo-cache-status-vendas',
    };
    const readCache = (k: string): SitOption[] => {
      try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : []; } catch { return []; }
    };
    // Hidrata da cache local primeiro para evitar tela vazia
    setOsList(readCache(CACHE_KEYS.os));
    setOrcList(readCache(CACHE_KEYS.orc));
    setCompraList(readCache(CACHE_KEYS.comp));
    setVendaList(readCache(CACHE_KEYS.vend));

    (async () => {
      const results = await Promise.allSettled([
        getStatusOS(),
        getStatusOrcamentos(),
        getStatusCompras(),
        getStatusVendas(),
      ]);
      const [os, orc, comp, vend] = results;
      let anyFail = false;
      const apply = (
        r: PromiseSettledResult<any[]>,
        setter: (v: SitOption[]) => void,
        cacheKey: string,
        label: string,
      ) => {
        if (r.status === 'fulfilled') {
          const mapped = r.value.map((s: any) => ({ id: String(s.id), nome: String(s.nome) }));
          setter(mapped);
          try { localStorage.setItem(cacheKey, JSON.stringify(mapped)); } catch {}
        } else {
          anyFail = true;
          console.warn(`[ExplorerConfig] falha ao carregar ${label}`, r.reason);
        }
      };
      apply(os, setOsList, CACHE_KEYS.os, 'OS');
      apply(orc, setOrcList, CACHE_KEYS.orc, 'Orçamentos');
      apply(comp, setCompraList, CACHE_KEYS.comp, 'Compras');
      apply(vend, setVendaList, CACHE_KEYS.vend, 'Vendas');
      if (anyFail) toast.warning('Algumas situações falharam ao carregar. Usando cache local quando disponível.');
      setLoading(false);
    })();
  }, []);

  function toggle(key: keyof ExplorerConfig, id: string) {
    setCfg(prev => {
      const set = new Set(prev[key]);
      if (set.has(id)) set.delete(id); else set.add(id);
      return { ...prev, [key]: Array.from(set) };
    });
  }

  function selectAll(key: keyof ExplorerConfig, all: SitOption[]) {
    setCfg(prev => ({ ...prev, [key]: all.map(o => o.id) }));
  }
  function clearAll(key: keyof ExplorerConfig) {
    setCfg(prev => ({ ...prev, [key]: [] }));
  }

  function save() {
    setSaving(true);
    try {
      setExplorerConfig(cfg);
      clearExplorerIndex();
      toast.success('Configuração salva. O índice será reconstruído.');
      logSystemAction({
        module: 'compras',
        action: 'Salvou configuração do Explorador de Peças',
        details: {
          os: cfg.osSituacaoIds.length,
          orc: cfg.orcSituacaoIds.length,
          compra: cfg.compraSituacaoIds.length,
          venda: cfg.vendaSituacaoIds.length,
        },
      });
      navigate('/produtos/explorar');
    } catch {
      toast.error('Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link to="/produtos/explorar">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Voltar
              </Button>
            </Link>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Configuração do Explorador
          </h1>
          <p className="text-sm text-muted-foreground">
            Escolha quais situações de OS, Orçamentos e Pedidos de Compra entram no cálculo de demanda e estoque projetado.
            Se nada for marcado em um grupo, o sistema usa as situações abertas padrão.
          </p>
        </div>
        <Button onClick={save} disabled={saving || loading} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarRange className="h-4 w-4" /> Considerar registros a partir de
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <Label htmlFor="fromDate" className="text-xs text-muted-foreground">
                Data inicial (OS, orçamentos, vendas e pedidos de compra com data anterior serão ignorados na sincronização)
              </Label>
              <Input
                id="fromDate"
                type="date"
                value={cfg.fromDate}
                onChange={(e) => setCfg(prev => ({ ...prev, fromDate: e.target.value }))}
                className="mt-1 max-w-xs"
              />
            </div>
            {cfg.fromDate && (
              <Button variant="outline" size="sm" onClick={() => setCfg(prev => ({ ...prev, fromDate: '' }))}>
                Limpar (sem limite)
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando situações…
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SitGroup
            title="Situações de OS"
            icon={<Wrench className="h-4 w-4" />}
            options={osList}
            selected={cfg.osSituacaoIds}
            onToggle={(id) => toggle('osSituacaoIds', id)}
            onAll={() => selectAll('osSituacaoIds', osList)}
            onNone={() => clearAll('osSituacaoIds')}
          />
          <SitGroup
            title="Situações de Orçamentos"
            icon={<FileText className="h-4 w-4" />}
            options={orcList}
            selected={cfg.orcSituacaoIds}
            onToggle={(id) => toggle('orcSituacaoIds', id)}
            onAll={() => selectAll('orcSituacaoIds', orcList)}
            onNone={() => clearAll('orcSituacaoIds')}
          />
          <SitGroup
            title="Situações de Vendas"
            icon={<Receipt className="h-4 w-4" />}
            options={vendaList}
            selected={cfg.vendaSituacaoIds}
            onToggle={(id) => toggle('vendaSituacaoIds', id)}
            onAll={() => selectAll('vendaSituacaoIds', vendaList)}
            onNone={() => clearAll('vendaSituacaoIds')}
          />
          <SitGroup
            title="Situações de Pedidos de Compra"
            icon={<ShoppingCart className="h-4 w-4" />}
            options={compraList}
            selected={cfg.compraSituacaoIds}
            onToggle={(id) => toggle('compraSituacaoIds', id)}
            onAll={() => selectAll('compraSituacaoIds', compraList)}
            onNone={() => clearAll('compraSituacaoIds')}
          />
        </div>
      )}
    </div>
  );
}

function SitGroup({
  title, icon, options, selected, onToggle, onAll, onNone,
}: {
  title: string;
  icon: React.ReactNode;
  options: SitOption[];
  selected: string[];
  onToggle: (id: string) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  const sel = new Set(selected);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {icon} {title}
          <Badge variant="outline" className="ml-auto">{selected.length}/{options.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onAll}>Marcar todas</Button>
          <Button variant="outline" size="sm" onClick={onNone}>Limpar</Button>
        </div>
        <div className="border rounded-md divide-y max-h-96 overflow-y-auto">
          {options.length === 0 && (
            <p className="text-xs text-muted-foreground p-3">Nenhuma situação disponível.</p>
          )}
          {options.map(o => (
            <label
              key={o.id}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 text-sm"
            >
              <Checkbox checked={sel.has(o.id)} onCheckedChange={() => onToggle(o.id)} />
              <span className="flex-1">{o.nome}</span>
              <span className="text-xs text-muted-foreground">#{o.id}</span>
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
