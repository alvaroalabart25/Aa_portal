import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../../components/Modal';
import { tasksApi } from '../tasks/api';
import TaskTable from '../tasks/TaskTable';
import type { Task } from '../tasks/types';
import {
  focusApi,
  nombreMes,
  nombreMesCap,
  NOMBRE_TIPO,
  type FocusItem,
  type FocusKind,
  type FocusMes,
  type FocusScope,
  type Marca,
} from './api';

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Prioridad alta primero: aquí solo se enseñan las que apremian
const PESO: Record<string, number> = { high: 0, medium: 1, low: 2 };
const porPrioridad = (l: Task[]) => l.slice().sort((a, b) => PESO[a.priority] - PESO[b.priority]);

/**
 * Macro: la vista de pájaro. Lo que tengo entre manos este mes —objetivos,
 * formaciones, libros— en tarjetas.
 *
 * En el móvil no se enseñan las tareas: para eso está la pestaña Agenda, y
 * repetirlas aquí convertía la portada del mes en una lista interminable.
 * Esta pantalla enmarca; Agenda ejecuta.
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

      <BloqueMelones mes={mes} onCrear={() => setCreando('melon')} />

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

      {/* Las tareas, solo en el ordenador: en el móvil están en Agenda y aquí
          alargaban la pantalla sin aportar nada nuevo. */}
      {hoy.vencidas.length > 0 && (
        <section className="section mc-bloque solo-ancho-bloque">
          <h2 className="overdue">Vencidas · {hoy.vencidas.length}</h2>
          <TaskTable tasks={hoy.vencidas} onChanged={cargar} />
        </section>
      )}

      <section className="section mc-bloque solo-ancho-bloque">
        <div className="mc-head">
          <h2>Hoy{hoy.deHoy.length > 0 ? ` · ${hoy.deHoy.length}` : ''}</h2>
          <Link to="/agenda?tab=agenda" className="btn ghost sm">
            Ver la agenda →
          </Link>
        </div>
        {hoy.deHoy.length === 0 ? (
          <p className="muted mc-vacio">Nada con fecha de hoy. Buen momento para atacar un objetivo.</p>
        ) : (
          <TaskTable tasks={hoy.deHoy} onChanged={cargar} />
        )}
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

// ---------------------------------------------------------------- objetivos

function BloqueMelones({ mes, onCrear }: { mes: FocusMes; onCrear: () => void }) {
  const melones = mes.items.filter((i) => i.kind === 'melon');
  const activos = melones.filter((m) => m.status === 'activo');
  const hechos = melones.filter((m) => m.status === 'hecho');

  return (
    <section className="section mc-bloque">
      <div className="mc-head">
        <h2>
          {NOMBRE_TIPO.melon.emoji} {NOMBRE_TIPO.melon.plural}
        </h2>
        <button className="btn ghost sm" onClick={onCrear}>
          + Objetivo
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
          Sin objetivos este mes. Elige máximo {mes.limites.trabajo.tope} de trabajo y {mes.limites.personal.tope}{' '}
          personales, y cuélgales las tareas que ya tienes.
        </p>
      ) : (
        <div className="mk-grid">
          {activos.map((m) => (
            <TarjetaMelon key={m.id} item={m} />
          ))}
        </div>
      )}

      {hechos.length > 0 && (
        <div className="mk-grid mc-hechos">
          {hechos.map((m) => (
            <TarjetaMelon key={m.id} item={m} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Objetivo del mes en tarjeta: un aro con el avance y poco más. Dice de un
 * vistazo si está vivo o parado, que es lo único que hace falta saber desde la
 * portada; el detalle está a un toque.
 */
function TarjetaMelon({ item }: { item: FocusItem }) {
  const { hechas, total } = item.tareas;
  const pct = total > 0 ? Math.round((hechas / total) * 100) : 0;
  const hecho = item.status === 'hecho';

  return (
    <div className={`mk${hecho ? ' hecho' : ''}`}>
      <Link to={`/macro/${item.id}`} className="mk-todo" aria-label={item.title} />

      <span className="mk-aro" style={{ ['--pct' as string]: `${pct}%` }} aria-hidden="true">
        <span className="mk-aro-n">{total > 0 ? `${pct}%` : '—'}</span>
      </span>

      <span className="mk-txt">
        <span className="mk-t">{item.title}</span>
        <span className="mk-sub">
          {item.scope === 'trabajo' ? 'Trabajo' : 'Personal'}
          {total > 0 ? ` · ${hechas} de ${total} ${total === 1 ? 'tarea' : 'tareas'}` : ' · sin tareas todavía'}
          {item.arrastra && ` · viene de ${nombreMes(item.arrastra)}`}
        </span>
      </span>

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
        <div className="mk-grid">
          {[...activos, ...hechos].map((i) => (
            <TarjetaDiaria key={i.id} item={i} onCambio={onCambio} />
          ))}
        </div>
      )}
    </section>
  );
}

const INICIAL_DIA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

/**
 * Formación o libro en tarjeta, con la última semana a la vista.
 *
 * Es un hábito: se marca hoy y mañana vuelve limpio. No hay «mover a mañana» a
 * propósito — un día que no fue, no fue, y eso es justo la información útil.
 * «Hoy no toca» es el descanso adrede y no rompe la racha.
 */
function TarjetaDiaria({ item, onCambio }: { item: FocusItem; onCambio: () => void }) {
  const hecho = item.status === 'hecho';
  const diario = item.daily === 1 && !hecho;

  async function marcar(m: Marca | 'ninguno') {
    await focusApi.marcarDia(item.id, m);
    onCambio();
  }

  return (
    <div className={`mk mk-diaria${hecho ? ' hecho' : ''}`}>
      <Link to={`/macro/${item.id}`} className="mk-todo" aria-label={item.title} />

      <span className="mk-txt">
        <span className="mk-t">{item.title}</span>
        <span className="mk-sub">
          {diario
            ? item.racha > 0
              ? `🔥 ${item.racha} ${item.racha === 1 ? 'día seguido' : 'días seguidos'}`
              : 'Sin racha todavía'
            : hecho
              ? 'Terminado'
              : 'Sin gesto diario'}
          {item.arrastra && ` · viene de ${nombreMes(item.arrastra)}`}
        </span>
      </span>

      {diario ? (
        <>
          <span className="mk-semana" aria-hidden="true">
            {item.semana.map((d, i) => {
              const esHoy = i === item.semana.length - 1;
              return (
                <span key={d.date} className={`mk-dia${d.mark ? ` ${d.mark}` : ''}${esHoy ? ' hoy' : ''}`}>
                  <span className="mk-dia-punto" />
                  {INICIAL_DIA[new Date(`${d.date}T12:00:00`).getDay()]}
                </span>
              );
            })}
          </span>

          <button
            className={`mk-hoy${item.hoy ? ' puesto' : ''}${item.hoy === 'libre' ? ' libre' : ''}`}
            onClick={() => marcar(item.hoy ? 'ninguno' : 'hecho')}
          >
            {item.hoy === 'hecho' ? '✓ Hecho hoy' : item.hoy === 'libre' ? 'Hoy libre' : 'Marcar hoy'}
          </button>
          {!item.hoy && (
            <button className="mk-libre" onClick={() => marcar('libre')} title="No rompe la racha">
              hoy no toca
            </button>
          )}
        </>
      ) : (
        <button
          className={`mk-check${hecho ? ' puesto' : ''}`}
          aria-label={hecho ? 'Reabrir' : 'Dar por terminado'}
          onClick={async () => {
            await focusApi.editar(item.id, { status: hecho ? 'activo' : 'hecho' });
            onCambio();
          }}
        >
          ✓
        </button>
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
            Un objetivo del mes no tiene tareas propias: se nutre de las que ya tienes. Después, en su ficha, le
            cuelgas el benchmark, la landing o las creatividades aunque vivan en espacios distintos.
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
