import { useCallback, useEffect, useMemo, useState } from 'react';
import { tasksApi } from './api';
import TaskTable from './TaskTable';
import AgendaCalendar from './AgendaCalendar';
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

// Vista transversal: cruza TODOS los espacios y proyectos por fecha.
export default function AgendaPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'calendar'>('list');

  const load = useCallback(async () => {
    setTasks(await tasksApi.list({ status: 'open' }));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const today = isoLocal(new Date());
    const t = new Date();
    t.setDate(t.getDate() + 1);
    const tomorrow = isoLocal(t);
    const dated = tasks.filter((x) => x.dueDate);
    return {
      overdue: sortTasks(dated.filter((x) => x.dueDate! < today)),
      today: sortTasks(dated.filter((x) => x.dueDate === today)),
      tomorrow: sortTasks(dated.filter((x) => x.dueDate === tomorrow)),
      upcoming: sortTasks(dated.filter((x) => x.dueDate! > tomorrow)),
    };
  }, [tasks]);

  if (loading) return <p className="muted">Cargando…</p>;

  return (
    <div>
      <div className="page-head">
        <h1>Agenda</h1>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            Vencimiento
          </button>
          <button role="tab" aria-selected={view === 'calendar'} className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>
            Calendario
          </button>
        </div>
      </div>

      {view === 'list' ? (
        <div>
          {groups.overdue.length > 0 && (
            <section className="section">
              <h2 className="overdue">Vencidas · {groups.overdue.length}</h2>
              <TaskTable tasks={groups.overdue} onChanged={load} />
            </section>
          )}

          <section className="section">
            <h2>Hoy · {groups.today.length}</h2>
            <TaskTable tasks={groups.today} onChanged={load} />
          </section>

          <section className="section">
            <h2>Mañana · {groups.tomorrow.length}</h2>
            <TaskTable tasks={groups.tomorrow} onChanged={load} />
          </section>

          <section className="section">
            <h2>Próximas · {groups.upcoming.length}</h2>
            <TaskTable tasks={groups.upcoming} onChanged={load} />
          </section>
        </div>
      ) : (
        <AgendaCalendar tasks={tasks} />
      )}
    </div>
  );
}
