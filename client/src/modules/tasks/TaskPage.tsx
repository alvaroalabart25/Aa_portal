import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { tasksApi } from './api';
import MelonesDeTarea from '../focus/MelonesDeTarea';
import { EditableTitle, KebabMenu, NotesBox, StatusSelect } from './components';
import { PRIORITY_LABEL, type Priority, type Task } from './types';

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
}

export default function TaskPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const navigate = useNavigate();

  const [task, setTask] = useState<Task | null>(null);

  const load = useCallback(async () => {
    setTask(await tasksApi.one(taskId));
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  async function update(data: Partial<Task>) {
    await tasksApi.update(taskId, data);
    await load();
  }

  async function archive() {
    if (!confirm('¿Archivar esta tarea? Dejará de aparecer en las listas.')) return;
    await tasksApi.archive(taskId);
    navigate(-1);
  }

  if (!task) return <p className="muted">Cargando…</p>;

  return (
    <div>
      {/* Una sola línea: volver + dónde estás. El proyecto no va aquí, va de
          antetítulo justo encima del nombre, y el nombre de la tarea no se
          repite: ya es el título. */}
      <div className="tk-crumbs">
        <Link to="/agenda" className="btn ghost sm tk-back">
          ‹ Agenda
        </Link>
        <span className="tk-path">
          <Link to="/proyectos">Proyectos</Link>
          <span className="tk-sep">›</span>
          {/* el espacio agrupa, pero ya no es una página: no se enlaza */}
          <span>{task.spaceName}</span>
        </span>
      </div>

      <div className="tk-head">
        <div className="tk-eyebrow-row">
          <Link to={`/proyectos/${task.projectId}`} className="tk-eyebrow">
            {task.projectName}
          </Link>
          <KebabMenu items={[{ label: 'Eliminar tarea', danger: true, onClick: archive }]} />
        </div>
        <EditableTitle value={task.title} onSave={async (title) => update({ title })} />
      </div>

      <div className="form-grid" style={{ marginTop: 18 }}>
        <div>
          <label>Estado</label>
          <StatusSelect value={task.status} onChange={(status) => update({ status })} />
        </div>
        <div>
          <label htmlFor="t-priority">Prioridad</label>
          <select
            id="t-priority"
            value={task.priority}
            onChange={(e) => update({ priority: e.target.value as Priority })}
          >
            {Object.entries(PRIORITY_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="t-due">Vencimiento</label>
          <input
            id="t-due"
            type="date"
            value={task.dueDate ?? ''}
            onChange={(e) => update({ dueDate: e.target.value || null })}
          />
          {/* El dato honesto de esta ficha: cuántas veces la he empujado. Solo
              cuenta empujarla hacia adelante, no cada vez que toco la fecha. */}
          {!!task.postponedCount && (
            <p className={`tk-aplazos${task.postponedCount >= 4 ? ' bola' : ''}`}>
              Aplazada {task.postponedCount} {task.postponedCount === 1 ? 'vez' : 'veces'}
              {task.lastPostponedAt && ` · la última, el ${fechaCorta(task.lastPostponedAt)}`}
            </p>
          )}
        </div>
      </div>

      <MelonesDeTarea taskId={task.id} />

      <NotesBox
        value={task.notes ?? null}
        onSave={async (notes) => {
          await tasksApi.update(taskId, { notes });
        }}
      />
    </div>
  );
}
