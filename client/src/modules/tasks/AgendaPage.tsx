import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { tasksApi } from './api';
import TaskTable from './TaskTable';
import type { Task } from './types';
import { eventsApi } from '../events/api';
import { EventBand, EventsRadar } from '../events/components';
import EventosTab from '../events/EventosTab';
import MacroTab from '../focus/MacroTab';
import PlanTab from '../focus/PlanTab';
import { AddTaskModal } from './modals';
import {
  daysUntil,
  fmtEventDate,
  LIST_WINDOW_DAYS,
  nextOccurrence,
  RADAR_DIAS_AGENDA,
  whenLabel,
  type ImportantEvent,
} from '../events/types';

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Vista = 'macro' | 'plan' | 'agenda' | 'eventos';

// Las cuatro caras de lo mismo, de lo lejano a lo inmediato: los meses que
// vienen en Plan, el mes en Macro, el día a día en Agenda y las fechas clave.
const VISTAS: [Vista, string][] = [
  ['macro', 'Macro'],
  ['plan', 'Plan'],
  ['agenda', 'Agenda'],
  ['eventos', 'Eventos'],
];

const STATUS_ORDER: Record<string, number> = { in_progress: 0, in_review: 1, blocked: 2, backlog: 3, completed: 4, cancelled: 5 };
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

// Orden dentro de cada sección: estado > prioridad > fecha
function sortTasks(list: Task[]): Task[] {
  return [...list].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
  );
}

// Sección de la agenda: subagrupa en "Alta" (lo que hay que atacar)
// y "Media y baja". Si el grupo es homogéneo, tabla única sin sublabels.
function AgendaSection({
  title,
  tasks,
  onChanged,
  titleClass,
  events = [],
  eventNote,
  onCrear,
}: {
  title: string;
  tasks: Task[];
  onChanged: () => void;
  titleClass?: string;
  events?: ImportantEvent[];
  eventNote?: (ev: ImportantEvent) => string;
  /** crear una tarea para ESTE día; sin esto, la sección no lleva botón */
  onCrear?: () => void;
}) {
  const high = tasks.filter((t) => t.priority === 'high');
  const rest = tasks.filter((t) => t.priority !== 'high');
  const split = high.length > 0 && rest.length > 0;

  return (
    <section className="section">
      <div className="ag-dia">
        <h2 className={titleClass}>
          {title} · {tasks.length}
        </h2>
        {/* crear aquí ya sabe para qué día es: no hay que elegir la fecha */}
        {onCrear && (
          <button className="btn ghost sm" onClick={onCrear}>
            + Nueva
          </button>
        )}
      </div>
      {events.map((ev) => (
        <EventBand key={ev.id} ev={ev} note={eventNote?.(ev)} />
      ))}
      {split ? (
        <>
          <h3 className="prio-sub high">↑ Prioridad alta · {high.length}</h3>
          <TaskTable tasks={high} onChanged={onChanged} />
          <h3 className="prio-sub">Media y baja · {rest.length}</h3>
          <TaskTable tasks={rest} onChanged={onChanged} />
        </>
      ) : (
        <TaskTable tasks={tasks} onChanged={onChanged} />
      )}
    </section>
  );
}

// Agenda: los próximos 5 días de la semana (rotando desde hoy) + Vencidas
// arriba y Próximas al final.
export default function AgendaPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [eventsList, setEventsList] = useState<ImportantEvent[]>([]);
  const [loading, setLoading] = useState(true);
  // null = cerrado. Un ISO = crear una tarea con ese vencimiento ya puesto.
  const [creando, setCreando] = useState<string | null>(null);
  // la vista viaja en la URL: así se puede volver a Macro desde una ficha
  const [params, setParams] = useSearchParams();
  // Macro es la vista por defecto: es la portada del portal
  const pedida = params.get('tab');
  const view: Vista = pedida === 'agenda' || pedida === 'eventos' || pedida === 'plan' ? pedida : 'macro';
  const setView = (v: Vista) => {
    setCreando(null);
    setParams(v === 'macro' ? {} : { tab: v }, { replace: true });
  };

  const load = useCallback(async () => {
    const [t, e] = await Promise.all([tasksApi.list({ status: 'open' }), eventsApi.list()]);
    setTasks(t);
    setEventsList(e);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const dated = tasks.filter((x) => x.dueDate);
    const todayIso = isoLocal(new Date());

    const days: Array<{ iso: string; label: string; tasks: Task[] }> = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const iso = isoLocal(d);
      const weekday = d.toLocaleDateString('es-ES', { weekday: 'long' });
      let label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
      if (i === 0) label += ' (Hoy)';
      days.push({ iso, label, tasks: sortTasks(dated.filter((x) => x.dueDate === iso)) });
    }
    const lastIso = days[days.length - 1].iso;

    return {
      overdue: sortTasks(dated.filter((x) => x.dueDate! < todayIso)),
      days,
      upcoming: sortTasks(dated.filter((x) => x.dueDate! > lastIso)),
    };
  }, [tasks]);

  if (loading) return <p className="muted">Cargando…</p>;

  return (
    <div>
      <div className="page-head">
        <h1>Agenda</h1>
        {/* La cabecera es para moverse entre pestañas y nada más. Crear vive en
            la línea de la lista a la que pertenece: el día en Agenda, «Próximos»
            en Eventos. En Macro no se crea nada, se mira el mes. */}
        <div className="head-acciones">
          <div className="seg" role="tablist">
            {VISTAS.map(([v, etiqueta]) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                className={view === v ? 'active' : ''}
                onClick={() => setView(v)}
              >
                {etiqueta}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="page-sub">
        El tiempo de un vistazo: lo que viene en Plan, el mes en Macro, la semana en Agenda y las fechas señaladas en
        Eventos.
      </p>

      {view === 'eventos' ? (
        <EventosTab />
      ) : view === 'macro' ? (
        <MacroTab />
      ) : view === 'plan' ? (
        <PlanTab />
      ) : (
        <>
          {/* aquí solo lo inmediato: la semana entera está en Macro */}
          <EventsRadar dias={RADAR_DIAS_AGENDA} />

          {groups.overdue.length > 0 && (
            <AgendaSection title="Vencidas" titleClass="overdue" tasks={groups.overdue} onChanged={load} />
          )}

          {groups.days.map((day) => (
            <AgendaSection
              key={day.iso}
              title={day.label}
              tasks={day.tasks}
              onChanged={load}
              events={eventsList.filter((ev) => nextOccurrence(ev) === day.iso)}
              onCrear={() => setCreando(day.iso)}
            />
          ))}

          <AgendaSection
            title="Próximas"
            tasks={groups.upcoming}
            onChanged={load}
            events={eventsList
              .filter((ev) => {
                const days = daysUntil(nextOccurrence(ev));
                return days > 4 && days <= LIST_WINDOW_DAYS; // más allá de los 5 días visibles, hasta 4 meses
              })
              .sort((a, b) => nextOccurrence(a).localeCompare(nextOccurrence(b)))}
            eventNote={(ev) => {
              const next = nextOccurrence(ev);
              return `${whenLabel(daysUntil(next))} · ${fmtEventDate(next)}`;
            }}
          />
        </>
      )}

      {creando !== null && (
        <AddTaskModal fechaPorDefecto={creando || undefined} onClose={() => setCreando(null)} onCreated={load} />
      )}
    </div>
  );
}
