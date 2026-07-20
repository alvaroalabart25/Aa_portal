import { useEffect, useState } from 'react';
import { eventsApi } from './api';
import {
  daysUntil,
  eventColor,
  eventPlace,
  fmtEventDate,
  milestoneLabel,
  nextOccurrence,
  type EventScope,
  type ImportantEvent,
} from './types';

// Banda de evento: visualmente distinta de una tarea (borde de color, 📌),
// solo lectura fuera de la tab Eventos.
export function EventBand({ ev, note }: { ev: ImportantEvent; note?: string }) {
  const color = eventColor(ev);
  return (
    <div className="event-band" style={{ borderLeftColor: color }}>
      <span className="event-pin">📌</span>
      <span className="event-title">{ev.title}</span>
      <span className="badge">
        <span className="dot" style={{ background: color }} />
        {eventPlace(ev)}
      </span>
      {note && <span className="event-note">{note}</span>}
    </div>
  );
}

// Radar: franja de recordatorios. Muestra vencidos (puntuales, en rojo hasta
// borrarlos) y los eventos que hoy tocan hito (1 mes, 15, 7, 3, 2, víspera, día).
export function EventsRadar({ scope }: { scope?: EventScope }) {
  const [eventsList, setEventsList] = useState<ImportantEvent[]>([]);

  useEffect(() => {
    eventsApi.list().then(setEventsList);
  }, []);

  const relevant = scope ? eventsList.filter((e) => e.scope === scope) : eventsList;

  const overdue = relevant
    .filter((e) => e.recurrence === 'none' && daysUntil(e.eventDate) < 0)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  const alerts = relevant
    .map((e) => {
      const next = nextOccurrence(e);
      return { e, next, days: daysUntil(next) };
    })
    .filter((x) => milestoneLabel(x.days) !== null)
    .sort((a, b) => a.days - b.days);

  if (overdue.length === 0 && alerts.length === 0) return null;

  return (
    <div className="radar">
      {overdue.map((e) => (
        <div key={`o${e.id}`} className="event-band overdue-band" style={{ borderLeftColor: '#c92a2a' }}>
          <span className="event-pin">🚨</span>
          <span className="event-title">{e.title}</span>
          <span className="badge">
            <span className="dot" style={{ background: eventColor(e) }} />
            {eventPlace(e)}
          </span>
          <span className="event-note overdue">
            venció el {fmtEventDate(e.eventDate).toLowerCase()} — hace {Math.abs(daysUntil(e.eventDate))} días
          </span>
        </div>
      ))}
      {alerts.map(({ e, next, days }) => (
        <div
          key={e.id}
          className={`event-band${days === 0 ? ' today-band' : ''}`}
          style={{ borderLeftColor: eventColor(e) }}
        >
          <span className="event-pin">📌</span>
          <span className={`event-when${days <= 2 ? ' soon' : ''}`}>{milestoneLabel(days)}</span>
          <span className="event-title">{e.title}</span>
          <span className="badge">
            <span className="dot" style={{ background: eventColor(e) }} />
            {eventPlace(e)}
          </span>
          {days > 0 && <span className="event-note">{fmtEventDate(next)}</span>}
        </div>
      ))}
    </div>
  );
}
