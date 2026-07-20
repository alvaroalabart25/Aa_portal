import { useCallback, useEffect, useMemo, useState } from 'react';
import { tasksApi } from './api';
import TaskTable from './TaskTable';
import type { Task } from './types';

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STATUS_ORDER: Record<string, number> = { in_progress: 0, blocked: 1, backlog: 2, completed: 3, cancelled: 4 };
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
}: {
  title: string;
  tasks: Task[];
  onChanged: () => void;
  titleClass?: string;
}) {
  const high = tasks.filter((t) => t.priority === 'high');
  const rest = tasks.filter((t) => t.priority !== 'high');
  const split = high.length > 0 && rest.length > 0;

  return (
    <section className="section">
      <h2 className={titleClass}>
        {title} · {tasks.length}
      </h2>
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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setTasks(await tasksApi.list({ status: 'open' }));
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
      </div>

      {groups.overdue.length > 0 && (
        <AgendaSection title="Vencidas" titleClass="overdue" tasks={groups.overdue} onChanged={load} />
      )}

      {groups.days.map((day) => (
        <AgendaSection key={day.iso} title={day.label} tasks={day.tasks} onChanged={load} />
      ))}

      <AgendaSection title="Próximas" tasks={groups.upcoming} onChanged={load} />
    </div>
  );
}
