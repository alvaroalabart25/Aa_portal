import { useNavigate } from 'react-router-dom';
import { tasksApi } from './api';
import { DueDate, PriorityBadge, SpaceTag } from './components';
import { TASK_STATUS_LABEL, type Task, type TaskStatus } from './types';

// Tabla de tareas reutilizable (Agenda, detalle de proyecto...).
// En PC: tabla con columnas. En móvil: cada fila se convierte en caja (CSS).
export default function TaskTable({
  tasks,
  showProject = true,
  onChanged,
}: {
  tasks: Task[];
  showProject?: boolean;
  onChanged: () => void;
}) {
  const navigate = useNavigate();

  async function changeStatus(task: Task, status: TaskStatus) {
    await tasksApi.update(task.id, { status });
    onChanged();
  }

  if (tasks.length === 0) return <div className="empty">No hay tareas aquí.</div>;

  return (
    <table className="table">
      <thead>
        <tr>
          <th style={{ width: 150 }}>Estado</th>
          <th>Nombre</th>
          <th style={{ width: 110 }}>Vencimiento</th>
          <th style={{ width: 110 }}>Prioridad</th>
          {showProject && <th style={{ width: 160 }}>Espacio</th>}
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id} className="row" onClick={() => navigate(`/tareas/${t.id}`)}>
            <td onClick={(e) => e.stopPropagation()}>
              <select
                value={t.status}
                onChange={(e) => changeStatus(t, e.target.value as TaskStatus)}
                aria-label="Estado"
              >
                {Object.entries(TASK_STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </td>
            <td style={{ fontWeight: 500 }}>
              {showProject && t.projectName && (
                <span className="muted" style={{ textTransform: 'uppercase', fontSize: 13 }}>
                  {t.projectName} |{' '}
                </span>
              )}
              {t.title}
            </td>
            <td>
              <DueDate date={t.dueDate} />
            </td>
            <td>
              <PriorityBadge priority={t.priority} />
            </td>
            {showProject && (
              <td data-empty={!t.spaceName}>
                <SpaceTag name={t.spaceName} color={t.spaceColor} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
