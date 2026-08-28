import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../../components/Modal';
import { tasksApi } from '../tasks/api';
import TaskTable from '../tasks/TaskTable';
import BloqueGimnasio from '../gym/BloqueGimnasio';
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
      <PortadaDelMes mes={mes} />

      <BloqueMelones mes={mes} onCrear={() => setCreando('melon')} />

      {/* Formación, libro y gimnasio son LA MISMA cosa: algo que se sostiene
          día a día. Tres secciones separadas, cada una con su título y su
          hueco vacío, competían con los objetivos y llenaban la pantalla de
          listas. Aquí van juntas, en columnas, y ninguna pesa más que el mes. */}
      <BloqueConstancia
        formaciones={de('formacion')}
        libros={de('libro')}
        onCrear={setCreando}
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

// ---------------------------------------------------------------- portada

/**
 * La portada del mes: en qué estoy y cuánto queda.
 *
 * Antes esta pantalla empezaba con una línea gris y se metía de cabeza en la
 * primera lista, así que no había dónde mirar primero. Este bloque es el ancla:
 * el mes, los días que le quedan y el avance REAL de lo que te propusiste, con
 * la misma barra de estados que los aros de las tarjetas.
 */
function PortadaDelMes({ mes }: { mes: FocusMes }) {
  const melones = mes.items.filter((i) => i.kind === 'melon' && i.status !== 'aparcado');
  const suma = melones.reduce(
    (a, m) => ({
      hechas: a.hechas + m.tareas.hechas,
      revision: a.revision + m.tareas.revision,
      progreso: a.progreso + m.tareas.progreso,
      bloqueadas: a.bloqueadas + m.tareas.bloqueadas,
      total: a.total + m.tareas.total,
    }),
    { hechas: 0, revision: 0, progreso: 0, bloqueadas: 0, total: 0 },
  );

  // Los días que le quedan al mes, contando hoy. Es lo que convierte un «vas
  // por el 30%» en una decisión.
  const hoy = new Date(`${mes.today}T12:00:00`);
  const finDeMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  const quedan = finDeMes - hoy.getDate() + 1;
  const activos = melones.filter((m) => m.status === 'activo').length;

  return (
    <section className="mc-portada">
      <div className="mc-portada-t">
        {/* h2 y no h1: el h1 de la página es «Agenda» y aquí abajo no puede
            haber otro. El peso se lo da el estilo, no la etiqueta. */}
        <h2>{nombreMesCap(mes.month)}</h2>
        <span className="mc-portada-q">
          {quedan === 1 ? 'último día del mes' : `quedan ${quedan} días`}
        </span>
      </div>
      <p className="mc-portada-d">
        {activos === 0
          ? 'Sin objetivos todavía: elige qué quieres mover este mes.'
          : `${activos} ${activos === 1 ? 'objetivo' : 'objetivos'} entre manos · ${suma.hechas} de ${suma.total} ${suma.total === 1 ? 'tarea' : 'tareas'}`}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- objetivos

function BloqueMelones({ mes, onCrear }: { mes: FocusMes; onCrear: () => void }) {
  const melones = mes.items.filter((i) => i.kind === 'melon');
  const activos = melones.filter((m) => m.status === 'activo').sort((a, z) => atencion(a) - atencion(z));
  // Lo hecho ya no compite por la atención: va al final, en una línea, y lo
  // último conseguido primero. Sigue estando —da gusto verlo— pero no ocupa
  // el sitio de lo que queda por hacer.
  const hechos = melones
    .filter((m) => m.status === 'hecho')
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));

  return (
    <section className="section mc-bloque">
      {/* Los topes son CONTEXTO del título, no contenido: en su propia fila
          parecían dos filtros y separaban el título de las tarjetas. */}
      <div className="mc-head">
        <h2>
          {NOMBRE_TIPO.melon.emoji} {NOMBRE_TIPO.melon.plural}
        </h2>
        <span className="mc-topes">
          {(['trabajo', 'personal'] as FocusScope[]).map((s) => {
            const { usados, tope } = mes.limites[s];
            const pasado = usados > tope;
            return (
              <span key={s} className={`mc-tope${pasado ? ' pasado' : ''}`}>
                {s === 'trabajo' ? 'Trabajo' : 'Personal'} {usados}/{tope}
                {pasado && ' · disperso'}
              </span>
            );
          })}
        </span>
        <button className="btn ghost sm" onClick={onCrear}>
          + Objetivo
        </button>
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
        <div className="mc-hechos">
          {hechos.map((m) => (
            <Link key={m.id} to={`/macro/${m.id}`} className="mk-hecho">
              <span className="mk-hecho-v" aria-hidden="true">
                ✓
              </span>
              <span className="mk-hecho-t">{m.title}</span>
              <span className="mk-hecho-s">{m.scope === 'trabajo' ? 'Trabajo' : 'Personal'}</span>
            </Link>
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
  const { hechas, revision, progreso, bloqueadas, total } = item.tareas;
  const pct = total > 0 ? Math.round((hechas / total) * 100) : 0;
  const hecho = item.status === 'hecho';
  const enMarcha = revision + progreso;

  return (
    <div className={`mk${hecho ? ' hecho' : ''}`}>
      <Link to={`/macro/${item.id}`} className="mk-todo" aria-label={item.title} />

      <span className="mk-aro" style={{ background: aro(item.tareas) }} aria-hidden="true">
        <span className="mk-aro-n">{total > 0 ? `${pct}%` : '—'}</span>
      </span>

      <span className="mk-txt">
        <span className="mk-t">{item.title}</span>
        <span className="mk-sub">
          {item.scope === 'trabajo' ? 'Trabajo' : 'Personal'}
          {total > 0 ? ` · ${hechas} de ${total} ${total === 1 ? 'tarea' : 'tareas'}` : ' · sin tareas todavía'}
          {enMarcha > 0 && ` · ${enMarcha} en marcha`}
          {bloqueadas > 0 && ` · ${bloqueadas} atascada${bloqueadas === 1 ? '' : 's'}`}
          {item.arrastra && ` · viene de ${nombreMes(item.arrastra)}`}
        </span>
      </span>

    </div>
  );
}

/**
 * Cuánta atención pide un objetivo, de más a menos.
 *
 * Delante lo que está en marcha, que es donde hay que seguir empujando; al
 * final lo que ya tiene todas sus tareas cerradas, que no pide nada aunque
 * siga abierto. Dentro de cada grupo se respeta el orden que ya tenían: el
 * `sort` de JavaScript es estable, así que no se descoloca nada por su cuenta.
 */
function atencion(m: FocusItem): number {
  const { hechas, revision, progreso, bloqueadas, total } = m.tareas;
  if (total > 0 && hechas === total) return 2; // no queda nada que hacer
  if (revision + progreso + bloqueadas > 0) return 0; // empezado
  return 1; // por empezar, o sin tareas todavía
}

/**
 * El aro de la tarjeta, por tramos.
 *
 * Un objetivo con cinco tareas donde una está en revisión y otra en progreso no
 * está «al 0%»: está empezado, y el aro plano lo escondía. Así que el aro se
 * parte por estados, en el orden en que avanza el trabajo: lo hecho en negro,
 * la revisión en morado, lo que está en marcha en azul, lo atascado en ámbar y
 * lo que no se ha tocado sin color.
 *
 * Los tramos se acumulan en tantos por ciento exactos, sin redondear, para que
 * la suma no se pase de la vuelta.
 */
function aro(t: FocusItem['tareas']): string {
  if (t.total === 0) return 'var(--paper-soft)';
  const tramos: [number, string][] = [
    [t.hechas, 'var(--ink)'],
    [t.revision, 'var(--morado)'],
    [t.progreso, 'var(--azul)'],
    [t.bloqueadas, 'var(--ambar)'],
  ];
  const partes: string[] = [];
  let desde = 0;
  for (const [n, color] of tramos) {
    if (n <= 0) continue;
    const hasta = desde + (100 * n) / t.total;
    partes.push(`${color} ${desde}% ${hasta}%`);
    desde = hasta;
  }
  partes.push(`var(--paper-soft) ${desde}% 100%`);
  return `conic-gradient(${partes.join(', ')})`;
}

// ---------------------------------------------------------------- constancia

/**
 * Lo que se sostiene día a día: formación, libro y gimnasio.
 *
 * Son la misma clase de cosa —se marcan, hacen racha, no se «terminan» un
 * martes— y tenían tres secciones para ellos solos, cada una con su título y
 * su hueco vacío. Juntos en columnas ocupan un tercio y dejan de competir con
 * los objetivos, que es de lo que va el mes.
 */
function BloqueConstancia({
  formaciones,
  libros,
  onCrear,
  onCambio,
}: {
  formaciones: FocusItem[];
  libros: FocusItem[];
  onCrear: (k: FocusKind) => void;
  onCambio: () => void;
}) {
  // Los libros solo aparecen si hay alguno: no los está leyendo ahora y una
  // columna con «ninguno este mes» es sitio gastado en decir que no hay nada.
  // El «+ Libro» de la cabecera es por dónde vuelven cuando toque.
  const hayLibros = libros.length > 0;

  return (
    <section className="section mc-bloque oscuro">
      <div className="mc-head">
        <h2>Constancia</h2>
        {!hayLibros && (
          <button className="mc-col-mas" onClick={() => onCrear('libro')}>
            + Libro
          </button>
        )}
      </div>

      <div className={`mc-cols${hayLibros ? '' : ' dos'}`}>
        <ColumnaDiaria kind="formacion" items={formaciones} onCrear={onCrear} onCambio={onCambio} />
        {hayLibros && <ColumnaDiaria kind="libro" items={libros} onCrear={onCrear} onCambio={onCambio} />}

        <div className="mc-col">
          <div className="mc-col-t">
            <span>🏋️ Gimnasio</span>
            <Link to="/gimnasio" className="mc-col-mas">
              Entrenar →
            </Link>
          </div>
          <BloqueGimnasio desnudo />
        </div>
      </div>
    </section>
  );
}

/** Una columna de Constancia: su nombre, su «+» y sus tarjetas. */
function ColumnaDiaria({
  kind,
  items,
  onCrear,
  onCambio,
}: {
  kind: FocusKind;
  items: FocusItem[];
  onCrear: (k: FocusKind) => void;
  onCambio: () => void;
}) {
  const activos = items.filter((i) => i.status === 'activo');
  const hechos = items.filter((i) => i.status === 'hecho');
  const t = NOMBRE_TIPO[kind];

  return (
    <div className="mc-col">
      <div className="mc-col-t">
        <span>
          {t.emoji} {t.plural}
        </span>
        <button className="mc-col-mas" onClick={() => onCrear(kind)} aria-label={`Añadir ${t.singular}`}>
          + Añadir
        </button>
      </div>
      {activos.length === 0 && hechos.length === 0 ? (
        <p className="muted mc-col-vacio">Ninguna este mes</p>
      ) : (
        [...activos, ...hechos].map((i) => <TarjetaDiaria key={i.id} item={i} onCambio={onCambio} />)
      )}
    </div>
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
    // `claro` porque vive dentro del bloque negro de Constancia: la tarjeta
    // vuelve a ser blanca con sus puntos negros, sin escribir una regla por
    // cada cosa que lleva dentro.
    <div className={`mk mk-diaria claro${hecho ? ' hecho' : ''}`}>
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
