import { useCallback, useEffect, useMemo, useState } from 'react';
import { eventsApi } from './api';
import EventoModal from './EventoModal';
import {
  daysUntil,
  eventColor,
  eventPlace,
  fmtEventDate,
  nextOccurrence,
  RECURRENCE_LABEL,
  type ImportantEvent,
} from './types';

/**
 * Tab Eventos: gestión completa (crear, editar, borrar). Es el ÚNICO sitio
 * donde se editan; el resto de vistas los muestran en modo lectura.
 *
 * El botón de crear puede venir de fuera (la cabecera de la página), para que
 * en toda la Agenda haya un solo sitio desde el que se crea.
 */
export default function EventosTab({
  creando = false,
  onCerrarCreacion,
}: {
  creando?: boolean;
  onCerrarCreacion?: () => void;
} = {}) {
  const [eventsList, setEventsList] = useState<ImportantEvent[]>([]);
  const [editing, setEditing] = useState<ImportantEvent | 'new' | null>(null);

  const load = useCallback(async () => setEventsList(await eventsApi.list()), []);
  useEffect(() => {
    load();
  }, [load]);

  const { upcoming, overdue } = useMemo(() => {
    const withNext = eventsList.map((e) => ({ e, next: nextOccurrence(e), days: daysUntil(nextOccurrence(e)) }));
    return {
      overdue: withNext.filter((x) => x.days < 0).sort((a, b) => a.next.localeCompare(b.next)),
      upcoming: withNext.filter((x) => x.days >= 0).sort((a, b) => a.next.localeCompare(b.next)),
    };
  }, [eventsList]);

  function renderRow({ e, next, days }: { e: ImportantEvent; next: string; days: number }) {
    return (
      <button key={e.id} className="event-row" onClick={() => setEditing(e)} title="Clic para editar">
        <span className="event-band-inline" style={{ borderLeftColor: days < 0 ? '#c92a2a' : eventColor(e) }}>
          <span className="event-pin">{days < 0 ? '🚨' : e.emoji}</span>
          <span className="event-title">{e.title}</span>
          <span className="badge">
            <span className="dot" style={{ background: eventColor(e) }} />
            {eventPlace(e)}
          </span>
          {e.recurrence !== 'none' && <span className="badge">↻ {RECURRENCE_LABEL[e.recurrence].toLowerCase()}</span>}
          <span className={`event-note${days < 0 ? ' overdue' : ''}`}>
            {days < 0
              ? `venció hace ${Math.abs(days)} ${Math.abs(days) === 1 ? 'día' : 'días'}`
              : days === 0
                ? `HOY${e.eventTime ? ` · ${e.eventTime}` : ''}`
                : `${fmtEventDate(next)}${e.eventTime ? ` · ${e.eventTime}` : ''} · en ${days} días`}
          </span>
          {(days <= 0 && e.recurrence === 'none') && (
            <span
              className="btn ghost sm event-done"
              role="button"
              title="Dar por hecho (se retira de la lista)"
              onClick={async (ev) => {
                ev.stopPropagation();
                await eventsApi.remove(e.id);
                load();
              }}
            >
              ✓ Hecho
            </span>
          )}
        </span>
      </button>
    );
  }

  return (
    <div>
      {overdue.length > 0 && (
        <section className="section">
          <h2 className="overdue">Vencidos · {overdue.length}</h2>
          <div className="event-list">{overdue.map(renderRow)}</div>
        </section>
      )}

      <section className="section">
        <h2>Próximos · {upcoming.length}</h2>
        {upcoming.length === 0 && <div className="empty">Sin eventos. Añade el primero.</div>}
        <div className="event-list">{upcoming.map(renderRow)}</div>
      </section>

      <p className="muted" style={{ fontSize: 12.5, marginTop: 16 }}>
        Los eventos recurrentes (↻) muestran siempre su próxima ocurrencia. Los puntuales vencidos se quedan en rojo
        hasta que los des por hechos (✓) o los elimines.
      </p>

      {(editing || creando) && (
        <EventoModal
          event={editing && editing !== 'new' ? editing : null}
          onClose={() => {
            setEditing(null);
            onCerrarCreacion?.();
          }}
          onSaved={load}
        />
      )}
    </div>
  );
}
