import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getStatusOS, getStatusVendas } from '@/api/gestaoclick';
import { getStatusCompras } from '@/api/compras';
import { logSystemAction } from '@/lib/systemLog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, Play, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { toast } from 'sonner';

interface PolicyConfig {
  id: string;
  lookback_days: number;
  abc_thresholds: { A: number; B: number };
  vendas_stockout_situacao_ids: string[];
  os_stockout_situacao_ids: string[];
  purchase_lt_start_situacao_id: string;
  purchase_arrived_situacao_ids: string[];
  purchase_crossref_situacao_ids: string[];
}

const DEFAULT_CONFIG: Omit<PolicyConfig, 'id'> = {
  lookback_days: 180,
  abc_thresholds: { A: 0.80, B: 0.95 },
  vendas_stockout_situacao_ids: ['7063585'],
  os_stockout_situacao_ids: [],
  purchase_lt_start_situacao_id: '1675083',
  purchase_arrived_situacao_ids: [],
  purchase_crossref_situacao_ids: [],
};

export default function InventoryPolicyPage() {
  const [config, setConfig] = useState<PolicyConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncProgress, setSyncProgress] = useState<any>(null);

   // Last sync date — stored in localStorage since edge function doesn't write to sync_runs
  const [lastSyncDate, setLastSyncDate] = useState<string | null>(() => {
    return localStorage.getItem('last-consumption-sync-date');
  });

  // Load config from DB
  const configQuery = useQuery({
    queryKey: ['inventory-policy-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_policy_config' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data as any[])?.[0] || null;
    },
  });

  useEffect(() => {
    if (configQuery.data) {
      const d = configQuery.data;
      setConfig({
        id: d.id,
        lookback_days: d.lookback_days,
        abc_thresholds: d.abc_thresholds || DEFAULT_CONFIG.abc_thresholds,
        vendas_stockout_situacao_ids: d.vendas_stockout_situacao_ids || [],
        os_stockout_situacao_ids: d.os_stockout_situacao_ids || [],
        purchase_lt_start_situacao_id: d.purchase_lt_start_situacao_id || '1675083',
        purchase_arrived_situacao_ids: d.purchase_arrived_situacao_ids || [],
        purchase_crossref_situacao_ids: d.purchase_crossref_situacao_ids || [],
      });
    }
  }, [configQuery.data]);

  // Load situações
  const osStatuses = useQuery({ queryKey: ['statuses', 'os'], queryFn: getStatusOS });
  const vendaStatuses = useQuery({ queryKey: ['statuses', 'venda'], queryFn: getStatusVendas });
  const compraStatuses = useQuery({ queryKey: ['statuses', 'compra'], queryFn: getStatusCompras });

  const toggleList = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter(s => s !== id) : [...list, id];

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const payload = {
        lookback_days: config.lookback_days,
        abc_thresholds: config.abc_thresholds,
        vendas_stockout_situacao_ids: config.vendas_stockout_situacao_ids,
        os_stockout_situacao_ids: config.os_stockout_situacao_ids,
        purchase_lt_start_situacao_id: config.purchase_lt_start_situacao_id,
        purchase_arrived_situacao_ids: config.purchase_arrived_situacao_ids,
        purchase_crossref_situacao_ids: config.purchase_crossref_situacao_ids,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('inventory_policy_config' as any)
        .update(payload as never)
        .eq('id', config.id);

      if (error) throw error;

      toast.success('Política de estoque salva!');
      logSystemAction({
        module: 'inventory',
        action: 'Política de estoque atualizada',
        details: payload as any,
      });
    } catch (err) {
      toast.error('Erro ao salvar política');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncProgress({ taskIndex: 0, totalTasks: 0, page: 0, totalPages: 0, os_seen: 0, vendas_seen: 0, os_debited: 0, vendas_debited: 0, pecas_created: 0, skipped: 0, errors: 0, status: 'Iniciando...' });
    let cursor: any = null;
    let callCount = 0;

    try {
      while (true) {
        callCount++;
        setSyncProgress((prev: any) => ({ ...prev, status: `Chamada #${callCount} — aguardando resposta...` }));
        
        const { data, error } = await supabase.functions.invoke('inventory-consumption-sync', {
          body: { action: 'sync_page', cursor },
        });
        
        console.log(`[Sync] Call #${callCount} response:`, data, error);
        
        if (error) throw error;

        if (data?.error) {
          setSyncResult({ success: false, error: data.error });
          break;
        }

        if (data?.progress) {
          setSyncProgress({ ...data.progress, status: `Grupo ${data.progress.taskIndex + 1}/${data.progress.totalTasks} · Página ${data.progress.page}/${data.progress.totalPages}` });
        }

        if (data?.retry) {
          setSyncProgress((prev: any) => ({ ...prev, status: 'Rate limit — aguardando 2s...' }));
          await new Promise(r => setTimeout(r, 2000));
          cursor = data.cursor;
          continue;
        }

        if (data?.done) {
          const stats = data.stats || cursor?.stats || {};
          setSyncResult({ success: true, stats, period: data.period || null });
          toast.success(`Sincronização concluída! ${stats.os_debited || 0} OSs + ${stats.vendas_debited || 0} vendas processadas, ${stats.pecas_created || 0} peças.`);
          break;
        }

        cursor = data.cursor;
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      console.error('[Sync] Error:', err);
      toast.error('Erro ao executar sincronização');
      setSyncResult({ success: false, error: err instanceof Error ? err.message : 'Erro desconhecido' });
    } finally {
      setSyncing(false);
    }
  };

  if (configQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <p className="text-muted-foreground">Nenhuma configuração encontrada.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Política de Estoque</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure quais situações representam saída efetiva de estoque
          </p>
        </div>
      </div>

      {/* Situações Tabs */}
      <Card className="p-6">
        <Tabs defaultValue="vendas">
          <TabsList className="w-full">
            <TabsTrigger value="vendas" className="flex-1">Vendas (OUT)</TabsTrigger>
            <TabsTrigger value="os" className="flex-1">OS (OUT)</TabsTrigger>
            <TabsTrigger value="compras" className="flex-1">Compras (Lead Time)</TabsTrigger>
          </TabsList>

          {/* VENDAS */}
          <TabsContent value="vendas" className="space-y-4 mt-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Situações de Venda que dão baixa no estoque</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Documentos nessas situações contam como saída efetiva (consumo)
              </p>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {vendaStatuses.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {(vendaStatuses.data || []).map(s => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={config.vendas_stockout_situacao_ids.includes(s.id)}
                      onCheckedChange={() =>
                        setConfig(c => c ? { ...c, vendas_stockout_situacao_ids: toggleList(c.vendas_stockout_situacao_ids, s.id) } : c)
                      }
                    />
                    <span className="text-sm">{s.nome}</span>
                    <span className="text-xs text-muted-foreground">({s.id})</span>
                  </label>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* OS */}
          <TabsContent value="os" className="space-y-4 mt-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Situações de OS que dão baixa no estoque</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Documentos nessas situações contam como saída efetiva (consumo)
              </p>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {osStatuses.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {(osStatuses.data || []).map(s => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={config.os_stockout_situacao_ids.includes(s.id)}
                      onCheckedChange={() =>
                        setConfig(c => c ? { ...c, os_stockout_situacao_ids: toggleList(c.os_stockout_situacao_ids, s.id) } : c)
                      }
                    />
                    <span className="text-sm">{s.nome}</span>
                    <span className="text-xs text-muted-foreground">({s.id})</span>
                  </label>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* COMPRAS */}
          <TabsContent value="compras" className="space-y-6 mt-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Situação START do Lead Time (quando o pedido foi feito)</h3>
              <p className="text-xs text-muted-foreground mb-3">Default: COMPRADO - AG CHEGADA</p>
              <RadioGroup
                value={config.purchase_lt_start_situacao_id}
                onValueChange={v => setConfig(c => c ? { ...c, purchase_lt_start_situacao_id: v } : c)}
              >
                {(compraStatuses.data || []).map(s => (
                  <div key={s.id} className="flex items-center gap-2">
                    <RadioGroupItem value={s.id} id={`lt-start-${s.id}`} />
                    <Label htmlFor={`lt-start-${s.id}`} className="text-sm cursor-pointer flex items-center gap-2">
                      {s.nome}
                      {s.tipo_lancamento && (
                        <Badge variant="outline" className="text-[10px]">
                          {s.tipo_lancamento === '1' ? 'Est+Fin' : s.tipo_lancamento === '2' ? 'Só Est' : s.tipo_lancamento === '3' ? 'Só Fin' : 'Não lança'}
                        </Badge>
                      )}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-medium mb-2">Situações END (mercadoria chegou / finalizado)</h3>
              <p className="text-xs text-muted-foreground mb-3">Multi-select: quando considerar que a compra foi concluída</p>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {(compraStatuses.data || []).map(s => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={config.purchase_arrived_situacao_ids.includes(s.id)}
                      onCheckedChange={() =>
                        setConfig(c => c ? { ...c, purchase_arrived_situacao_ids: toggleList(c.purchase_arrived_situacao_ids, s.id) } : c)
                      }
                    />
                    <span className="text-sm">{s.nome}</span>
                    {s.tipo_lancamento && (
                      <Badge variant="outline" className="text-[10px]">
                        {s.tipo_lancamento === '1' ? 'Est+Fin' : s.tipo_lancamento === '2' ? 'Só Est' : s.tipo_lancamento === '3' ? 'Só Fin' : 'Não lança'}
                      </Badge>
                    )}
                  </label>
                ))}
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-medium mb-2">🔄 Cruzamento: Pedidos de Compra em Andamento</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Selecione os status que indicam <strong>compra em andamento</strong>. A análise de estoque descontará automaticamente as quantidades desses pedidos da necessidade de compra, evitando compras duplicadas.
              </p>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {(compraStatuses.data || []).map(s => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={config.purchase_crossref_situacao_ids.includes(s.id)}
                      onCheckedChange={() =>
                        setConfig(c => c ? { ...c, purchase_crossref_situacao_ids: toggleList(c.purchase_crossref_situacao_ids, s.id) } : c)
                      }
                    />
                    <span className="text-sm">{s.nome}</span>
                    {s.tipo_lancamento && (
                      <Badge variant="outline" className="text-[10px]">
                        {s.tipo_lancamento === '1' ? 'Est+Fin' : s.tipo_lancamento === '2' ? 'Só Est' : s.tipo_lancamento === '3' ? 'Só Fin' : 'Não lança'}
                      </Badge>
                    )}
                  </label>
                ))}
              </div>
              {config.purchase_crossref_situacao_ids.length > 0 && (
                <p className="text-xs text-primary mt-2 font-medium">
                  ✅ {config.purchase_crossref_situacao_ids.length} situação(ões) selecionada(s)
                </p>
              )}
              {config.purchase_crossref_situacao_ids.length === 0 && (
                <p className="text-xs text-amber-600 mt-2">
                  ⚠️ Nenhuma situação selecionada — o cruzamento com PCs não será feito na análise de estoque
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </Card>

      {/* Parâmetros */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Parâmetros</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label className="text-sm">Lookback (dias)</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={config.lookback_days}
              onChange={e => {
                const val = e.target.value;
                setConfig(c => c ? { ...c, lookback_days: val === '' ? 0 : parseInt(val) } : c);
              }}
              onBlur={() => {
                if (!config.lookback_days || config.lookback_days < 1) {
                  setConfig(c => c ? { ...c, lookback_days: 180 } : c);
                }
              }}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-sm">Limiar A (%)</Label>
            <Input
              type="number"
              step="0.01"
              value={config.abc_thresholds.A}
              onChange={e => setConfig(c => c ? { ...c, abc_thresholds: { ...c.abc_thresholds, A: parseFloat(e.target.value) || 0.8 } } : c)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-sm">Limiar B (%)</Label>
            <Input
              type="number"
              step="0.01"
              value={config.abc_thresholds.B}
              onChange={e => setConfig(c => c ? { ...c, abc_thresholds: { ...c.abc_thresholds, B: parseFloat(e.target.value) || 0.95 } } : c)}
              className="mt-1"
            />
          </div>
        </div>
      </Card>

      {/* Save */}
      <Button onClick={handleSave} className="w-full gap-2" size="lg" disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {saving ? 'Salvando...' : 'Salvar Política'}
      </Button>

      {/* Sync */}
      <Card className="p-6 space-y-4">
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Sincronização de Consumo</h2>
            {lastSyncQuery.data?.finished_at && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                <Clock className="h-3.5 w-3.5" />
                <span>Última sync: {new Date(lastSyncQuery.data.finished_at).toLocaleString('pt-BR')}</span>
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Extrai dados de saída efetiva (Vendas e OS) dos últimos {config.lookback_days} dias.
            O processo é idempotente — rodar múltiplas vezes não duplica dados.
          </p>
        </div>
        <Button onClick={handleSync} disabled={syncing} variant="outline" className="gap-2">
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {syncing ? 'Sincronizando...' : `Sincronizar consumo (${config.lookback_days}d)`}
        </Button>

        {/* Progress indicator */}
        {syncing && syncProgress && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm space-y-2">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="font-medium text-foreground">
                {syncProgress.status || 'Processando...'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs text-muted-foreground">
              <div>OSs: <span className="font-medium text-foreground">{syncProgress.os_seen || 0}</span>{(syncProgress.os_debited > 0) && <span className="text-green-600"> ({syncProgress.os_debited} novas)</span>}</div>
              <div>Vendas: <span className="font-medium text-foreground">{syncProgress.vendas_seen || 0}</span>{(syncProgress.vendas_debited > 0) && <span className="text-green-600"> ({syncProgress.vendas_debited} novas)</span>}</div>
              <div>Peças: <span className="font-medium text-foreground">{syncProgress.pecas_created || 0}</span></div>
              <div>Já processados: <span className="font-medium text-muted-foreground">{syncProgress.skipped || 0}</span></div>
              {syncProgress.errors > 0 && <div>Erros: <span className="font-medium text-destructive">{syncProgress.errors}</span></div>}
            </div>
            {syncProgress.totalPages > 0 && (
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, ((syncProgress.taskIndex * syncProgress.totalPages + syncProgress.page) / (syncProgress.totalTasks * Math.max(syncProgress.totalPages, 1))) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {syncResult && !syncing && (
          <div className={`rounded-lg p-4 text-sm ${syncResult.success ? 'bg-green-50 border border-green-200 dark:bg-green-950/20 dark:border-green-900' : 'bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-900'}`}>
            {syncResult.success ? (
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium text-green-800 dark:text-green-400">Sincronização concluída</p>
                  <p className="text-green-700 dark:text-green-500 mt-1">
                    OSs: {syncResult.stats.os_seen || 0} ({syncResult.stats.os_debited || 0} novas) · 
                    Vendas: {syncResult.stats.vendas_seen || 0} ({syncResult.stats.vendas_debited || 0} novas) · 
                    Peças registradas: {syncResult.stats.pecas_created || 0}
                    {syncResult.stats.errors > 0 && ` · Erros: ${syncResult.stats.errors}`}
                  </p>
                  {syncResult.period && (
                    <p className="text-green-600 dark:text-green-500 text-xs mt-1">
                      Período: {syncResult.period.start} → {syncResult.period.end}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
                <div>
                  <p className="font-medium text-red-800 dark:text-red-400">Erro na sincronização</p>
                  <p className="text-red-700 dark:text-red-500 mt-1">{syncResult.error}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
