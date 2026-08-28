import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { tasksApi } from './api';
import MelonesDeTarea from '../focus/MelonesDeTarea';
import { EditableTitle, KebabMenu, NotesBox, StatusSelect } from './components';
import { avisaAplazada, AVISO_APLAZADA_EN_MARCHA, PRIORITY_LABEL, type Priority, type Task } from './types';

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
}

export default function TaskPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const navigate = useNavigate();
  // De dónde vienes, si quien te trajo lo dijo. Sin eso (entrar por dirección
  // directa, o recargar) se cae a la Agenda, que es de donde se viene casi
  // siempre.
  const location = useLocation();
  const volverA = (location.state as { volverA?: string } | null)?.volverA ?? null;

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

  // El nombre del sitio se saca de la propia tarea cuando se puede: «‹ Web
  // Residencia» dice mucho más que «‹ Proyecto».
  const vuelta = !volverA
    ? { to: '/agenda?tab=agenda', etiqueta: 'Agenda' }
    : volverA.startsWith('/proyectos/')
      ? { to: volverA, etiqueta: task.projectName || 'Proyecto' }
      : volverA.startsWith('/proyectos')
        ? { to: volverA, etiqueta: 'Proyectos' }
        : volverA.startsWith('/tareas')
          ? { to: volverA, etiqueta: 'Tareas' }
          : volverA.startsWith('/macro')
            ? { to: volverA, etiqueta: 'Macro' }
            : { to: volverA, etiqueta: 'Agenda' };

  return (
    <div>
      {/* Una sola línea: volver + dónde estás. El proyecto no va aquí, va de
          antetítulo justo encima del nombre, y el nombre de la tarea no se
          repite: ya es el título. */}
      <div className="tk-crumbs">
        {/* El volver lleva a DONDE VENÍAS. Si entraste desde un proyecto, al
            proyecto: volver a la Agenda y tener que rehacer el camino era lo
            farragoso. Sin origen conocido, a la pestaña Agenda —no a Macro,
            que es para mirar el mes y obligaba a un toque más. */}
        <Link to={vuelta.to} className="btn ghost sm tk-back">
          ‹ {vuelta.etiqueta}
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
          {/* La fecha y su historia en la misma línea: el aviso es sobre ESA
              fecha, y debajo parecía una nota al pie de todo el formulario. */}
          <div className="tk-vence">
            <input
              id="t-due"
              type="date"
              value={task.dueDate ?? ''}
              onChange={(e) => update({ dueDate: e.target.value || null })}
            />
            {/* Cuántas veces la he empujado hacia adelante. No sale siempre:
                mover una tarea larga es normal, y avisar de eso sería ruido.
                Ver `avisaAplazada`. */}
            {avisaAplazada(task.status, task.postponedCount) && (
              <p className={`tk-aplazos${(task.postponedCount ?? 0) >= AVISO_APLAZADA_EN_MARCHA ? ' bola' : ''}`}>
                Aplazada {task.postponedCount} {task.postponedCount === 1 ? 'vez' : 'veces'}
                {task.lastPostponedAt && ` · la última, el ${fechaCorta(task.lastPostponedAt)}`}
              </p>
            )}
          </div>
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
