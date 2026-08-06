import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../../components/Modal';
import { EventsRadar } from '../events/components';
import { tasksApi } from '../tasks/api';
import type { Task } from '../tasks/types';
import { focusApi, nombreMes, nombreMesCap, NOMBRE_TIPO, type FocusItem, type FocusKind, type FocusMes, type FocusScope } from './api';

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Prioridad alta primero: aquí solo se enseñan las que apremian
const PESO: Record<string, number> = { high: 0, medium: 1, low: 2 };
const porPrioridad = (l: Task[]) => l.slice().sort((a, b) => PESO[a.priority] - PESO[b.priority]);

/**
 * Macro: la vista de pájaro. Lo que tengo entre manos este mes (melones,
 * formaciones, libros) frente a lo que toca hoy.
 *
 * Las tareas de hoy y los eventos van en versión MÍNIMA a propósito: enteros
 * ya están en Agenda, y repetirlos sería tener dos pantallas diciendo lo mismo.
 * Esta enmarca; Agenda ejecuta.
 */
export default function MacroTab() {
  const [mes, setMes] = useState<FocusMes | null>(null);
  const [tareas, setTareas] = useState<Task[]>([]);
  const [creando, setCreando] = useState<FocusKind | null>(null);

  const cargar = useCallback(async () => {
    const [m, t] = await Promise.all([focusApi.mes(), tasksApi.list({ status: 'open' })]);
    setMes(m);
    setTareas(t);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const hoy = useMemo(() => {
    const iso = isoLocal(new Date());
    const deHoy = tareas.filter((t) => t.dueDate === iso);
    const vencidas = tareas.filter((t) => t.dueDate && t.dueDate < iso);
    return { deHoy: porPrioridad(deHoy), vencidas: porPrioridad(vencidas) };
  }, [tareas]);

  if (!mes) return <p className="empty">Cargando…</p>;

  const de = (k: FocusKind) => mes.items.filter((i) => i.kind === k);

  return (
    <div>
      <p className="muted mc-mes">{nombreMesCap(mes.month)} · lo que tengo entre manos</p>

      <BloqueMelones mes={mes} onCrear={() => setCreando('melon')} onCambio={cargar} />

      <BloqueDiario
        titulo={NOMBRE_TIPO.formacion.plural}
        emoji={NOMBRE_TIPO.formacion.emoji}
        items={de('formacion')}
        vacio="Ninguna formación este mes."
        onCrear={() => setCreando('formacion')}
        onCambio={cargar}
      />

      <BloqueDiario
        titulo={NOMBRE_TIPO.libro.plural}
        emoji={NOMBRE_TIPO.libro.emoji}
        items={de('libro')}
        vacio="Ningún libro este mes."
        onCrear={() => setCreando('libro')}
        onCambio={cargar}
      />

      {/* Hoy y la semana, en corto: lo completo está en Agenda */}
      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>Hoy</h2>
          <Link to="/agenda" className="btn ghost sm">
            Ver la agenda →
          </Link>
        </div>
        {hoy.deHoy.length === 0 && hoy.vencidas.length === 0 ? (
          <p className="muted mc-vacio">Nada con fecha de hoy. Buen momento para atacar un melón.</p>
        ) : (
          <div className="mc-hoy">
            {hoy.vencidas.length > 0 && (
              <span className="badge mc-vencidas">
                {hoy.vencidas.length} {hoy.vencidas.length === 1 ? 'vencida' : 'vencidas'}
              </span>
            )}
            <span className="badge">
              {hoy.deHoy.length} {hoy.deHoy.length === 1 ? 'tarea hoy' : 'tareas hoy'}
            </span>
            {hoy.deHoy
              .filter((t) => t.priority === 'high')
              .slice(0, 3)
              .map((t) => (
                <Link key={t.id} to={`/tareas/${t.id}`} className="mc-tarea">
                  ↑ {t.title}
                </Link>
              ))}
          </div>
        )}
      </section>

      <section className="section mc-bloque">
        <h2>Esta semana</h2>
        <EventsRadar />
      </section>

      {creando && (
        <NuevoModal
          kind={creando}
          onClose={() => setCreando(null)}
          onCreado={() => {
            setCreando(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- melones

function BloqueMelones({ mes, onCrear, onCambio }: { mes: FocusMes; onCrear: () => void; onCambio: () => void }) {
  const melones = mes.items.filter((i) => i.kind === 'melon');
  const activos = melones.filter((m) => m.status === 'activo');
  const hechos = melones.filter((m) => m.status === 'hecho');

  return (
    <section className="section mc-bloque">
      <div className="mc-head">
        <h2>
          {NOMBRE_TIPO.melon.emoji} {NOMBRE_TIPO.melon.plural}
        </h2>
        <button className="btn sm" onClick={onCrear}>
          + Melón
        </button>
      </div>

      <div className="mc-topes">
        {(['trabajo', 'personal'] as FocusScope[]).map((s) => {
          const { usados, tope } = mes.limites[s];
          const pasado = usados > tope;
          return (
            <span key={s} className={`mc-tope${pasado ? ' pasado' : ''}`}>
              {s === 'trabajo' ? 'Trabajo' : 'Personal'} {usados}/{tope}
              {pasado && ' · estás disperso'}
            </span>
          );
        })}
      </div>

      {activos.length === 0 ? (
        <p className="muted mc-vacio">
          Sin melones este mes. Elige máximo {mes.limites.trabajo.tope} de trabajo y {mes.limites.personal.tope}{' '}
          personales, y cuélgales las tareas que ya tienes.
        </p>
      ) : (
        <div className="mc-lista">
          {activos.map((m) => (
            <FilaMelon key={m.id} item={m} onCambio={onCambio} />
          ))}
        </div>
      )}

      {hechos.length > 0 && (
        <div className="mc-lista mc-hechos">
          {hechos.map((m) => (
            <FilaMelon key={m.id} item={m} onCambio={onCambio} />
          ))}
        </div>
      )}
    </section>
  );
}

function FilaMelon({ item, onCambio }: { item: FocusItem; onCambio: () => void }) {
  const { hechas, total } = item.tareas;
  const pct = total > 0 ? Math.round((hechas / total) * 100) : 0;
  const hecho = item.status === 'hecho';

  return (
    <div className={`mc-fila${hecho ? ' hecho' : ''}`}>
      <button
        className="mc-check"
        aria-label={hecho ? 'Reabrir' : 'Dar por hecho'}
        onClick={async () => {
          await focusApi.editar(item.id, { status: hecho ? 'activo' : 'hecho' });
          onCambio();
        }}
      >
        {hecho ? '✓' : ''}
      </button>
      <Link to={`/macro/${item.id}`} className="mc-titulo">
        {item.title}
        <span className="mc-etiquetas">
          <span className="mc-ambito">{item.scope === 'trabajo' ? 'trabajo' : 'personal'}</span>
          {item.arrastra && <span className="mc-arrastra">viene de {nombreMes(item.arrastra)}</span>}
        </span>
      </Link>
      {total > 0 ? (
        <span className="mc-avance">
          <span className="mc-bar">
            <span className="mc-bar-fill" style={{ width: `${pct}%` }} />
          </span>
          {hechas}/{total}
        </span>
      ) : (
        <span className="muted mc-sintareas">sin tareas</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- diario

function BloqueDiario({
  titulo,
  emoji,
  items,
  vacio,
  onCrear,
  onCambio,
}: {
  titulo: string;
  emoji: string;
  items: FocusItem[];
  vacio: string;
  onCrear: () => void;
  onCambio: () => void;
}) {
  const activos = items.filter((i) => i.status === 'activo');
  const hechos = items.filter((i) => i.status === 'hecho');

  return (
    <section className="section mc-bloque">
      <div className="mc-head">
        <h2>
          {emoji} {titulo}
        </h2>
        <button className="btn ghost sm" onClick={onCrear}>
          + Añadir
        </button>
      </div>

      {activos.length === 0 && hechos.length === 0 ? (
        <p className="muted mc-vacio">{vacio}</p>
      ) : (
        <div className="mc-lista">
          {[...activos, ...hechos].map((i) => (
            <FilaDiaria key={i.id} item={i} onCambio={onCambio} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Fila con gesto diario. Es un hábito: se marca hoy y mañana vuelve limpio.
 * No hay «mover a mañana» a propósito — un día que no fue, no fue, y eso es la
 * información útil. «Hoy no toca» es el día de descanso adrede y no rompe la racha.
 */
function FilaDiaria({ item, onCambio }: { item: FocusItem; onCambio: () => void }) {
  const hecho = item.status === 'hecho';

  async function marcar(m: 'hecho' | 'libre' | 'ninguno') {
    await focusApi.marcarDia(item.id, m);
    onCambio();
  }

  return (
    <div className={`mc-fila${hecho ? ' hecho' : ''}`}>
      {item.daily === 1 && !hecho ? (
        <button
          className={`mc-check${item.hoy ? ' puesto' : ''}${item.hoy === 'libre' ? ' libre' : ''}`}
          aria-label={item.hoy ? 'Desmarcar hoy' : 'Marcar hoy como hecho'}
          title={item.hoy === 'libre' ? 'Hoy marcado como libre' : 'Hoy'}
          onClick={() => marcar(item.hoy ? 'ninguno' : 'hecho')}
        >
          {item.hoy === 'hecho' ? '✓' : item.hoy === 'libre' ? '–' : ''}
        </button>
      ) : (
        <button
          className="mc-check"
          aria-label={hecho ? 'Reabrir' : 'Dar por terminado'}
          onClick={async () => {
            await focusApi.editar(item.id, { status: hecho ? 'activo' : 'hecho' });
            onCambio();
          }}
        >
          {hecho ? '✓' : ''}
        </button>
      )}

      <Link to={`/macro/${item.id}`} className="mc-titulo">
        {item.title}
        <span className="mc-etiquetas">
          {item.arrastra && <span className="mc-arrastra">viene de {nombreMes(item.arrastra)}</span>}
        </span>
      </Link>

      {item.daily === 1 && !hecho && (
        <>
          {item.racha > 0 && (
            <span className="mc-racha" title="Días seguidos">
              🔥 {item.racha}
            </span>
          )}
          {!item.hoy && (
            <button className="mc-libre" onClick={() => marcar('libre')} title="No rompe la racha">
              hoy no toca
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- alta

function NuevoModal({ kind, onClose, onCreado }: { kind: FocusKind; onClose: () => void; onCreado: () => void }) {
  const [titulo, setTitulo] = useState('');
  const [scope, setScope] = useState<FocusScope>('trabajo');
  const [daily, setDaily] = useState(kind !== 'melon');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const t = NOMBRE_TIPO[kind];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await focusApi.crear({ kind, title: titulo.trim(), scope, ...(kind === 'melon' ? {} : { daily }) });
      onCreado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Nuevo ${t.singular}`} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label htmlFor="mc-t">{kind === 'melon' ? 'Objetivo del mes' : 'Título'}</label>
          <input
            id="mc-t"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            autoFocus
            placeholder={kind === 'melon' ? 'Campañas GAds y Meta' : ''}
          />
        </div>

        <div className="field">
          <label htmlFor="mc-s">¿De qué es?</label>
          <select id="mc-s" value={scope} onChange={(e) => setScope(e.target.value as FocusScope)}>
            <option value="trabajo">Trabajo</option>
            <option value="personal">Mis cosas</option>
          </select>
        </div>

        {kind !== 'melon' && (
          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13.5, color: 'var(--ink)' }}>
            <input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              Con gesto diario
              <span className="muted" style={{ display: 'block', fontSize: 12.5, marginTop: 2 }}>
                Cada día aparece aquí para marcarlo, y lleva la cuenta de los días seguidos. Puedes marcar un día como
                libre sin romper la racha.
              </span>
            </span>
          </label>
        )}

        {kind === 'melon' && (
          <p className="muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.6 }}>
            Un melón no tiene tareas propias: se nutre de las que ya tienes. Después, en su ficha, le cuelgas el
            benchmark, la landing o las creatividades aunque vivan en espacios distintos.
          </p>
        )}

        {error && <div className="error-msg">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={busy || !titulo.trim()}>
            {busy ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
