import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { tasksApi } from './api';
import { Aplazada, DueDateEdit, PrioritySelect, SpaceTag, StatusSelect } from './components';
import type { Priority, Task, TaskStatus } from './types';

// Tabla de tareas reutilizable (Agenda, detalle de proyecto...).
// En PC: tabla con columnas. En móvil: cada fila se convierte en caja (CSS).
export default function TaskTable({
  tasks,
  showProject = true,
  onChanged,
  acciones,
}: {
  tasks: Task[];
  showProject?: boolean;
  onChanged: () => void;
  /** Un control extra al final de cada fila, para quien lo necesite (quitar la
   *  tarea de un objetivo, por ejemplo). Sin él, la tabla es la de siempre. */
  acciones?: (t: Task) => ReactNode;
}) {
  const navigate = useNavigate();
  // Desde dónde se abre la tarea. La tabla no sabe en qué pantalla vive, pero
  // sí sabe en qué dirección está: se la lleva consigo para que el «volver» de
  // la tarea sepa a dónde regresar (a su proyecto, a Tareas, a la Agenda…).
  const location = useLocation();
  const volverA = location.pathname + location.search;

  async function changeStatus(task: Task, status: TaskStatus) {
    await tasksApi.update(task.id, { status });
    onChanged();
  }

  if (tasks.length === 0) return <div className="empty">No hay tareas aquí.</div>;

  return (
    <table className="table task-table">
      <thead>
        <tr>
          <th style={{ width: '14%' }}>Estado</th>
          <th>Nombre</th>
          <th style={{ width: '12%' }}>Vencimiento</th>
          <th style={{ width: '12%' }}>Prioridad</th>
          {showProject && <th style={{ width: '17%' }}>Espacio</th>}
          {acciones && <th style={{ width: '4%' }} aria-label="Acciones" />}
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr
            key={t.id}
            className="row"
            onClick={(e) => {
              // Los controles de la fila (estado, fecha, prioridad) se manejan
              // solos. Antes esto se hacía parando la propagación en la CELDA
              // entera, y en el móvil eso dejaba media tarjeta muerta: la celda
              // del estado ocupa el ancho completo, así que tocar la primera
              // línea de la tarjeta —donde cae el pulgar— no hacía nada.
              if ((e.target as HTMLElement).closest('button, select, input, a, textarea')) return;
              navigate(`/tareas/${t.id}`, { state: { volverA } });
            }}
          >
            <td>
              <StatusSelect value={t.status} onChange={(s) => changeStatus(t, s)} />
            </td>
            <td style={{ fontWeight: 500 }}>
              {showProject && t.projectName && (
                <span className="muted" style={{ textTransform: 'uppercase', fontSize: 13 }}>
                  {t.projectName} |{' '}
                </span>
              )}
              {t.title}
              <Aplazada veces={t.postponedCount} />
            </td>
            <td>
              <DueDateEdit
                value={t.dueDate}
                onChange={async (dueDate) => {
                  await tasksApi.update(t.id, { dueDate });
                  onChanged();
                }}
              />
            </td>
            <td>
              <PrioritySelect
                value={t.priority}
                onChange={async (priority: Priority) => {
                  await tasksApi.update(t.id, { priority });
                  onChanged();
                }}
              />
            </td>
            {showProject && (
              <td data-empty={!t.spaceName}>
                <SpaceTag name={t.spaceName} color={t.spaceColor} />
              </td>
            )}
            {acciones && <td className="tt-acciones">{acciones(t)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
