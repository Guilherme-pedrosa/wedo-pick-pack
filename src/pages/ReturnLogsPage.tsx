import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, RefreshCw, Download, FileText, Undo2, Calendar, Clock, User, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReturnLogEntry {
  id: string;
  date: string;
  orderType: 'os' | 'venda';
  orderCode: string;
  clientName: string;
  motivo: 'agenda' | 'peca';
  motivoLabel: string;
  details: string;
  operatorName: string;
  separationId: string;
}

export default function ReturnLogsPage() {
  const [entries, setEntries] = useState<ReturnLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [motivoFilter, setMotivoFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    const results: ReturnLogEntry[] = [];

    // 1. Fetch "agenda" returns from system_logs
    let agendaQuery = (supabase.from('system_logs') as any)
      .select('*')
      .eq('module', 'separations')
      .eq('action', 'devolucao_agenda')
      .order('created_at', { ascending: false })
      .limit(500);

    if (fromDate) agendaQuery = agendaQuery.gte('created_at', new Date(fromDate).toISOString());
    if (toDate) {
      const next = new Date(toDate);
      next.setDate(next.getDate() + 1);
      agendaQuery = agendaQuery.lt('created_at', next.toISOString());
    }

    const { data: agendaLogs } = await agendaQuery;
    if (agendaLogs) {
      for (const log of agendaLogs as any[]) {
        const d = log.details || {};
        results.push({
          id: log.id,
          date: log.created_at,
          orderType: log.entity_type === 'os' ? 'os' : 'venda',
          orderCode: (log.entity_name || '').replace(/^(OS|Venda)\s*#/, ''),
          clientName: d.client_name || '',
          motivo: 'agenda',
          motivoLabel: 'Agenda (não deu tempo)',
          details: d.motivo || '',
          operatorName: log.user_name || '',
          separationId: d.separation_id || '',
        });
      }
    }

    // 2. Fetch "peça incorreta" returns from separations
    let pecaQuery = supabase
      .from('separations')
      .select('*')
      .eq('invalidated', true)
      .ilike('invalidated_reason', 'DEVOLUÇÃO:%')
      .order('invalidated_at', { ascending: false })
      .limit(500);

    if (fromDate) pecaQuery = pecaQuery.gte('invalidated_at', new Date(fromDate).toISOString());
    if (toDate) {
      const next = new Date(toDate);
      next.setDate(next.getDate() + 1);
      pecaQuery = pecaQuery.lt('invalidated_at', next.toISOString());
    }

    const { data: pecaLogs } = await pecaQuery;
    if (pecaLogs) {
      for (const sep of pecaLogs as any[]) {
        const reason = (sep.invalidated_reason || '').replace(/^DEVOLUÇÃO:\s*/, '');
        results.push({
          id: sep.id,
          date: sep.invalidated_at || sep.concluded_at,
          orderType: sep.order_type === 'os' ? 'os' : 'venda',
          orderCode: sep.order_code,
          clientName: sep.client_name,
          motivo: 'peca',
          motivoLabel: 'Peça incorreta',
          details: reason,
          operatorName: sep.operator_name,
          separationId: sep.id,
        });
      }
    }

    // Sort by date descending
    results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setEntries(results);
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let list = entries;
    if (motivoFilter !== 'all') list = list.filter(e => e.motivo === motivoFilter);
    if (typeFilter !== 'all') list = list.filter(e => e.orderType === typeFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(e =>
        e.orderCode.toLowerCase().includes(s) ||
        e.clientName.toLowerCase().includes(s) ||
        e.operatorName.toLowerCase().includes(s) ||
        e.details.toLowerCase().includes(s)
      );
    }
    return list;
  }, [entries, motivoFilter, typeFilter, search]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const exportCSV = () => {
    const header = ['Data/Hora', 'Tipo', 'Código', 'Cliente', 'Motivo', 'Detalhes', 'Operador'];
    const rows = filtered.map(e => [
      fmt(e.date),
      e.orderType === 'os' ? 'OS' : 'Venda',
      e.orderCode,
      e.clientName,
      e.motivoLabel,
      e.details,
      e.operatorName,
    ]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `devolucoes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const rows = filtered.map(e => `
      <tr>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${fmt(e.date)}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${e.orderType === 'os' ? 'OS' : 'Venda'} #${e.orderCode}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${e.clientName}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">
          <span style="background:${e.motivo === 'agenda' ? '#fef3c7' : '#fee2e2'};padding:2px 6px;border-radius:4px;font-size:10px;">
            ${e.motivoLabel}
          </span>
        </td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${e.details}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${e.operatorName}</td>
      </tr>
    `).join('');

    win.document.write(`
      <html><head><title>Devoluções</title><style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        p { font-size: 12px; color: #666; margin-bottom: 16px; }
        table { border-collapse: collapse; width: 100%; }
        th { background: #f3f4f6; padding: 6px 8px; border: 1px solid #ddd; font-size: 11px; text-align: left; }
        @media print { body { padding: 0; } }
      </style></head><body>
        <h1>Relatório de Devoluções</h1>
        <p>Gerado em ${new Date().toLocaleString('pt-BR')} — ${filtered.length} registro(s)</p>
        <table>
          <thead><tr>
            <th>Data/Hora</th><th>Documento</th><th>Cliente</th><th>Motivo</th><th>Detalhes</th><th>Operador</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body></html>
    `);
    win.document.close();
    setTimeout(() => win.print(), 300);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
      <div className="shrink-0 p-4 pb-2 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Undo2 className="h-5 w-5" />
            Log de Devoluções
          </h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fetchData()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
            </Button>
            <Button variant="outline" size="sm" onClick={exportPDF}>
              <FileText className="h-4 w-4 mr-1" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4 mr-1" /> Excel
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por código, cliente, operador..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Select value={motivoFilter} onValueChange={setMotivoFilter}>
            <SelectTrigger className="w-[160px] h-9">
              <Filter className="h-3.5 w-3.5 mr-1" />
              <SelectValue placeholder="Motivo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos motivos</SelectItem>
              <SelectItem value="agenda">Agenda</SelectItem>
              <SelectItem value="peca">Peça incorreta</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[130px] h-9">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="os">OS</SelectItem>
              <SelectItem value="venda">Venda</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-9 w-[130px]" />
            <span className="text-xs text-muted-foreground">a</span>
            <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-9 w-[130px]" />
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          {filtered.length} registro(s)
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            Nenhuma devolução encontrada
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map(entry => (
              <Card key={entry.id} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center shrink-0 text-xs text-muted-foreground w-[70px]">
                    <Clock className="h-3.5 w-3.5 mb-0.5" />
                    <span>{new Date(entry.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                    <span>{new Date(entry.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {entry.orderType === 'os' ? 'OS' : 'Venda'} #{entry.orderCode}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className={cn(
                          'text-[10px]',
                          entry.motivo === 'agenda'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        )}
                      >
                        {entry.motivoLabel}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{entry.clientName}</span>
                    </div>
                    {entry.details && (
                      <div className="text-[11px] text-muted-foreground bg-muted/50 rounded px-2 py-1">
                        {entry.details}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <User className="h-3 w-3" />
                      <span>{entry.operatorName}</span>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
