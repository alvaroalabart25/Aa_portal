import { useCallback, useEffect, useState } from 'react';
import { tasksApi } from './api';
import { AddTaskModal } from './modals';
import TaskTable from './TaskTable';
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
        <button className="btn sm" onClick={() => setAdding(true)}>
          + Añadir tarea
        </button>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '24px 0 0', paddingLeft: 10 }}>
        <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
        Ver completadas
      </label>

      <TaskTable tasks={tasks} onChanged={load} />

      {adding && <AddTaskModal onClose={() => setAdding(false)} onCreated={load} />}
    </div>
  );
}
