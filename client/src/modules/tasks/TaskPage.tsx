import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { tasksApi } from './api';
import MelonesDeTarea from '../focus/MelonesDeTarea';
import Bitacora from '../notas/Bitacora';
import { DiasDeRepeticion, EditableTitle, KebabMenu, StatusSelect } from './components';
import {
  avisaAplazada,
  AVISO_APLAZADA_EN_MARCHA,
  PRIORITY_LABEL,
  proximaVuelta,
  textoRepeticion,
  type Priority,
  type Task,
} from './types';

// «1 de julio». El aviso cuenta desde CUÁNDO existe la tarea, no cuándo fue el
// último empujón: cuatro aplazos en una semana no dicen lo mismo que en tres
// meses, y eso solo se ve con la fecha de nacimiento al lado del número.
function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
}

// «el martes 2 de septiembre»: el día de la semana importa tanto como la fecha
// cuando lo que se cuenta es una repetición.
function fechaConDia(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

const hoyMadrid = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', dateStyle: 'short' }).format(new Date());

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

  /**
   * Duplicar: la misma tarea otra vez, para empezar de cero con lo que ya
   * estaba escrito.
   *
   * Se copia lo que DEFINE la tarea —dónde vive, qué es, qué urgencia tiene y
   * para cuándo— y nada de lo que le ha pasado: la copia nace en backlog, sin
   * aplazos y sin las notas del original, que son el diario de ESA tarea y no
   * de la nueva. Y se abre la copia, que es donde vas a seguir escribiendo.
   */
  async function duplicar() {
    if (!task) return;
    const copia = await tasksApi.create({
      projectId: task.projectId,
      title: `${task.title} (copia)`,
      priority: task.priority,
      dueDate: task.dueDate,
    });
    navigate(`/tareas/${copia.id}`, { state: { volverA } });
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
      {/* La cabecera: en negro, todo lo que ES la tarea. El volver lleva a
          DONDE VENÍAS —si entraste desde un proyecto, al proyecto: volver a la
          Agenda y rehacer el camino era lo farragoso—; sin origen conocido, a
          la pestaña Agenda. */}
      <div className="fh oscuro">
        <div className="tk-crumbs">
          <Link to={vuelta.to} className="btn ghost sm tk-back">
            ‹ {vuelta.etiqueta}
          </Link>
          <span className="fh-acciones">
            <KebabMenu
              items={[
                { label: 'Duplicar tarea', onClick: duplicar },
                { label: 'Eliminar tarea', danger: true, onClick: archive },
              ]}
            />
          </span>
        </div>

        <span className="fh-ruta">
          <span className="dot" style={{ background: task.spaceColor }} />
          <Link to="/proyectos">{task.spaceName}</Link>
          <span className="tk-sep">›</span>
          <Link to={`/proyectos/${task.projectId}`}>{task.projectName}</Link>
        </span>
        <EditableTitle value={task.title} onSave={async (title) => update({ title })} />

        <div className="ficha">
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
          {/* Una recurrente no vence: vuelve. Ni campo de fecha ni casilla que
              lo cuente —lo dicen sus días, justo debajo—: tocar esa fecha se
              contradecía con ellos. */}
          {!task.repeatDays && (
            <div>
              <label htmlFor="t-due">Vencimiento</label>
              <input
                id="t-due"
                type="date"
                value={task.dueDate ?? ''}
                onChange={(e) => update({ dueDate: e.target.value || null })}
              />
            </div>
          )}
        </div>

        {/* Los días en los que vuelve. Debajo de la tira porque no es un dato
            de la tarea como el estado, es una regla sobre su vida: cuándo
            deja de estar hecha. */}
        <div className="rep-linea">
          <DiasDeRepeticion value={task.repeatDays} onChange={(repeatDays) => update({ repeatDays })} />
          <span className="rep-texto">
            {(() => {
              if (!task.repeatDays) return 'Se repite: elige los días';
              // Los días y en qué punto está, en una línea: «De lunes a sábado
              // · hecha hoy, vuelve el viernes».
              const hoy = hoyMadrid();
              const dias = textoRepeticion(task.repeatDays);
              if (task.lastDoneAt === hoy) {
                const siguiente = proximaVuelta(task.repeatDays, hoy);
                return `${dias} · hecha hoy, vuelve el ${siguiente ? fechaConDia(siguiente) : 'próximo día'}`;
              }
              const toca = proximaVuelta(task.repeatDays, hoy, true);
              return toca === hoy ? `${dias} · toca hoy` : `${dias} · vuelve el ${toca ? fechaConDia(toca) : 'próximo día'}`;
            })()}
          </span>
        </div>

        {/* Cuántas veces la he empujado hacia adelante. Debajo de la tira, no
            dentro: metido en la casilla de la fecha la estiraba tanto que la
            tira se partía en dos filas. No sale siempre —mover una tarea
            larga es normal, y avisar de eso sería ruido—; ver
            `avisaAplazada`. */}
        {avisaAplazada(task.status, task.postponedCount) && (
          <p
            className={`ficha-nota${
              (task.postponedCount ?? 0) >= AVISO_APLAZADA_EN_MARCHA ? ' aviso' : ''
            }`}
          >
            Aplazada {task.postponedCount} {task.postponedCount === 1 ? 'vez' : 'veces'}
            {task.createdAt && ` desde el ${fechaCorta(task.createdAt)}`}
          </p>
        )}
      </div>

      <MelonesDeTarea taskId={task.id} />

      <Bitacora tipo="tarea" id={task.id} />
    </div>
  );
}
