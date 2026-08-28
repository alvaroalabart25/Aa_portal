import { useEffect, useState, type ReactNode } from 'react';
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
  seleccionable = false,
}: {
  tasks: Task[];
  showProject?: boolean;
  onChanged: () => void;
  /** Un control extra al final de cada fila, para quien lo necesite (quitar la
   *  tarea de un objetivo, por ejemplo). Sin él, la tabla es la de siempre. */
  acciones?: (t: Task) => ReactNode;
  /** Casillas para marcar varias y cambiarles la fecha de una vez. */
  seleccionable?: boolean;
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

  // Lo marcado vive aquí dentro: la tabla se basta sola y quien la usa solo
  // tiene que decir que quiere las casillas.
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set());
  const [moviendo, setMoviendo] = useState(false);
  // La fecha elegida a mano, esperando a que se pulse «Mover»
  const [fecha, setFecha] = useState('');

  // Si la lista cambia (se recarga, se filtra), se olvida lo que ya no está:
  // arrastrar una selección invisible es la forma de tocar lo que no querías.
  const ids = tasks.map((t) => t.id).join(',');
  useEffect(() => {
    setMarcadas((s) => {
      const vivos = new Set(tasks.map((t) => t.id));
      const quedan = [...s].filter((id) => vivos.has(id));
      return quedan.length === s.size ? s : new Set(quedan);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  function marcar(id: number, si: boolean) {
    setMarcadas((s) => {
      const n = new Set(s);
      if (si) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  /**
   * Cambiar la fecha de todas las marcadas.
   *
   * Van en paralelo y CADA UNA por su endpoint de siempre: así el contador de
   * aplazamientos cuenta como debe —seis tareas empujadas son seis aplazos— en
   * vez de inventar una vía rápida que se salte las reglas.
   */
  async function moverTodas(dueDate: string | null) {
    if (!marcadas.size || moviendo) return;
    setMoviendo(true);
    try {
      await Promise.all([...marcadas].map((id) => tasksApi.update(id, { dueDate })));
      setMarcadas(new Set());
      setFecha('');
      onChanged();
    } finally {
      setMoviendo(false);
    }
  }

  /** Hoy + n días, en la zona del navegador. */
  function enDias(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  if (tasks.length === 0) return <div className="empty">No hay tareas aquí.</div>;

  const todas = marcadas.size === tasks.length && tasks.length > 0;

  return (
    <>
      {seleccionable && marcadas.size > 0 && (
        <div className="tt-barra">
          <span className="tt-que">
            Mover{' '}
            <b>
              {marcadas.size} {marcadas.size === 1 ? 'tarea' : 'tareas'}
            </b>{' '}
            a
          </span>
          {/* El calendario NO mueve nada al vuelo. En el móvil, el selector va
              lanzando `change` mientras giras las ruedas: aplicarlo a la
              primera cerraba la barra a mitad de elegir —«no puedo seleccionar
              las fechas»— y antes, con un valor a medias, hasta les quitaba la
              fecha. Aquí solo se apunta; mueve el botón de al lado. */}
          <input
            className="tt-fecha"
            type="date"
            value={fecha}
            disabled={moviendo}
            aria-label="Nueva fecha"
            onChange={(e) => setFecha(e.target.value)}
          />
          <button
            className="tt-mover"
            disabled={moviendo || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)}
            onClick={() => moverTodas(fecha)}
          >
            Mover
          </button>
          <button disabled={moviendo} onClick={() => moverTodas(enDias(0))}>
            Hoy
          </button>
          <button disabled={moviendo} onClick={() => moverTodas(enDias(1))}>
            Mañana
          </button>
          <button disabled={moviendo} onClick={() => moverTodas(enDias(7))}>
            +1 semana
          </button>
          <button className="tt-barra-x" aria-label="Quitar selección" onClick={() => setMarcadas(new Set())}>
            Quitar selección
          </button>
        </div>
      )}

    <table className={`table task-table${seleccionable ? ' con-sel' : ''}`}>
      <thead>
        <tr>
          {seleccionable && (
            <th style={{ width: '3%' }}>
              <input
                type="checkbox"
                checked={todas}
                aria-label={todas ? 'Desmarcar todas' : 'Marcar todas'}
                onChange={(e) => setMarcadas(e.target.checked ? new Set(tasks.map((t) => t.id)) : new Set())}
              />
            </th>
          )}
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
            className={`row${marcadas.has(t.id) ? ' marcada' : ''}`}
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
            {seleccionable && (
              <td className="tt-sel">
                <input
                  type="checkbox"
                  checked={marcadas.has(t.id)}
                  aria-label={`Marcar ${t.title}`}
                  onChange={(e) => marcar(t.id, e.target.checked)}
                />
              </td>
            )}
            <td>
              <StatusSelect value={t.status} onChange={(s) => changeStatus(t, s)} />
            </td>
            <td className="tt-nombre">
              {showProject && t.projectName && <span className="tt-proy">{t.projectName}</span>}
              {t.title}
              <Aplazada veces={t.postponedCount} estado={t.status} />
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
    </>
  );
}
