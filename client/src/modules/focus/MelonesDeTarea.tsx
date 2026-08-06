import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { focusApi, type MelonBreve } from './api';

/**
 * A qué melones (objetivos del mes) está vinculada esta tarea.
 *
 * Vive en la ficha de la tarea porque es ahí donde uno se acuerda: «esto en
 * realidad es de las campañas». El vínculo no mueve la tarea de su proyecto ni
 * de su espacio, solo la señala desde el melón.
 *
 * Si no hay ningún melón activo, no se enseña nada: sería un selector vacío.
 */
export default function MelonesDeTarea({ taskId }: { taskId: number }) {
  const [suyos, setSuyos] = useState<MelonBreve[]>([]);
  const [todos, setTodos] = useState<MelonBreve[]>([]);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    const [mios, activos] = await Promise.all([focusApi.deTarea(taskId), focusApi.melones()]);
    setSuyos(mios);
    setTodos(activos);
  }, [taskId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (todos.length === 0 && suyos.length === 0) return null;

  const puestos = new Set(suyos.map((m) => m.id));
  const disponibles = todos.filter((m) => !puestos.has(m.id));

  async function vincular(id: number) {
    setBusy(true);
    try {
      await focusApi.asociarTarea(id, taskId);
      await cargar();
    } finally {
      setBusy(false);
    }
  }

  async function desvincular(id: number) {
    setBusy(true);
    try {
      await focusApi.quitarTarea(id, taskId);
      await cargar();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h2>Objetivo del mes</h2>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.6 }}>
        Si esta tarea sirve a un melón, vincúlala. La tarea no se mueve de su proyecto: el melón solo la señala para
        poder ver juntas todas las de un mismo objetivo.
      </p>

      {suyos.length > 0 && (
        <div className="mc-vinculos">
          {suyos.map((m) => (
            <span key={m.id} className="mc-vinculo">
              <Link to={`/macro/${m.id}`}>🍈 {m.title}</Link>
              <button
                className="mc-vinculo-x"
                aria-label={`Desvincular de ${m.title}`}
                disabled={busy}
                onClick={() => desvincular(m.id)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {disponibles.length > 0 && (
        <select
          className="mc-vincular"
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && vincular(Number(e.target.value))}
        >
          <option value="">{suyos.length ? 'Vincular a otro melón…' : 'Vincular a un melón…'}</option>
          {disponibles.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title} ({m.scope === 'trabajo' ? 'trabajo' : 'personal'})
            </option>
          ))}
        </select>
      )}
    </section>
  );
}
