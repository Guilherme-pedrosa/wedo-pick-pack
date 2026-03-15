import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCheckoutStore } from '@/store/checkoutStore';
import { getStatusOS, getStatusVendas, isUsingMock } from '@/api/gestaoclick';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle2, XCircle, Info, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

function AuvoUserIdField() {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('profiles').select('auvo_user_id').eq('id', user.id).maybeSingle();
      setValue((data as any)?.auvo_user_id || '');
      setLoaded(true);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessão expirada');
      await (supabase.from('profiles') as any).update({ auvo_user_id: value || null }).eq('id', user.id);
      toast.success('ID Auvo salvo!');
    } catch { toast.error('Erro ao salvar ID Auvo'); }
    finally { setSaving(false); }
  };

  if (!loaded) return <div className="text-xs text-muted-foreground">Carregando...</div>;

  return (
    <div className="flex gap-2">
      <Input id="auvo-user-id" value={value} onChange={e => setValue(e.target.value)} placeholder="Ex: 12345" className="h-8 text-sm max-w-[200px]" />
      <Button variant="outline" size="sm" onClick={handleSave} disabled={saving} className="gap-1 h-8">
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        Salvar
      </Button>
    </div>
  );
}

export default function ConfigPage() {
  const config = useCheckoutStore(s => s.config);
  const setConfig = useCheckoutStore(s => s.setConfig);

  const [operatorName, setOperatorName] = useState(config.operatorName);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(useCheckoutStore.persist.hasHydrated());

  const [osStatusToShow, setOsStatusToShow] = useState<string[]>(config.osStatusToShow);
  const [vendaStatusToShow, setVendaStatusToShow] = useState<string[]>(config.vendaStatusToShow);
  const [defaultOSStatus, setDefaultOSStatus] = useState(config.defaultOSConclusionStatus);
  const [defaultVendaStatus, setDefaultVendaStatus] = useState(config.defaultVendaConclusionStatus);

  useEffect(() => {
    const unsub = useCheckoutStore.persist.onFinishHydration(() => setHydrated(true));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    setOperatorName(config.operatorName);
    setOsStatusToShow(config.osStatusToShow ?? []);
    setVendaStatusToShow(config.vendaStatusToShow ?? []);
    setDefaultOSStatus(config.defaultOSConclusionStatus ?? '');
    setDefaultVendaStatus(config.defaultVendaConclusionStatus ?? '');
  }, [
    hydrated,
    config.operatorName,
    config.osStatusToShow,
    config.vendaStatusToShow,
    config.defaultOSConclusionStatus,
    config.defaultVendaConclusionStatus,
  ]);

  const osStatuses = useQuery({ queryKey: ['statuses', 'os'], queryFn: getStatusOS });
  const vendaStatuses = useQuery({ queryKey: ['statuses', 'venda'], queryFn: getStatusVendas });

  const mock = isUsingMock();

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const statuses = await getStatusOS();
      setTestResult({ ok: true, msg: `✓ Conexão OK — ${statuses.length} situações encontradas` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setTestResult({ ok: false, msg: `✗ Falha na conexão: ${msg}` });
    } finally {
      setTesting(false);
    }
  };

  const toggleOsStatus = (id: string) => {
    setOsStatusToShow(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const toggleVendaStatus = (id: string) => {
    setVendaStatusToShow(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('AUTH_REQUIRED');

      const payload = {
        os_status_to_show: osStatusToShow,
        venda_status_to_show: vendaStatusToShow,
        default_os_conclusion_status: defaultOSStatus,
        default_venda_conclusion_status: defaultVendaStatus,
      };

      console.log('[ConfigPage] Saving config:', JSON.stringify(payload));

      const { data, error } = await supabase
        .from('profiles')
        .update(payload as never)
        .eq('id', user.id)
        .select('os_status_to_show, venda_status_to_show, default_os_conclusion_status, default_venda_conclusion_status');

      if (error) throw error;

      if (!data || data.length === 0) {
        console.error('[ConfigPage] Update returned no rows — profile may not exist for user', user.id);
        toast.error('Erro: perfil não encontrado. Faça logout e login novamente.');
        return;
      }

      const saved = data[0];
      console.log('[ConfigPage] Saved config confirmed:', JSON.stringify(saved));

      setConfig({
        operatorName,
        osStatusToShow: saved.os_status_to_show ?? [],
        vendaStatusToShow: saved.venda_status_to_show ?? [],
        defaultOSConclusionStatus: saved.default_os_conclusion_status ?? '',
        defaultVendaConclusionStatus: saved.default_venda_conclusion_status ?? '',
      });
      toast.success('Configurações salvas com sucesso!');
    } catch (err: unknown) {
      console.error('[ConfigPage] Save error:', err);
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      if (msg === 'AUTH_REQUIRED') {
        toast.error('Sessão expirada. Faça login novamente.');
      } else {
        toast.error(`Não foi possível salvar: ${msg}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Configurações</h1>

      {/* Connection Status */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Conexão GestãoClick</h2>

        {mock ? (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
            <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-800">Modo demonstração ativo</p>
              <p className="text-amber-700 mt-1">
                As credenciais do GestãoClick são gerenciadas pelo Lovable Cloud.
                Os tokens já estão configurados como secrets no servidor.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-green-800">Credenciais configuradas no Cloud</p>
              <p className="text-green-700 mt-1">
                Os tokens do GestãoClick estão armazenados de forma segura no servidor via Lovable Cloud.
              </p>
            </div>
          </div>
        )}

        <Button variant="outline" onClick={handleTestConnection} disabled={testing || mock} className="gap-2">
          🔗 {testing ? 'Testando…' : 'Testar Conexão'}
        </Button>
        {testResult && (
          <div className={`flex items-center gap-2 text-sm ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
            {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {testResult.msg}
          </div>
        )}
      </Card>

      {/* Operador + Auvo */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Operador</h2>
        <p className="text-sm text-muted-foreground">
          Logado como: <strong>{config.operatorName || '—'}</strong>
        </p>
        <Separator />
        <div>
          <Label htmlFor="auvo-user-id" className="text-sm font-medium">ID Usuário Auvo</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Necessário para gerar tarefas no Auvo a partir do Rastreador. É o userId do seu perfil no Auvo (campo idUserFrom).
          </p>
          <AuvoUserIdField />
        </div>
        <p className="text-xs text-muted-foreground">
          O nome do operador é definido pelo seu perfil de usuário. Para gerenciar usuários, acesse a página de Usuários (somente admins).
        </p>
      </Card>

      {/* Status Configuration */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Configuração de Situações</h2>
        <Tabs defaultValue="os">
          <TabsList className="w-full">
            <TabsTrigger value="os" className="flex-1">Ordens de Serviço</TabsTrigger>
            <TabsTrigger value="venda" className="flex-1">Vendas</TabsTrigger>
          </TabsList>

          <TabsContent value="os" className="space-y-4 mt-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Situações que aparecem na fila de separação</h3>
              <p className="text-xs text-muted-foreground mb-3">Se nenhuma selecionada, todas aparecerão</p>
              <div className="space-y-2">
                {(osStatuses.data || []).map(s => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={osStatusToShow.includes(s.id)}
                      onCheckedChange={() => toggleOsStatus(s.id)}
                    />
                    <span className="text-sm">{s.nome}</span>
                  </label>
                ))}
              </div>
            </div>
            <Separator />
            <div>
              <h3 className="text-sm font-medium mb-2">Status padrão ao concluir separação</h3>
              <RadioGroup value={defaultOSStatus} onValueChange={setDefaultOSStatus}>
                {(osStatuses.data || []).map(s => (
                  <div key={s.id} className="flex items-center gap-2">
                    <RadioGroupItem value={s.id} id={`os-conclusion-${s.id}`} />
                    <Label htmlFor={`os-conclusion-${s.id}`} className="text-sm cursor-pointer">{s.nome}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          </TabsContent>

          <TabsContent value="venda" className="space-y-4 mt-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Situações que aparecem na fila de separação</h3>
              <p className="text-xs text-muted-foreground mb-3">Se nenhuma selecionada, todas aparecerão</p>
              <div className="space-y-2">
                {(vendaStatuses.data || []).map(s => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={vendaStatusToShow.includes(s.id)}
                      onCheckedChange={() => toggleVendaStatus(s.id)}
                    />
                    <span className="text-sm">{s.nome}</span>
                  </label>
                ))}
              </div>
            </div>
            <Separator />
            <div>
              <h3 className="text-sm font-medium mb-2">Status padrão ao concluir separação</h3>
              <RadioGroup value={defaultVendaStatus} onValueChange={setDefaultVendaStatus}>
                {(vendaStatuses.data || []).map(s => (
                  <div key={s.id} className="flex items-center gap-2">
                    <RadioGroupItem value={s.id} id={`venda-conclusion-${s.id}`} />
                    <Label htmlFor={`venda-conclusion-${s.id}`} className="text-sm cursor-pointer">{s.nome}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          </TabsContent>
        </Tabs>
      </Card>

      <Button onClick={handleSave} className="w-full gap-2" size="lg" disabled={saving}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        💾 {saving ? 'Salvando...' : 'Salvar Configurações'}
      </Button>
    </div>
  );
}
