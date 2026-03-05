import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCheckoutStore } from '@/store/checkoutStore';
import { getStatusOS, getStatusVendas } from '@/api/gestaoclick';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Eye, EyeOff, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function ConfigPage() {
  const config = useCheckoutStore(s => s.config);
  const setConfig = useCheckoutStore(s => s.setConfig);

  const [accessToken, setAccessToken] = useState(config.accessToken);
  const [secretToken, setSecretToken] = useState(config.secretToken);
  const [showAccess, setShowAccess] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [operatorName, setOperatorName] = useState(config.operatorName);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const [osStatusToShow, setOsStatusToShow] = useState<string[]>(config.osStatusToShow);
  const [vendaStatusToShow, setVendaStatusToShow] = useState<string[]>(config.vendaStatusToShow);
  const [defaultOSStatus, setDefaultOSStatus] = useState(config.defaultOSConclusionStatus);
  const [defaultVendaStatus, setDefaultVendaStatus] = useState(config.defaultVendaConclusionStatus);

  const osStatuses = useQuery({ queryKey: ['statuses', 'os'], queryFn: getStatusOS });
  const vendaStatuses = useQuery({ queryKey: ['statuses', 'venda'], queryFn: getStatusVendas });

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    // Temporarily save tokens
    setConfig({ accessToken, secretToken });
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

  const handleSave = () => {
    setConfig({
      accessToken,
      secretToken,
      operatorName,
      osStatusToShow,
      vendaStatusToShow,
      defaultOSConclusionStatus: defaultOSStatus,
      defaultVendaConclusionStatus: defaultVendaStatus,
    });
    toast.success('Configurações salvas com sucesso!');
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Configurações</h1>

      {/* Credentials */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Credenciais GestãoClick</h2>

        <div className="space-y-2">
          <Label>Access Token</Label>
          <div className="relative">
            <Input
              type={showAccess ? 'text' : 'password'}
              value={accessToken}
              onChange={e => setAccessToken(e.target.value)}
              placeholder="Seu access token"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowAccess(!showAccess)}
            >
              {showAccess ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Secret Token</Label>
          <div className="relative">
            <Input
              type={showSecret ? 'text' : 'password'}
              value={secretToken}
              onChange={e => setSecretToken(e.target.value)}
              placeholder="Seu secret token"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowSecret(!showSecret)}
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">Tokens são salvos no localStorage do navegador</p>

        <Button variant="outline" onClick={handleTestConnection} disabled={testing} className="gap-2">
          🔗 {testing ? 'Testando…' : 'Testar Conexão'}
        </Button>
        {testResult && (
          <div className={`flex items-center gap-2 text-sm ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
            {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {testResult.msg}
          </div>
        )}
      </Card>

      {/* Operator */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Operador</h2>
        <div className="space-y-2">
          <Label>Nome do operador</Label>
          <Input
            value={operatorName}
            onChange={e => setOperatorName(e.target.value)}
            placeholder="Nome que aparecerá nos relatórios"
          />
        </div>
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

      <Button onClick={handleSave} className="w-full" size="lg">
        💾 Salvar Configurações
      </Button>
    </div>
  );
}
