import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Calendar, 
  User, 
  Search, 
  Filter, 
  RefreshCw, 
  Clock, 
  CheckCircle2, 
  AlertTriangle,
  UserPlus,
  Loader2
} from 'lucide-react';
import { getSeparations, linkTechnicianToSeparation, SeparationRecord } from '@/api/separations';
import { toast } from 'sonner';

export default function AgendamentoSeparacaoPage() {
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [selectedTechnician, setSelectedTechnician] = useState('all');

  const { data: separations = [], isLoading, refetch } = useQuery({
    queryKey: ['separations-agendamento', fromDate],
    queryFn: () => getSeparations({ 
      fromDate: fromDate ? new Date(fromDate).toISOString() : undefined,
    }),
  });

  const technicians = useMemo(() => {
    const techSet = new Set<string>();
    separations.forEach(s => {
      if (s.technician_name) techSet.add(s.technician_name);
    });
    return Array.from(techSet).sort();
  }, [separations]);

  const filteredSeparations = useMemo(() => {
    return separations.filter(s => {
      const matchesSearch = !search || 
        s.order_code.toLowerCase().includes(search.toLowerCase()) ||
        s.client_name.toLowerCase().includes(search.toLowerCase());
      
      const matchesTech = selectedTechnician === 'all' || s.technician_name === selectedTechnician;
      
      return matchesSearch && matchesTech;
    });
  }, [separations, search, selectedTechnician]);

  const handleAutoLink = async (separation: SeparationRecord) => {
    // In a real scenario, we'd fetch the technician from Auvo task
    // For now, this is a placeholder for the logic requested
    toast.info(`Sugerindo vinculação para ${separation.order_code}...`);
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('pt-BR');
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calendar className="h-6 w-6 text-primary" />
          Agendamento e Separação
        </h1>
        <p className="text-muted-foreground text-sm">
          Gerencie o agendamento de técnicos e a vinculação com as separações concluídas.
        </p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Data de Agendamento
            </label>
            <Input 
              type="date" 
              value={fromDate} 
              onChange={(e) => setFromDate(e.target.value)} 
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <User className="h-3 w-3" /> Técnico
            </label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={selectedTechnician}
              onChange={(e) => setSelectedTechnician(e.target.value)}
            >
              <option value="all">Todos os Técnicos</option>
              {technicians.map(tech => (
                <option key={tech} value={tech}>{tech}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1 md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Search className="h-3 w-3" /> Buscar
            </label>
            <div className="flex gap-2">
              <Input 
                placeholder="Código OS ou Cliente..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1"
              />
              <Button variant="outline" size="icon" onClick={() => refetch()}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mb-2" />
            <p>Carregando agendamentos...</p>
          </div>
        ) : filteredSeparations.length === 0 ? (
          <div className="text-center py-20 border rounded-lg bg-muted/20">
            <Filter className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-muted-foreground">Nenhum registro encontrado para os filtros selecionados.</p>
          </div>
        ) : (
          filteredSeparations.map((sep) => {
            const hasTech = !!sep.technician_name;
            return (
              <Card 
                key={sep.id} 
                className={`p-4 border-l-4 ${!hasTech ? 'bg-yellow-50/50 border-l-yellow-400' : 'border-l-primary'}`}
              >
                <div className="flex flex-col md:flex-row justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg">#{sep.order_code}</span>
                      <Badge variant={sep.order_type === 'os' ? 'default' : 'secondary'}>
                        {sep.order_type.toUpperCase()}
                      </Badge>
                      {!hasTech && (
                        <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">
                          Não Agendado
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground font-medium">
                      {sep.client_name}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> {formatDate(sep.concluded_at)}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Concluído às {new Date(sep.concluded_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>

                  <Separator orientation="vertical" className="hidden md:block h-12" />

                  <div className="flex flex-col justify-center items-end gap-2 min-w-[200px]">
                    {hasTech ? (
                      <div className="flex items-center gap-2 text-sm font-medium text-primary">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>{sep.technician_name}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm font-medium text-yellow-600">
                        <AlertTriangle className="h-4 w-4" />
                        <span>Técnico pendente</span>
                      </div>
                    )}
                    
                    <Button 
                      size="sm" 
                      variant={hasTech ? "outline" : "default"}
                      className="w-full"
                      onClick={() => handleAutoLink(sep)}
                    >
                      <UserPlus className="h-4 w-4 mr-2" />
                      {hasTech ? "Alterar Técnico" : "Vincular Técnico"}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
