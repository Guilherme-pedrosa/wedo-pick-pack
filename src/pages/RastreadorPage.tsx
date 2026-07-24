import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStatusOrcamentos, getStatusCompras } from '@/api/compras';
import { getStatusOS } from '@/api/gestaoclick';
import { rastrearOrcamentos, RastreadorResult, OrcamentoReadiness, ConflictInfo, OSReservedInfo } from '@/api/rastreador';
import { OrcamentoConvertidoWarning } from '@/api/types';
import { GCOrcamento } from '@/api/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import {
  Search, Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight,
  PackageCheck, Clock, RefreshCw, Download, Printer, User, Filter, Ban, X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { logSystemAction } from '@/lib/systemLog';
import { gcCompraUrl } from '@/lib/gcLinks';

type OrdemCompraRef = { id: string; codigo: string; qtd: number; nome_fornecedor: string; situacao: string };

/** Renderiza as ordens de compra como links clicÃ¡veis para o GestÃ£oClick. */
function OrdensCompraLinks({ ordens }: { ordens?: OrdemCompraRef[] }) {
  if (!ordens || ordens.length === 0) return null;
  return (
    <>
      {ordens.map((o, i) => {
        const url = gcCompraUrl(o.id);
        const label = `#${o.codigo} ${o.nome_fornecedor} [${o.situacao}] Ã—${formatQty(o.qtd)}`;
        return (
          <span key={o.id || o.codigo}>
            {i > 0 && ' â€¢ '}
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-primary"
                onClick={(e) => e.stopPropagation()}
              >
                {label}
              </a>
            ) : label}
          </span>
        );
      })}
    </>
  );
}

function exportCSV(result: RastreadorResult) {
  const header = [
    'Status', 'Grupo', 'CÃ³digo Produto', 'Produto', 'Quantidade', 'Qtd em Saldo', 'Qtd Comprometida',
    'NÂº OrÃ§amento', 'Cliente', 'NÂº OS', 'SituaÃ§Ã£o OS',
    'Qtd em Compra', 'NÂº Pedido(s) Compra', 'Fornecedor(es)', 'SituaÃ§Ã£o(Ãµes) PC',
  ];
  const rows: string[][] = [];

  const pushItems = (
    status: string,
    orcCodigo: string,
    cliente: string,
    osCodigo: string,
    osSituacao: string,
    itens: OrcamentoReadiness['itens'] | undefined,
  ) => {
    if (!itens || itens.length === 0) return;
    for (const item of itens) {
      const ordens = item.ordens_compra || [];
      rows.push([
        status,
        item.grupo || '',
        item.codigo_produto || '',
        item.nome_produto,
        String(item.qtd_necessaria).replace('.', ','),
        String(item.estoque_disponivel).replace('.', ','),
        String(item.qtd_comprometida ?? item.qtd_necessaria).replace('.', ','),
        orcCodigo,
        cliente,
        osCodigo,
        osSituacao,
        String(item.qtd_em_compra || 0).replace('.', ','),
        ordens.map(o => o.codigo).join(' | '),
        ordens.map(o => o.nome_fornecedor).join(' | '),
        ordens.map(o => o.situacao).join(' | '),
      ]);
    }
  };

  for (const e of result.orcamentosProntos) {
    pushItems('Pronto p/ OS', e.orcamento.codigo, e.orcamento.nome_cliente, '', '', e.itens);
  }
  for (const e of result.orcamentosPendentes) {
    const osCod = e.osLinked?.os_codigo || '';
    const osSit = e.osLinked?.nome_situacao || '';
    pushItems('Aguardando peÃ§as', e.orcamento.codigo, e.orcamento.nome_cliente, osCod, osSit, e.itens);
  }
  for (const b of result.orcamentosBloqueados || []) {
    pushItems('JÃ¡ Ã© OS', b.codigo, b.nome_cliente, b.link_number || '', b.link_situacao || '', b.itens as OrcamentoReadiness['itens'] | undefined);
  }

  const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rastreador-orcamentos-${result.scannedAt.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatDateBR(d: string) {
  try { const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; } catch { return d; }
}

function formatQty(value: number | undefined): string {
  const n = Number(value ?? 0);
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatGenerationError(message: string): string {
  const compact = String(message || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (/Auvo/i.test(compact) && /(?:502|503|504|Bad Gateway|gateway|proxy|invalid response)/i.test(compact)) {
    return 'O Auvo estÃ¡ instÃ¡vel no momento. A OS/Venda NÃƒO foi gerada. Tente novamente em alguns instantes.';
  }
  if (/Gest[aÃ£]oClick|GC/i.test(compact) && /(?:502|503|504|Bad Gateway|gateway|proxy)/i.test(compact)) {
    return 'O GestÃ£oClick estÃ¡ instÃ¡vel no momento. A OS/Venda NÃƒO foi gerada. Tente novamente em alguns instantes.';
  }
  if (/<!DOCTYPE|<html|Server Error|Full response/i.test(message)) {
    return 'A integraÃ§Ã£o retornou uma resposta invÃ¡lida. A OS/Venda NÃƒO foi gerada. Tente novamente em alguns instantes.';
  }
  return compact || 'Erro desconhecido na geraÃ§Ã£o. A OS/Venda NÃƒO foi gerada.';
}

export default function RastreadorPage() {
  const [selectedSituacoes, setSelectedSituacoes] = useState<string[]>([]);
  const [selectedSituacoesCompra, setSelectedSituacoesCompra] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('rastreador-situacoes-compra') || '[]'); } catch { return []; }
  });
  // OS situations to IGNORE (not treat as blocked). Empty = all OS-linked budgets blocked.
  // Versioned key (v2) â€” semÃ¢ntica mudou, valores antigos da chave v1 sÃ£o descartados.
  const [selectedSituacoesOS, setSelectedSituacoesOS] = useState<string[]>(() => {
    try {
      // Limpa chave antiga (semÃ¢ntica invertida)
      localStorage.removeItem('rastreador-situacoes-os');
      const raw = localStorage.getItem('rastreador-situacoes-os-ignore-v2');
      if (raw == null) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  const [nomeCliente, setNomeCliente] = useState('');
  const [dataInicio, setDataInicio] = useState<string>(() => {
    // default: 90 days back
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  });
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ step: '', checked: 0, total: 0 });
  const [result, setResult] = useState<RastreadorResult | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPrintView, setIsPrintView] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [blockedExpanded, setBlockedExpanded] = useState(true);

  // OS generation state
  const [generatingOS, setGeneratingOS] = useState(false);
  const [confirmEntry, setConfirmEntry] = useState<OrcamentoReadiness | null>(null);
  const [auvoCustomerIdInput, setAuvoCustomerIdInput] = useState('');
  const [auvoCustomerLookup, setAuvoCustomerLookup] = useState<{ loading: boolean; name?: string; error?: string }>({ loading: false });
  const [manualEquipamento, setManualEquipamento] = useState('');
  const [generatedOrcIds, setGeneratedOrcIds] = useState<Set<string>>(new Set());
  const [generationResult, setGenerationResult] = useState<{
    success: boolean;
    auvoTaskId?: number | string;
    osCodigo?: string;
    error?: string;
    duplicate?: boolean;
  } | null>(null);

  const handleGenerateOS = async (entry: OrcamentoReadiness) => {
    setGeneratingOS(true);
    setGenerationResult(null);
    try {
      // Get current user profile for auvo_user_id and gc_usuario_id
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('SessÃ£o expirada');

      const { data: profile } = await supabase
        .from('profiles')
        .select('auvo_user_id, gc_usuario_id, name')
        .eq('id', user.id)
        .maybeSingle();

      const auvoUserId = (profile as any)?.auvo_user_id;
      if (!auvoUserId) {
        toast.error('Configure seu ID de UsuÃ¡rio Auvo nas ConfiguraÃ§Ãµes antes de gerar OS.');
        setConfirmEntry(null);
        setGeneratingOS(false);
        return;
      }

      // Cliente Ã© sempre obrigatÃ³rio: ou vem de uma tarefa OS vÃ¡lida, ou vem de ID informado e verificado
      const sourceTaskId = getSourceTaskOsId(entry.orcamento);
      const hasValidSourceTask = parsePositiveInt(sourceTaskId) !== null;
      const typedCustomerId = parsePositiveInt(auvoCustomerIdInput);

      if (!hasValidSourceTask && !typedCustomerId) {
        toast.error('Informe um cÃ³digo de cliente Auvo vÃ¡lido antes de gerar a OS.');
        setGeneratingOS(false);
        return;
      }

      if (!hasValidSourceTask && !auvoCustomerLookup.name) {
        toast.error('Clique em "Verificar" para validar o cliente Auvo antes de confirmar.');
        setGeneratingOS(false);
        return;
      }

      // Equipment is optional (warning only, not blocking)
      const equipFromOrc = getEquipamento(entry.orcamento);

      const bodyPayload: Record<string, unknown> = {
        orcamento: entry.orcamento,
        auvo_user_id: auvoUserId,
        gc_usuario_id: (profile as any)?.gc_usuario_id || undefined,
      };

      // Sempre manda fallback de cliente se digitado; backend usa sÃ³ se necessÃ¡rio
      if (typedCustomerId) {
        bodyPayload.auvo_customer_id = typedCustomerId;
      }

      // If equipment was manually provided, include it
      if (!equipFromOrc && manualEquipamento.trim()) {
        bodyPayload.manual_equipamento = manualEquipamento.trim();
      }

      const { data, error } = await supabase.functions.invoke('generate-os', {
        body: bodyPayload,
      });

      // Handle 409 duplicate from edge function (non-2xx returns error object)
      if (error) {
        // Try to parse the response body for duplicate info
        let errorBody: any = null;
        try {
          if (error.context?.body) {
            const reader = error.context.body.getReader?.();
            if (reader) {
              const { value } = await reader.read();
              errorBody = JSON.parse(new TextDecoder().decode(value));
            }
          }
        } catch { /* ignore parse errors */ }

        if (!errorBody) errorBody = data;

        if (errorBody?.duplicate) {
          setGenerationResult({
            success: false,
            error: errorBody.error,
            osCodigo: errorBody.existing?.os_codigo,
            auvoTaskId: errorBody.existing?.auvo_task_id,
            duplicate: true,
          });
          toast.error(errorBody.error);
          return;
        }
        throw new Error(errorBody?.error || error.message);
      }
      if (data?.duplicate) {
        setGenerationResult({
          success: false,
          error: data.error,
          osCodigo: data.existing?.os_codigo,
          auvoTaskId: data.existing?.auvo_task_id,
          duplicate: true,
        });
        toast.error(data.error);
        return;
      }
      if (data?.error) throw new Error(data.error);

      setGenerationResult({
        success: true,
        auvoTaskId: data.auvo_task_id,
        osCodigo: data.os_codigo,
      });
      setGeneratedOrcIds(prev => new Set(prev).add(entry.orcamento.id));

      // Log successful generation
      await (supabase.from("os_generation_logs") as any).insert({
        orcamento_codigo: entry.orcamento.codigo,
        orcamento_id: entry.orcamento.id,
        nome_cliente: entry.orcamento.nome_cliente,
        os_id: String(data.os_id || ''),
        os_codigo: String(data.os_codigo || ''),
        auvo_task_id: String(data.auvo_task_id || ''),
        operator_id: user!.id,
        operator_name: (profile as any)?.name || user!.email || '',
        valor_total: Number(entry.orcamento.valor_total || 0),
        equipamento: getEquipamento(entry.orcamento) || null,
        warnings: data.warnings || null,
        success: true,
      });

      const docLabel = data.doc_kind === 'venda' ? 'Venda' : 'OS';
      logSystemAction({ module: "rastreador", action: `${docLabel} gerada`, entityType: docLabel, entityId: String(data.os_id || ''), entityName: `${docLabel} #${data.os_codigo} - ${entry.orcamento.nome_cliente}`, details: { orcamento_codigo: entry.orcamento.codigo, auvo_task_id: data.auvo_task_id, doc_kind: data.doc_kind } });
      toast.success(`${docLabel} #${data.os_codigo} criada com sucesso! Tarefa Auvo: ${data.auvo_task_id}`);
      if (data.warnings?.length) {
        for (const w of data.warnings) {
          toast.warning(w, { duration: 8000 });
        }
      }
    } catch (err) {
      const msg = formatGenerationError(err instanceof Error ? err.message : 'Erro desconhecido');
      setGenerationResult({ success: false, error: msg });

      // Log failed generation
      const { data: { user: failUser } } = await supabase.auth.getUser();
      if (failUser) {
        await (supabase.from("os_generation_logs") as any).insert({
          orcamento_codigo: entry.orcamento.codigo,
          orcamento_id: entry.orcamento.id,
          nome_cliente: entry.orcamento.nome_cliente,
          operator_id: failUser.id,
          operator_name: failUser.email || '',
          valor_total: Number(entry.orcamento.valor_total || 0),
          equipamento: getEquipamento(entry.orcamento) || null,
          error_message: msg,
          success: false,
        });
      }

      toast.error(`Erro ao gerar OS: ${msg}`);
    } finally {
      setGeneratingOS(false);
    }
  };

  const statusQuery = useQuery({
    queryKey: ['status-orcamentos'],
    queryFn: getStatusOrcamentos,
  });

  const statusCompraQuery = useQuery({
    queryKey: ['status-compras'],
    queryFn: getStatusCompras,
  ×uöÚ$z{-®éÜj×¶—4õ2ò	ùJrr¢	ù8²wÒ¶—4õ2òòæ6öF–vò¢2G¶òæ6öF–v÷ÖÒ(	B¶òææöÖUö6Æ–VçFWÒ(	B&V6—6¶òçFGĞĞ¢¶—4õ2bbÇ7â6Æ74æÖSÒ'FW‡BÕ³…ÒÖÂÓ#â‡&W6W'fFòÂ6VÒÖ÷bâW7F÷VR“Â÷7ãçĞĞ¢ÂöF—càĞ¢“°Ğ¢Ò—ĞĞ¢ÂöF—càĞ¢ÆF—b6Æ74æÖSÒ&×BÓ"FW‡B×‡2#àĞ¢²†2çFEöVÕö6ö×&óò’âò€Ğ¢Ç7â6Æ74æÖSÒ'FW‡BÖ&ÇVRÓc#àĞ¢	ù¹"VÒ6ö×&¢Ç7G&öæsç¶f÷&ÖEG’†2çFEöVÕö6ö×&—ÓÂ÷7G&öæsàĞ¢¶2æ÷&FVç5ö6ö×&bb2æ÷&FVç5ö6ö×&æÆVæwF‚âbb€Ğ¢Ç7â6Æ74æÖSÒ'FW‡BÖ×WFVBÖf÷&Vw&÷VæBÖÂÓ#àĞ¢ƒÄ÷&FVç46ö×&Æ–æ·2÷&FVç3×¶2æ÷&FVç5ö6ö×&ÒóâĞ¢Â÷7ãàĞ¢—ĞĞ¢²‚‚’Óâ°Ğ¢6öç7BfÇFÒ2æFVÖæF÷F÷FÂÒ2æW7F÷VU÷F÷FÃ°Ğ¢6öç7B6ö'&RÒ†2çFEöVÕö6ö×&óò’ãÒfÇF°Ğ¢&WGW&â6ö'&PĞ¢òÇ7â6Æ74æÖSÒ&ÖÂÓFW‡BÖw&VVâÓcföçBÖÖVF—VÒ#î)É26ö'&RfÇFFR¶f÷&ÖEG’†fÇF—ÓÂ÷7ãàĞ¢¢Ç7â6Æ74æÖSÒ&ÖÂÓFW‡B×&VBÓSföçBÖÖVF—VÒ#î)Ér6ö'&R<;2¶f÷&ÖEG’†2çFEöVÕö6ö×&—Ò÷¶f÷&ÖEG’†fÇF—ÓÂ÷7ãã°Ğ¢Ò’‚—ĞĞ¢Â÷7ãàĞ¢’¢€Ğ¢6VÆV7FVE6—GV6öW46ö×&æÆVæwF‚â Ğ¢òÇ7â6Æ74æÖSÒ'FW‡B×&VBÓSföçBÖÖVF—VÒ#î)¹B6VÒVF–FòFR6ö×&æ÷27FGW26VÆV6–öæF÷3Â÷7ãàĞ¢¢Ç7â6Æ74æÖSÒ'FW‡BÖ×WFVBÖf÷&Vw&÷VæB—FÆ–2#å6VÆV6–öæR7FGW2FR2æ÷2f–ÇG&÷2&fW"6ö&W'GW&Â÷7ãàĞ¢—ĞĞ¢ÂöF—càĞ¢Âô6&CàĞ¢’—ĞĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂóàĞ¢—ĞĞ Ğ¢Å6W&F÷"óàĞ Ğ¢²ò¢VæF–ær'VFvWG2¢÷ĞĞ¢·&W7VÇBæ÷&6ÖVçF÷5VæFVçFW2æÆVæwF‚âbb€Ğ¢ÆF—b6Æ74æÖSÒ'76R×’Ó"#àĞ¢ÆF—b6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓ"#àĞ¢Ä6Æö6²6Æ74æÖSÒ&‚ÓBrÓBFW‡BÖÖ&W"Óc"óàĞ¢Æƒ"6Æ74æÖSÒ'FW‡B×6ÒföçBÖ&öÆBFW‡BÖf÷&Vw&÷VæB#àĞ¢wV&FæFò\:v2‡·&W7VÇBæ÷&6ÖVçF÷5VæFVçFW2æÆVæwF‡ÒĞ¢Âöƒ#àĞ¢ÂöF—càĞ¢ÆF—b6Æ74æÖSÒ'76R×’Ó"#àĞ¢·&W7VÇBæ÷&6ÖVçF÷5VæFVçFW2æÖ†VçG'’Óâ€Ğ¢Ä÷&6ÖVçFô6&B¶W“×¶VçG'’æ÷&6ÖVçFòæ–GÒVçG'“×¶VçG'—Ò&VG“×¶fÇ6WÒóàĞ¢’—ĞĞ¢ÂöF—càĞ¢ÂöF—càĞ¢—ĞĞ¢ÂöF—càĞ¢—ĞĞ¢ÂöF—càĞ Ğ¢²ò¢6öæf—&ÖF–öâF–Æör¢÷ĞĞ¢ÄF–Æör÷Vã×²6öæf—&ÔVçG'—Òöä÷Vä6†ævS×²†÷Vâ’Óâ²–b‚÷Vâ’²6WD6öæf—&ÔVçG'’†çVÆÂ“²6WDvVæW&F–öå&W7VÇB†çVÆÂ“²6WDÖçVÄWV—ÖVçFò‚rr“²Ò×ÓàĞ¢ÄF–Æöt6öçFVçB6Æ74æÖSÒ'6Ó¦Ö‚×rÖÖB#àĞ¢ÄF–Æöt†VFW#àĞ¢ÄF–ÆöuF—FÆSävW&"õ2²F&VfWfóÂôF–ÆöuF—FÆSàĞ¢ÄF–ÆötFW67&—F–öãàĞ¢6öæf—&ÖRvW&:|:6òFõ2RF&VfFRW†V7\:|:6òàĞ¢ÂôF–ÆötFW67&—F–öãàĞ¢ÂôF–Æöt†VFW#àĞ Ğ¢¶6öæf—&ÔVçG'’bbvVæW&F–öå&W7VÇBbb€Ğ¢ÆF—b6Æ74æÖSÒ'76R×’Ó2#àĞ¢ÆF—b6Æ74æÖSÒ'&÷VæFVBÖÆr&÷&FW"&÷&FW"Ö&÷&FW"Ó276R×’ÓãR#àĞ¢Ç6Æ74æÖSÒ'FW‡B×6ÒföçB×6VÖ–&öÆB#ä÷,:vÖVçFò7¶6öæf—&ÔVçG'’æ÷&6ÖVçFòæ6öF–v÷ÓÂ÷àĞ¢Ç6Æ74æÖSÒ'FW‡B×‡2FW‡BÖ×WFVBÖf÷&Vw&÷VæB#ç¶6öæf—&ÔVçG'’æ÷&6ÖVçFòææöÖUö6Æ–VçFWÓÂ÷àĞ¢¶vWDWV—ÖVçFò†6öæf—&ÔVçG'’æ÷&6ÖVçFò’bb€Ğ¢Ç6Æ74æÖSÒ'FW‡B×‡2FW‡BÖ×WFVBÖf÷&Vw&÷VæB#ï	ùJr¶vWDWV—ÖVçFò†6öæf—&ÔVçG'’æ÷&6ÖVçFò—ÓÂ÷àĞ¢—ĞĞ¢Ç6Æ74æÖSÒ'FW‡B×‡2FW‡BÖ×WFVBÖf÷&Vw&÷VæB#àĞ¢¶6öæf—&ÔVçG'’çF÷FÄ—FVç7Ò&öGWFò‡2’(
""B´çVÖ&W"†6öæf—&ÔVçG'’æ÷&6ÖVçFòçfÆ÷%÷F÷FÂÇÂ’çFôf—†VBƒ"—ĞĞ¢Â÷àĞ¢ÂöF—càĞ Ğ¢²ò¢6öæfÆ–7Bv&æ–ær¢÷ĞĞ¢¶6öæf—&ÔVçG'’çFVÔ6ö×&öÖWF–Fòbb€Ğ¢ÆF—b6Æ74æÖSÒ'&÷VæFVBÖÆr&÷&FW"&÷&FW"×&VBÓSóS&r×&VBÓSóRÓ276R×’ÓãR#àĞ¢ÆF—b6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓ"#àĞ¢ÄÆW'EG&–ævÆR6Æ74æÖSÒ&‚ÓBrÓBFW‡B×&VBÓc"óàĞ¢Ç7â6Æ74æÖSÒ'FW‡B×‡2föçB×6VÖ–&öÆBFW‡B×&VBÓs#äW7F÷VR6ö×&öÖWF–FóÂ÷7ãàĞ¢ÂöF—càĞ¢Ç6Æ74æÖSÒ'FW‡B×‡2FW‡BÖ×WFVBÖf÷&Vw&÷VæB#àĞ¢VÒ÷RÖ—2—FVç2FW7FR÷,:vÖVçFò<:6òF—7WFF÷2÷"÷WG&÷2÷,:vÖVçF÷2÷Rõ72VæFVçFW2àĞ¢6RvW&"W7Fõ2Â÷2FVÖ—2VF–F÷2VR&V6—6ÒF2ÖW6Ö2\:v2öFW,:6òf–6"6VÒW7F÷VRàĞ¢Â÷àĞ¢ÆF—b6Æ74æÖSÒ'FW‡B×‡276R×’ÓãR#àĞ¢¶6öæf—&ÔVçG'’æ—FVç2æf–ÇFW"†’Óâ’æ6ö×&öÖWF–Fò’æÖ‚†—FVÒÂ–G‚’Óâ€Ğ¢ÆF—b¶W“×¶–G‡Ò6Æ74æÖSÒ'FW‡B×&VBÓc#àĞ¢)ª¶—FVÒæ6öF–võ÷&öGWFòbb²G¶—FVÒæ6öF–võ÷&öGWF÷ÕÒ×¶—FVÒææöÖU÷&öGWF÷Ò(	B&V6—6¢¶f÷&ÖEG’†—FVÒçFEöæV6W76&–—ÒÂ6ÆFó¢¶f÷&ÖEG’†—FVÒæW7F÷VUöF—7öæ—fVÂ—ÒÂ6ö×&öÖWF–F¢¶f÷&ÖEG’†—FVÒçFEö6ö×&öÖWF–Fóò—FVÒçFEöæV6W76&–—ĞĞ¢ÂöF—càĞ¢’—ĞĞ¢ÂöF—càĞ¢ÂöF—càĞ¢—ĞĞ Ğ¢²ò¢6Æ–VçFRWfó¢6V×&RW&Ö—F—"fÆÆ&6²ÖçVÂ²fÆ–F:|:6ò¢÷ĞĞ¢²‚‚’Óâ°Ğ¢6öç7B6÷W&6UF6´–BÒvWE6÷W&6UF6´÷4–B†6öæf—&ÔVçG'’æ÷&6ÖVçFò“°Ğ¢6öç7B†5fÆ–E6÷W&6UF6²Ò'6U÷6—F—fT–çB‡6÷W&6UF6´–B’ÓÒçVÆÃ°Ğ Ğ¢6öç7B†æFÆTÆöö·WÒ7–æ2‚’Óâ°Ğ¢6öç7B7W7FöÖW$–BÒ'6U÷6—F—fT–çB†Wfô7W7FöÖW$–D–çWB“°Ğ¢–b‚7W7FöÖW$–B’°Ğ¢6WDWfô7W7FöÖW$Æöö·W‡²ÆöF–æs¢fÇ6RÂW'&÷#¢t–æf÷&ÖRVÒ<;6F–vòFR6Æ–VçFRl:Æ–FòârÒ“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6WDWfô7W7FöÖW$Æöö·W‡²ÆöF–æs¢G'VRÒ“°Ğ¢G'’°Ğ¢6öç7B²FFÂW'&÷"ÒÒv—B7W&6RægVæ7F–öç2æ–çfö¶R‚vWfòÖÆöö·WÖ7W7FöÖW"rÂ°Ğ¢&öG“¢²7W7FöÖW%ö–C¢7W7FöÖW$–BÒÀĞ¢Ò“°Ğ¢–b†W'&÷"’F‡&÷ræWrW'&÷"‚tfÆ†æ6öç7VÇFr“°Ğ¢–b†FFòæW'&÷"’F‡&÷ræWrW'&÷"†FFæW'&÷"“°Ğ¢6WDWfô7W7FöÖW$Æöö·W‡²ÆöF–æs¢fÇ6RÂæÖS¢FFææÖRÒ“°Ğ¢Ò6F6‚†S¢ç’’°Ğ¢6WDWfô7W7FöÖW$Æöö·W‡²ÆöF–æs¢fÇ6RÂW'&÷#¢RæÖW76vRÇÂtW'&òò6öç7VÇF"rÒ“°Ğ¢ĞĞ¢Ó°Ğ Ğ¢&WGW&â€Ğ¢ÆF—b6Æ74æÖS×¶&÷VæFVBÖÆr&÷&FW"Ó276R×’Ó"G¶†5fÆ–E6÷W&6UF6²òv&÷&FW"Ö&÷&FW"&rÖ×WFVBóCr¢v&÷&FW"ÖÖ&W"ÓSóS&rÖÖ&W"ÓSóRwÖÓàĞ¢ÆF—b6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓ"#àĞ¢ÄÆW'EG&–ævÆR6Æ74æÖS×¶‚ÓBrÓBG¶†5fÆ–E6÷W&6UF6²òwFW‡BÖ×WFVBÖf÷&Vw&÷VæBr¢wFW‡BÖÖ&W"ÓcwÖÒóàĞ¢Ç7â6Æ74æÖS×¶FW‡B×‡2föçB×6VÖ–&öÆBG¶†5fÆ–E6÷W&6UF6²òwFW‡BÖf÷&Vw&÷VæBr¢wFW‡BÖÖ&W"ÓswÖÓàĞ¢¶†5fÆ–E6÷W&6UF6²òF&Vfõ2FR÷&–vVÒFWFV7FF‚2G·6÷W&6UF6´–GÒ–¢t6Æ–VçFRö'&–vL;7&–òwĞĞ¢Â÷7ãàĞ¢ÂöF—càĞ¢Ç6Æ74æÖSÒ'FW‡B×‡2FW‡BÖ×WFVBÖf÷&Vw&÷VæB#àĞ¢¶†5fÆ–E6÷W&6UF6°Ğ¢òu6RF&VfFR÷&–vVÒì:6òF—fW"6Æ–VçFRæòWfòÂ–æf÷&ÖRVÒ<;6F–vò&—†ò6öÖòfÆÆ&6²âpĞ¢¢tW7FR÷,:vÖVçFòì:6òFVÒF&Vfõ2l:Æ–F&6Æöæ"6Æ–VçFRâ–æf÷&ÖRRfÆ–FRò6Æ–VçFRæòWfò&6öçF–çV"âwĞĞ¢Â÷àĞ¢ÆF—b6Æ74æÖSÒ&fÆW‚vÓ"#àĞ¢Ä–çW@Ğ¢G—SÒ&çVÖ&W" Ğ¢Æ6V†öÆFW#Ò$<;6F–vòFò6Æ–VçFR„Wfò’ Ğ¢fÇVS×¶Wfô7W7FöÖW$–D–çWGĞĞ¢öä6†ævS×²†R’Óâ²6WDWfô7W7FöÖW$–D–çWB†RçF&vWBçfÇVR“²6WDWfô7W7FöÖW$Æöö·W‡²ÆöF–æs¢fÇ6RÒ“²×ĞĞ¢6Æ74æÖSÒ&‚Ó‚FW‡B×6ÒfÆW‚Ó Ğ¢óàĞ¢Ä'WGFöàĞ¢G—SÒ&'WGFöâ Ğ¢f&–çCÒ&÷WFÆ–æR Ğ¢6—¦SÒ'6Ò Ğ¢6Æ74æÖSÒ&‚Ó‚FW‡B×‡2‚Ó2 Ğ¢F—6&ÆVC×²'6U÷6—F—fT–çB†Wfô7W7FöÖW$–D–çWB’ÇÂWfô7W7FöÖW$Æöö·WæÆöF–æwĞĞ¢öä6Æ–6³×¶†æFÆTÆöö·WĞĞ¢àĞ¢¶Wfô7W7FöÖW$Æöö·WæÆöF–æròÄÆöFW#"6Æ74æÖSÒ&‚Ó2rÓ2æ–ÖFR×7–â"óâ¢Å6V&6‚6Æ74æÖSÒ&‚Ó2rÓ2"óçĞĞ¢Ç7â6Æ74æÖSÒ&ÖÂÓ#åfW&–f–6#Â÷7ãàĞ¢Âô'WGFöãàĞ¢ÂöF—càĞ¢¶Wfô7W7FöÖW$Æöö·WææÖRbb€Ğ¢ÆF—b6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓ"&÷VæFVB&÷&FW"&÷&FW"Öw&VVâÓSóS&rÖw&VVâÓSóRÓ"#àĞ¢Ä6†V6´6—&6ÆS"6Æ74æÖSÒ&‚ÓBrÓBFW‡BÖw&VVâÓc6‡&–æ²Ó"óàĞ¢Ç7â6Æ74æÖSÒ'FW‡B×‡2föçBÖÖVF—VÒFW‡BÖw&VVâÓs#ç¶Wfô7W7FöÖW$Æöö·WææÖWÓÂ÷7ãàĞ¢ÂöF—càĞ¢—ĞĞ¢¶Wfô7W7FöÖW$Æöö·WæW'&÷"bb€Ğ¢ÆF—b6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓ"&÷VæFVB&÷&FW"&÷&FW"ÖFW7G'V7F—fRóS&rÖFW7G'V7F—fRóRÓ"#àĞ¢ÄÆW'EG&–ævÆR6Æ74æÖSÒ&‚ÓBrÓBFW‡BÖFW7G'V7F—fR6‡&–æ²Ó"óàĞ¢Ç7â6Æ74æÖSÒ'FW‡B×‡2FW‡BÖFW7G'V7F—fR#ç¶Wfô7W7FöÖW$Æöö·WæW'&÷'ÓÂ÷7ãàĞ¢ÂöF—càĞ¢—ĞĞ¢ÂöF—càĞ¢“°Ğ¢Ò’‚—ĞĞ Ğ¢²ò¢6†÷rWV—ÖVçB–çWBv†VâæòWV—ÖVçBFWFV7FVB¢÷ĞĞ¢²‚‚’Óâ°Ğ¢–b‚6öæf—&ÔVçG'’’&WGW&âçVÆÃ°Ğ¢6öç7B†4WV—ÒvWDWV—ÖVçFò†6öæf—&ÔVçG'’æ÷&6ÖVçFò“°Ğ¢–b‚†4WV—’°Ğ¢&WGW&â€Ğ¢ÆF—b6Æ74æÖSÒ'&÷VæFVBÖÆr&÷&FW"&÷&FW"ÖÖ&W"ÓSóS&rÖÖ&W"ÓSóRÓ276R×’Ó"#àĞ¢ÆF—b6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓ"#àĞ¢ÄÆW'EG&–ævÆR6Æ74æÖSÒ&‚ÓBrÓBFW‡BÖÖ&W"Óc"óàĞ¢Ç7â6Æ74æÖSÒ'FW‡B×‡2föçB×6VÖ–&öÆBFW‡BÖÖ&W"Ós#å6VÒWV—ÖVçFòFWFV7FFò†÷6–öæÂ“Â÷7ãàĞ¢ÂöF—càĞ¢Ç6Æ74æÖSÒ'FW‡B×‡2FW‡BÖ×WFVBÖf÷&Vw&÷VæB#àĞ¢W7FR÷,:vÖVçFòì:6ò÷77V’WV—ÖVçFòf–æ7VÆFòâfö<:¢öFR–æf÷&Ö"&—†ò÷R&÷76VwV—"6VÓ Ğ¢Â÷àĞ¢Ä–çW@Ğ¢G—SÒ'FW‡B Ğ¢Æ6V†öÆFW#Ò$Wƒ¢52D…$õTt‚TTåDR†÷6–öæÂ’ Ğ¢fÇVS×¶ÖçVÄWV—ÖVçF÷ĞĞ¢öä6†ævS×²†R’Óâ6WDÖçVÄWV—ÖVçFò†RçF&vWBçfÇVR—ĞĞ¢6Æ74æÖSÒ&‚Ó‚FW‡B×6Ò Ğ¢óàĞ¢ÂöF—càĞ¢“°Ğ¢ĞĞ¢&WGW&âçVÆÃ°Ğ¢Ò’‚—ĞĞ Ğ¢ÆF—b6Æ74æÖSÒ'FW‡B×‡2FW‡BÖ×WFVBÖf÷&Vw&÷VæB76R×’Ó#àĞ¢Çäò6—7FVÖ—,:£Â÷àĞ¢ÆöÂ6Æ74æÖSÒ&Æ—7BÖFV6–ÖÂÆ—7BÖ–ç6–FR76R×’ÓãRÖÂÓ#àĞ¢ÆÆ“ä7&–"F&VfæòWfò‡6VÒL:–6æ–6òÂ6VÒFF“ÂöÆ“àĞ¢ÆÆ“ä7&–"õ2æòvW7L:6ô6Æ–6²6öÒòì+¢FF&VfÂöÆ“àĞ¢ÆÆ“åf–æ7VÆ"ì+¢Fò÷,:vÖVçFòRF&VfFRW†V7\:|:6óÂöÆ“àĞ¢ÂööÃàĞ¢ÂöF—càĞ¢ÂöF—càĞ¢—ĞĞ Ğ¢¶vVæW&F–öå&W7VÇCòç7V66W72bb€Ğ¢ÆF—b6Æ74æÖSÒ'&÷VæFVBÖÆr&÷&FW"&÷&FW"Öw&VVâÓSóS&rÖw&VVâÓSóRÓB76R×’Ó"#àĞ¢ÆF—b6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓ"#àĞ¢Ä6†V6´6—&6ÆS"6Æ74æÖSÒ&‚ÓRrÓRFW‡BÖw&VVâÓc"óàĞ¢Ç7â6Æ74æÖSÒ&föçB×6VÖ–&öÆBFW‡B×6ÒFW‡BÖw&VVâÓc#ävW&Fò6öÒ7V6W76òÂ÷7ãàĞ¢ÂöF—càĞ¢Ç6Æ74æÖSÒ'FW‡B×6Ò#äõ3¢Ç7G&öæsâ7¶vVæW&F–öå&W7VÇBæ÷46öF–v÷ÓÂ÷7G&öæsãÂ÷àĞ¢Ç6Æ74æÖSÒ'FW‡B×6Ò#åF&VfWfó¢Ç7G&öæsâ7¶vVæW&F–öå&W7VÇBæWfõF6´–GÓÂ÷7G&öæsãÂ÷àĞ¢ÂöF—càĞ¢—ĞĞ Ğ¢¶vVæW&F–öå&W7VÇCòæW'&÷"bb€Ğ¢ÆF—b6Æ74æÖS×¶&÷VæFVBÖÆr&÷&FW"ÓB76R×’Ó"G¶vVæW&F–öå&W7VÇBæGWÆ–6FRòv&÷&FW"ÖÖ&W"ÓSóS&rÖÖ&W"ÓSóRr¢v&÷&FW"ÖFW7G'V7F—fRóS&rÖFW7G'V7F—fRóRwÖÓàĞ¢ÆF—b6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓ"#àĞ¢ÄÆW'EG&–ævÆR6Æ74æÖS×¶‚ÓRrÓRG¶vVæW&F–öå&W7VÇBæGWÆ–6FRòwFW‡BÖÖ&W"Ócr¢wFW‡BÖFW7G'V7F—fRwÖÒóàĞ¢Ç7â6Æ74æÖS×¶föçB×6VÖ–&öÆBFW‡B×6ÒG¶vVæW&F–öå&W7VÇBæGWÆ–6FRòwFW‡BÖÖ&W"Ócr¢wFW‡BÖFW7G'V7F—fRwÖÓàĞ¢¶vVæW&F–öå&W7VÇBæGWÆ–6FRòtõ2¬:vW&Fr¢tW'&òævW&:|:6òwĞĞ¢Â÷7ãàĞ¢ÂöF—càĞ¢Ç6Æ74æÖSÒ'FW‡B×‡2FW‡BÖ×WFVBÖf÷&Vw&÷VæB#ç¶vVæW&F–öå&W7VÇBæW'&÷'ÓÂ÷àĞ¢¶vVæW&F–öå&W7VÇBæGWÆ–6FRbbvVæW&F–öå&W7VÇBæ÷46öF–vòbb€Ğ¢Ç6Æ74æÖSÒ'FW‡B×6ÒföçBÖÖVF—VÒ#äõ2W†—7FVçFS¢Ç7G&öæsâ7¶vVæW&F–öå&W7VÇBæ÷46öF–v÷ÓÂ÷7G&öæsãÂ÷àĞ¢—ĞĞ¢ÂöF—càĞ¢—ĞĞ Ğ¢ÄF–Æötfö÷FW#àĞ¢²vVæW&F–öå&W7VÇBbb€Ğ¢ÃàĞ¢Ä'WGFöâf&–çCÒ&÷WFÆ–æR"öä6Æ–6³×²‚’Óâ6WD6öæf—&ÔVçG'’†çVÆÂ—ÒF—6&ÆVC×¶vVæW&F–ætõ7ÓàĞ¢6æ6VÆ Ğ¢Âô'WGFöãàĞ¢Ä'WGFöàĞ¢öä6Æ–6³×²‚’Óâ6öæf—&ÔVçG'’bb†æFÆTvVæW&FTõ2†6öæf—&ÔVçG'’—ĞĞ¢F—6&ÆVC×¶vVæW&F–ætõ2ÇÂ‚‚’Óâ°Ğ¢–b‚6öæf—&ÔVçG'’’&WGW&âG'VS°Ğ¢6öç7B6÷W&6UF6´–BÒvWE6÷W&6UF6´÷4–B†6öæf—&ÔVçG'’æ÷&6ÖVçFò“°Ğ¢6öç7B†5fÆ–E6÷W&6UF6²Ò'6U÷6—F—fT–çB‡6÷W&6UF6´–B’ÓÒçVÆÃ°Ğ¢6öç7B†5fÆ–FFVDÖçVÄ7W7FöÖW"Ò'6U÷6—F—fT–çB†Wfô7W7FöÖW$–D–çWB’bbWfô7W7FöÖW$Æöö·WææÖS°Ğ¢6öç7B†47W7FöÖW"Ò†5fÆ–E6÷W&6UF6²ÇÂ†5fÆ–FFVDÖçVÄ7W7FöÖW#°Ğ¢&WGW&â†47W7FöÖW#°Ğ¢Ò’‚—ĞĞ¢6Æ74æÖSÒ&vÓ" Ğ¢àĞ¢¶vVæW&F–ætõ2òÄÆöFW#"6Æ74æÖSÒ&‚ÓBrÓBæ–ÖFR×7–â"óâ¢Å¦6Æ74æÖSÒ&‚ÓBrÓB"óçĞĞ¢¶vVæW&F–ætõ2òtvW&æFòâââr¢t6öæf—&Ö"wĞĞ¢Âô'WGFöãàĞ¢ÂóàĞ¢—ĞĞ¢¶vVæW&F–öå&W7VÇBbb€Ğ¢Ä'WGFöâöä6Æ–6³×²‚’Óâ²6WD6öæf—&ÔVçG'’†çVÆÂ“²6WDvVæW&F–öå&W7VÇB†çVÆÂ“²×ÓàĞ¢fV6† Ğ¢Âô'WGFöãàĞ¢—ĞĞ¢ÂôF–Æötfö÷FW#àĞ¢ÂôF–Æöt6öçFVçCàĞ¢ÂôF–ÆösàĞ¢ÂöF—càĞ¢“°Ğ§ĞĞ 