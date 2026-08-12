
import React, { useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type AgendaOsRow, type AgendaBucket } from '@/api/agendaControl';
import { datePart } from '@/api/agendaControl';
import { SeparationItemSnapshot } from '@/api/separations';

interface CalendarViewProps {
  rows: AgendaOsRow[];
  onSelectEvent: (row: AgendaOsRow) => void;
  selectedEvent: AgendaOsRow | null;
  onCloseDetail: () => void;
  renderDetail: (row: AgendaOsRow) => React.ReactNode;
}

export default function CalendarView({ 
  rows, 
  onSelectEvent, 
  selectedEvent, 
  onCloseDetail,
  renderDetail
}: CalendarViewProps) {
  
  const events = useMemo(() => {
    return rows.map(row => {
      // 1. Data de execução (Auvo)
      const executionDate = row.task?.task_date ? datePart(row.task.task_date) : null;
      
      // 2. Data de previsão de chegada (GC Compra)
      // Buscamos a data mais tardia entre as peças que estão em compra
      let arrivalDate: string | null = null;
      if (row.items && row.items.length > 0) {
        const arrivalDates = row.items
          .flatMap(item => item.ordens_compra || [])
          .map(order => order.previsao_chegada)
          .filter((d): d is string => !!d && d !== '—' && d.trim() !== '');
        
        if (arrivalDates.length > 0) {
          // Sort handling both ISO and dd/mm/yyyy if present
          arrivalDate = arrivalDates.sort((a, b) => {
            const da = a.includes('/') ? a.split('/').reverse().join('-') : a;
            const db = b.includes('/') ? b.split('/').reverse().join('-') : b;
            return db.localeCompare(da);
          })[0];
        }
      }

      const start = arrivalDate || executionDate || '';
      
      return {
        id: row.os.id,
        title: `OS #${row.os.codigo} - ${row.os.nome_cliente.split(' ')[0]}`,
        start,
        backgroundColor: arrivalDate ? '#9333ea' : (row.bucket === 'scheduled-date' ? '#3B82F6' : '#94A3B8'),
        borderColor: arrivalDate ? '#9333ea' : (row.bucket === 'scheduled-date' ? '#2563EB' : '#64748B'),
        classNames: arrivalDate ? ['ring-2 ring-purple-300 ring-offset-1'] : [],
        extendedProps: { row, isArrival: !!arrivalDate }
      };
    }).filter(e => e.start !== '');
  }, [rows]);

  return (
    <Card className="p-4">
      <div className="mb-4 flex gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-full bg-[#9333ea]" />
          <span>Previsão de Chegada (Peças)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-full bg-[#3B82F6]" />
          <span>Execução Agendada</span>
        </div>
      </div>

      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay',
        }}
        locale="pt-br"
        height="auto"
        events={events}
        eventClick={(info) => {
          onSelectEvent(info.event.extendedProps.row);
        }}
        eventContent={(eventInfo) => (
          <div className="flex flex-col px-1 py-0.5 overflow-hidden text-[10px] leading-tight">
            <div className="truncate font-semibold">{eventInfo.event.title}</div>
            {eventInfo.event.extendedProps.isArrival && (
              <div className="italic opacity-90">📦 Chegada prevista</div>
            )}
          </div>
        )}
      />
      
      {selectedEvent && (
        <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && onCloseDetail()}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Detalhes da OS #{selectedEvent.os.codigo}</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              {renderDetail(selectedEvent)}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
