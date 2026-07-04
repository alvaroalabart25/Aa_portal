import { useCallback, useEffect, useState } from 'react';
import { tasksApi } from './api';
import TaskTable from './TaskTable';
import type { Task } from './types';

// Vista transversal: cruza TODOS los espacios y proyectos por fecha.
export default function AgendaPage() {
  const [overdue, setOverdue] = useState<Task[]>([]);
  const [today, setToday] = useState<Task[]>([]);
  const [upcoming, setUpcoming] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [o, t, u] = await Promise.all([
      tasksApi.list({ view: 'overdue' }),
      tasksApi.list({ view: 'today' }),
      tasksApi.list({ view: 'upcoming' }),
    ]);
    setOverdue(o);
    setToday(t);
    setUpcoming(u);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="muted">Cargando…</p>;

  return (
    <div>
      <div className="page-head">
        <h1>Agenda</h1>
      </div>

      {overdue.length > 0 && (
        <section className="section">
          <h2 className="overdue">Vencidas · {overdue.length}</h2>
          <TaskTable tasks={overdue} onChanged={load} />
        </section>
      )}

      <section className="section">
        <h2>Hoy · {today.length}</h2>
        <TaskTable tasks={today} onChanged={load} />
      </section>

      <section className="section">
        <h2>Próximas · {upcoming.length}</h2>
        <TaskTable tasks={upcoming} onChanged={load} />
      </section>
    </div>
  );
}
