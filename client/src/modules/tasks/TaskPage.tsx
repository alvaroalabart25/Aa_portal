import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { tasksApi } from './api';
import { EditableTitle, KebabMenu, NotesBox, StatusSelect } from './components';
import { PRIORITY_LABEL, type Priority, type Task } from './types';

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
      <div className="crumbs">
        <Link to="/agenda" className="btn ghost sm" style={{ marginRight: 8 }}>
          ‹ Agenda
        </Link>
        <Link to="/espacios">Espacios</Link> ›{' '}
        <Link to={`/espacios/${task.spaceId}`}>{task.spaceName}</Link> ›{' '}
        <Link to={`/proyectos/${task.projectId}`}>{task.projectName}</Link> ›{' '}
        <span style={{ color: 'var(--ink)' }}>{task.title}</span>
      </div>

      <div className="page-head">
        <EditableTitle value={task.title} onSave={async (title) => update({ title })} />
        <KebabMenu items={[{ label: 'Eliminar tarea', danger: true, onClick: archive }]} />
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
        </div>
      </div>

      <NotesBox
        value={task.notes ?? null}
        onSave={async (notes) => {
          await tasksApi.update(taskId, { notes });
        }}
      />
    </div>
  );
}
