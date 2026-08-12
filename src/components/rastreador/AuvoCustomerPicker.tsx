import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';

export interface AuvoCustomerSelection {
  id: string;
  name: string;
  origin: 'history' | 'cnpj' | 'manual';
}

interface AuvoCustomerPickerProps {
  gcClienteId: string;
  cnpjDigits: string;
  cnpjFormatted: string;
  loadingClient: boolean;
  hasValidSourceTask: boolean;
  sourceTaskId?: string | null;
  onChange: (selection: AuvoCustomerSelection | null) => void;
}

interface Option {
  id: string;
  name: string;
  origin: 'history' | 'cnpj';
}

export function AuvoCustomerPicker({
  gcClienteId,
  cnpjDigits,
  cnpjFormatted,
  loadingClient,
  hasValidSourceTask,
  sourceTaskId,
  onChange,
}: AuvoCustomerPickerProps) {
  const [resolving, setResolving] = useState(true);
  const [options, setOptions] = useState<Option[]>([]);
  const [source, setSource] = useState<'history' | 'cnpj' | 'manual'>('manual');
  const [selectedId, setSelectedId] = useState<string>('');
  const [manualInput, setManualInput] = useState('');
  const [validation, setValidation] = useState<{ loading: boolean; name?: string; error?: string }>({ loading: false });

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const validateCustomer = useCallback(async (customerId: string, origin: 'history' | 'cnpj' | 'manual') => {
    setValidation({ loading: true });
    onChangeRef.current(null);
    try {
      const { data, error } = await supabase.functions.invoke('auvo-lookup-customer', {
        body: { customer_id: customerId },
      });
      if (error) throw new Error('Falha na consulta ao Auvo');
      if ((data as any)?.error) throw new Error((data as any).error);
      const name = String((data as any)?.name || '');
      setValidation({ loading: false, name });
      onChangeRef.current({ id: String(customerId), name, origin });
    } catch (e: any) {
      setValidation({ loading: false, error: e?.message || 'Erro ao consultar cliente no Auvo' });
      onChangeRef.current(null);
    }
  }, []);

  // Resolution: history -> CNPJ -> manual
  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      if (loadingClient) return;
      setResolving(true);
      setValidation({ loading: false });
      setSelectedId('');
      onChangeRef.current(null);

      let resolved: Option[] = [];
      let resolvedSource: 'history' | 'cnpj' | 'manual' = 'manual';

      // Priority 1 — association history
      if (gcClienteId) {
        const { data } = await (supabase.from('auvo_customer_links') as any)
          .select('auvo_customer_id, auvo_customer_name, usage_count, last_used_at')
          .eq('gc_cliente_id', String(gcClienteId))
          .order('last_used_at', { ascending: false })
          .order('usage_count', { ascending: false });

        const rows = (data as any[]) || [];
        if (rows.length > 0) {
          resolved = rows.map((r) => ({
            id: String(r.auvo_customer_id),
            name: String(r.auvo_customer_name || ''),
            origin: 'history' as const,
          }));
          resolvedSource = 'history';
        }
      }

      // Priority 2 — search Auvo by CNPJ
      if (resolved.length === 0 && cnpjDigits) {
        try {
          const { data, error } = await supabase.functions.invoke('auvo-lookup-customer', {
            body: { action: 'search-by-cnpj', cnpj: cnpjDigits },
          });
          if (!error && Array.isArray((data as any)?.customers)) {
            const customers = (data as any).customers as Array<{ id: string; name: string }>;
            if (customers.length > 0) {
              resolved = customers.map((c) => ({ id: String(c.id), name: String(c.name || ''), origin: 'cnpj' as const }));
              resolvedSource = 'cnpj';
            }
          }
        } catch {
          // fall through to manual
        }
      }

      if (cancelled) return;
      setOptions(resolved);
      setSource(resolvedSource);
      setResolving(false);

      if (resolved.length === 1) {
        setSelectedId(resolved[0].id);
        await validateCustomer(resolved[0].id, resolved[0].origin);
      }
    };

    resolve();
    return () => { cancelled = true; };
  }, [gcClienteId, cnpjDigits, loadingClient, validateCustomer]);

  const selectedOption = useMemo(() => options.find((o) => o.id === selectedId), [options, selectedId]);

  const handleManualLookup = async () => {
    const id = manualInput.trim();
    if (!/^\d+$/.test(id) || Number(id) <= 0) {
      setValidation({ loading: false, error: 'Informe um código de cliente válido.' });
      onChangeRef.current(null);
      return;
    }
    await validateCustomer(id, 'manual');
  };

  const showManual = options.length === 0;

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${hasValidSourceTask ? 'border-border bg-muted/40' : 'border-amber-500/50 bg-amber-500/5'}`}>
      <div className="flex items-center gap-2">
        <AlertTriangle className={`h-4 w-4 ${hasValidSourceTask ? 'text-muted-foreground' : 'text-amber-600'}`} />
        <span className={`text-xs font-semibold ${hasValidSourceTask ? 'text-foreground' : 'text-amber-700'}`}>
          {hasValidSourceTask ? `Tarefa OS de origem detectada (#${sourceTaskId})` : 'Cliente Auvo'}
        </span>
      </div>

      {(resolving || loadingClient) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Procurando associação do cliente no Auvo...
        </div>
      )}

      {!resolving && !loadingClient && (
        <>
          {options.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                {source === 'history'
                  ? (options.length === 1
                    ? 'Associação encontrada no histórico deste cliente.'
                    : 'Este cliente já foi associado a mais de um cadastro Auvo. Selecione qual utilizar.')
                  : (options.length === 1
                    ? 'Cadastro Auvo encontrado pelo CNPJ do cliente.'
                    : 'Mais de um cadastro Auvo com este CNPJ. Selecione qual utilizar.')}
              </p>
              <Select
                value={selectedId}
                onValueChange={(v) => {
                  setSelectedId(v);
                  const opt = options.find((o) => o.id === v);
                  if (opt) validateCustomer(opt.id, opt.origin);
                }}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Selecione o cliente Auvo" />
                </SelectTrigger>
                <SelectContent className="bg-popover z-50">
                  {options.map((o) => (
                    <SelectItem key={o.id} value={o.id} className="text-sm">
                      {o.name || 'Sem nome'} — Código {o.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}

          {showManual && (
            <>
              <p className="text-xs text-muted-foreground">
                <strong>Nenhuma associação encontrada.</strong>{' '}
                {cnpjFormatted
                  ? `Não encontramos histórico para este cliente nem cadastro Auvo com o CNPJ ${cnpjFormatted}.`
                  : 'Não encontramos histórico para este cliente e o CNPJ não está disponível no cadastro do Gestão Click.'}{' '}
                Informe o código do cliente Auvo.
              </p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Código do cliente (Auvo)"
                  value={manualInput}
                  onChange={(e) => { setManualInput(e.target.value); setValidation({ loading: false }); onChangeRef.current(null); }}
                  className="h-8 text-sm flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs px-3"
                  disabled={!manualInput.trim() || validation.loading}
                  onClick={handleManualLookup}
                >
                  {validation.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                  <span className="ml-1">Verificar</span>
                </Button>
              </div>
            </>
          )}

          {validation.loading && options.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Validando cliente no Auvo...
            </div>
          )}

          {validation.name && (
            <div className="flex items-center gap-2 rounded border border-green-500/50 bg-green-500/5 p-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              <span className="text-xs font-medium text-green-700">
                {validation.name} — Código {selectedOption?.id || manualInput.trim()}
              </span>
            </div>
          )}

          {validation.error && (
            <div className="flex items-center gap-2 rounded border border-destructive/50 bg-destructive/5 p-2">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              <span className="text-xs text-destructive">{validation.error}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
