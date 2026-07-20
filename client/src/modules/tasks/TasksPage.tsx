import { useCallback, useEffect, useState } from 'react';
import { tasksApi } from './api';
import { KebabMenu } from './components';
import { AddTaskModal } from './modals';
import TaskTable from './TaskTable';
import { EventsRadar } from '../events/components';
import type { Task } from './types';

// Vista global: TODAS las tareas de todos los espacios y proyectos.
export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    async () => setTasks(await tasksApi.list({ status: showCompleted ? 'all' : 'open' })),
    [showCompleted],
  );
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="page-head">
        <h1>Tareas</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <KebabMenu
            items={[
              {
                label: 'Ver completadas',
                checked: showCompleted,
                onClick: () => setShowCompleted((v) => !v),
              },
            ]}
          />
          <button className="btn" onClick={() => setAdding(true)}>
            + Añadir tarea
          </button>
        </div>
      </div>

      <EventsRadar scope="space" />
      <div style={{ marginTop: 12 }}>
        <TaskTable tasks={tasks} onChanged={load} />
      </div>

      {adding && <AddTaskModal onClose={() => setAdding(false)} onCreated={load} />}
    </div>
  );
}
