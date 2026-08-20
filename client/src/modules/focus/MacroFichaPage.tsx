import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { projectsApi, spacesApi } from '../tasks/api';
import type { Project, Space } from '../tasks/types';
import { focusApi, nombreMes, NOMBRE_TIPO, type Candidata, type FocusDetalle } from './api';

const ESTADO_TAREA: Record<string, string> = {
  backlog: 'Backlog',
  in_progress: 'En progreso',
  in_review: 'En revisión',
  blocked: 'Bloqueada',
  completed: 'Completada',
  cancelled: 'Cancelada',
};
const cerrada = (s: string) => s === 'completed' || s === 'cancelled';

function fechaCorta(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

/**
 * Ficha de un objetivo del mes, una formación o un libro.
 *
 * En el objetivo está lo que ninguna otra pantalla del portal sabe hacer: enseñar
 * juntas las tareas de un mismo objetivo aunque vivan en espacios distintos.
 * Las tareas NO se mueven de sitio: aquí solo se señalan.
 */
export default function MacroFichaPage() {
  const { id } = useParams();
  const itemId = Number(id);
  const navigate = useNavigate();
  const [d, setD] = useState<FocusDetalle | null>(null);
  const [error, setError] = useState('');
  const [buscando, setBuscando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setD(await focusApi.detalle(itemId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar');
    }
  }, [itemId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error && !d) return <p className="empty">{error}</p>;
  if (!d) return <p className="empty">Cargando…</p>;

  const t = NOMBRE_TIPO[d.kind];
  const abiertas = d.tasks.filter((x) => !cerrada(x.status));
  const cerradas = d.tasks.filter((x) => cerrada(x.status));

  async function guardar(cambios: Parameters<typeof focusApi.editar>[1]) {
    setD({ ...d!, ...(cambios as Partial<FocusDetalle>) });
    await focusApi.editar(d!.id, cambios).catch(() => cargar());
  }

  return (
    <div>
      <div className="tk-crumbs">
        <Link to="/agenda?tab=macro" className="btn ghost sm tk-back">
          ‹ Macro
        </Link>
        <span className="tk-path">
          <span>
            {t.emoji} {t.singular}
          </span>
          {d.startMonth && (
            <>
              <span className="tk-sep">›</span>
              <span>desde {nombreMes(d.startMonth)}</span>
            </>
          )}
        </span>
      </div>

      <div className="tk-head">
        <div className="tk-eyebrow-row">
          <span className="tk-eyebrow">{d.scope === 'trabajo' ? 'Trabajo' : 'Mis cosas'}</span>
          <button
            className="btn ghost sm"
            onClick={async () => {
              if (!confirm(`¿Quitar «${d.title}» de Macro?`)) return;
              await focusApi.borrar(d.id);
              navigate('/agenda?tab=macro');
            }}
          >
            Quitar
          </button>
        </div>
        <Titulo valor={d.title} onGuardar={(title) => guardar({ title })} />
      </div>

      <div className="mc-ficha-bar">
        <select value={d.status} onChange={(e) => guardar({ status: e.target.value as FocusDetalle['status'] })}>
          <option value="activo">En marcha</option>
          <option value="hecho">Hecho</option>
          <option value="aparcado">Aparcado</option>
        </select>
        {d.daily === 1 && (
          <span className="badge">
            🔥 {d.racha} {d.racha === 1 ? 'día seguido' : 'días seguidos'}
          </span>
        )}
        {d.doneAt && <span className="badge">✓ Hecho el {fechaCorta(d.doneAt)}</span>}
      </div>

      {d.daily === 1 && <Diario item={d} onCambio={cargar} />}

      {d.kind === 'melon' && (
        <section className="section">
          <div className="page-head">
            <h2>Tareas de este objetivo</h2>
            <button className="btn ghost sm" onClick={() => setBuscando(true)}>
              + Asociar tarea
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.6 }}>
            Las tareas siguen viviendo en su proyecto y su espacio. Aquí solo se ven juntas porque comparten objetivo.
          </p>

          {d.tasks.length === 0 ? (
            <p className="empty">Sin tareas asociadas todavía.</p>
          ) : (
            <>
              <ListaTareas tareas={abiertas} itemId={d.id} onCambio={cargar} />
              {cerradas.length > 0 && (
                <>
                  <h3 className="mc-sub">Cerradas · {cerradas.length}</h3>
                  <ListaTareas tareas={cerradas} itemId={d.id} onCambio={cargar} />
                </>
              )}
            </>
          )}

          {buscando && (
            <BuscarTareas
              itemId={d.id}
              onCerrar={(huboCambios) => {
                setBuscando(false);
                if (huboCambios) cargar();
              }}
            />
          )}
        </section>
      )}

      <Notas valor={d.notes ?? ''} onGuardar={(notes) => guardar({ notes })} />
    </div>
  );
}

// ---------------------------------------------------------------- piezas

function Titulo({ valor, onGuardar }: { valor: string; onGuardar: (v: string) => void }) {
  const [editando, setEditando] = useState(false);
  const [txt, setTxt] = useState(valor);
  useEffect(() => setTxt(valor), [valor]);

  function cerrar() {
    setEditando(false);
    const limpio = txt.trim();
    if (limpio && limpio !== valor) onGuardar(limpio);
    else setTxt(valor);
  }

  return editando ? (
    <input
      className="title-input"
      value={txt}
      autoFocus
      onChange={(e) => setTxt(e.target.value)}
      onBlur={cerrar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') cerrar();
        if (e.key === 'Escape') {
          setTxt(valor);
          setEditando(false);
        }
      }}
    />
  ) : (
    <h1 className="title-editable" onClick={() => setEditando(true)} title="Pulsa para renombrar">
      {valor}
    </h1>
  );
}

function ListaTareas({ tareas, itemId, onCambio }: { tareas: FocusDetalle['tasks']; itemId: number; onCambio: () => void }) {
  return (
    <div className="mc-tareas">
      {tareas.map((x) => (
        <div key={x.id} className={`mc-tarea-fila${cerrada(x.status) ? ' cerrada' : ''}`}>
          <span className="dot" style={{ background: x.spaceColor }} />
          {/* con el origen a cuestas: al volver de la tarea, aquí mismo */}
          <Link
            to={`/tareas/${x.id}`}
            state={{ volverA: `${window.location.pathname}${window.location.search}` }}
            className="mc-tarea-titulo"
          >
            <span className="mc-tarea-espacio">{x.spaceName}</span>
            {x.title}
          </Link>
          <span className="muted mc-tarea-estado">{ESTADO_TAREA[x.status] ?? x.status}</span>
          {x.dueDate && <span className="muted mc-tarea-fecha">{fechaCorta(x.dueDate)}</span>}
          <button
            className="mc-tarea-x"
            aria-label="Desasociar del objetivo"
            title="Quitar del objetivo (la tarea no se borra)"
            onClick={async () => {
              await focusApi.quitarTarea(itemId, x.id);
              onCambio();
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Buscador de tareas para asociar al objetivo.
 *
 * Al pulsar una, se asocia y DESAPARECE de la lista sin recargarla: encadenar
 * varias es lo normal, y recargar en cada clic hacía perder el sitio. La ficha
 * del objetivo se refresca una sola vez, al cerrar.
 */
function BuscarTareas({
  itemId,
  onCerrar,
}: {
  itemId: number;
  onCerrar: (huboCambios: boolean) => void;
}) {
  const [q, setQ] = useState('');
  const [espacios, setEspacios] = useState<Space[]>([]);
  const [proyectos, setProyectos] = useState<Project[]>([]);
  const [spaceId, setSpaceId] = useState<number | ''>('');
  const [projectId, setProjectId] = useState<number | ''>('');
  const [lista, setLista] = useState<Candidata[]>([]);
  const [cargando, setCargando] = useState(true);
  const [añadidas, setAñadidas] = useState(0);
  const [error, setError] = useState('');

  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    spacesApi.list().then(setEspacios).catch(() => {});
    // El buscador se abre al final de la lista de tareas: en el móvil quedaba
    // fuera de pantalla y parecía que el botón no hacía nada. Un cuadro después
    // de pintar, porque el autoFocus del campo también mueve el scroll.
    requestAnimationFrame(() => caja.current?.scrollIntoView({ block: 'center' }));
  }, []);

  // los proyectos se filtran por el espacio elegido
  useEffect(() => {
    if (!spaceId) {
      setProyectos([]);
      setProjectId('');
      return;
    }
    projectsApi
      .list({ spaceId: Number(spaceId), status: 'active' })
      .then(setProyectos)
      .catch(() => {});
    setProjectId('');
  }, [spaceId]);

  const buscar = useCallback(async () => {
    setCargando(true);
    try {
      setLista(
        await focusApi.candidatas(itemId, {
          q,
          ...(spaceId ? { spaceId: Number(spaceId) } : {}),
          ...(projectId ? { projectId: Number(projectId) } : {}),
        }),
      );
    } finally {
      setCargando(false);
    }
  }, [itemId, q, spaceId, projectId]);

  useEffect(() => {
    const t = window.setTimeout(buscar, 250);
    return () => window.clearTimeout(t);
  }, [buscar]);

  async function asociar(c: Candidata) {
    // fuera de la lista al momento; si falla, vuelve
    setLista((prev) => prev.filter((x) => x.id !== c.id));
    setAñadidas((n) => n + 1);
    try {
      await focusApi.asociarTarea(itemId, c.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo asociar');
      setLista((prev) => [c, ...prev]);
      setAñadidas((n) => n - 1);
    }
  }

  return (
    <div className="mc-buscar" ref={caja}>
      <div className="mc-buscar-head">
        <input placeholder="Buscar entre todas tus tareas…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <button className="btn" onClick={() => onCerrar(añadidas > 0)}>
          {añadidas > 0 ? `Listo (${añadidas})` : 'Cerrar'}
        </button>
      </div>

      <div className="mc-filtros">
        <select value={spaceId} onChange={(e) => setSpaceId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Todos los espacios</option>
          {espacios.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')}
          disabled={!spaceId}
        >
          {/* sin espacio elegido el selector va apagado: decía «Elige un espacio»
              y parecían dos selectores de espacio, uno al lado del otro */}
          <option value="">{spaceId ? 'Todos los proyectos' : 'Proyecto'}</option>
          {proyectos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {cargando ? (
        <p className="muted mc-buscar-nota">Buscando…</p>
      ) : lista.length === 0 ? (
        <p className="muted mc-buscar-nota">
          {añadidas > 0 ? 'No queda nada más que asociar con esos filtros.' : 'Nada que asociar con eso.'}
        </p>
      ) : (
        <div className="mc-candidatas">
          {lista.map((c) => (
            <button key={c.id} className="mc-candidata" onClick={() => asociar(c)}>
              <span className="dot" style={{ background: c.spaceColor }} />
              <span className="mc-candidata-txt">
                <span className="mc-tarea-espacio">
                  {c.spaceName} · {c.projectName}
                </span>
                {c.title}
              </span>
              <span className="mc-candidata-fecha">{c.dueDate ? fechaCorta(c.dueDate) : 'sin fecha'}</span>
              <span className="mc-candidata-mas">+</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Últimos días del gesto diario, para ver el patrón de un vistazo. */
function Diario({ item, onCambio }: { item: FocusDetalle; onCambio: () => void }) {
  const puestas = new Map(item.dias.map((d) => [d.doneDate, d.mark]));
  const dias: { iso: string; marca: 'hecho' | 'libre' | undefined }[] = [];
  const base = new Date(`${item.today}T12:00:00`);
  for (let i = 27; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dias.push({ iso, marca: puestas.get(iso) });
  }

  return (
    <section className="section">
      <h2>Estos días</h2>
      <div className="mc-dias">
        {dias.map((d) => (
          <button
            key={d.iso}
            className={`mc-dia${d.marca === 'hecho' ? ' hecho' : ''}${d.marca === 'libre' ? ' libre' : ''}${d.iso === item.today ? ' hoy' : ''}`}
            title={`${d.iso}${d.marca ? ` · ${d.marca}` : ''}`}
            onClick={async () => {
              // ciclo: nada → hecho → libre → nada
              const siguiente = d.marca === undefined ? 'hecho' : d.marca === 'hecho' ? 'libre' : 'ninguno';
              await focusApi.marcarDia(item.id, siguiente, d.iso);
              onCambio();
            }}
          />
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
        Pulsa un día para marcarlo. Relleno = hecho, rayado = día libre a propósito (no rompe la racha).
      </p>
    </section>
  );
}

/** Notas de la ficha, con autoguardado al dejar de escribir. */
function Notas({ valor, onGuardar }: { valor: string; onGuardar: (v: string) => void }) {
  const [txt, setTxt] = useState(valor);
  const [estado, setEstado] = useState<'' | 'guardado'>('');
  const timer = useRef<number | undefined>(undefined);
  const ultimo = useRef(valor);

  useEffect(() => {
    setTxt(valor);
    ultimo.current = valor;
  }, [valor]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function cambiar(v: string) {
    setTxt(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (v === ultimo.current) return;
      ultimo.current = v;
      onGuardar(v);
      setEstado('guardado');
      window.setTimeout(() => setEstado(''), 1500);
    }, 700);
  }

  return (
    <section className="section">
      <div className="page-head">
        <h2>Notas</h2>
        {estado && (
          <span className="muted" style={{ fontSize: 12 }}>
            Guardado
          </span>
        )}
      </div>
      <textarea
        value={txt}
        onChange={(e) => cambiar(e.target.value)}
        rows={10}
        placeholder="Lo que vayas aprendiendo, enlaces, ideas, resúmenes…"
        style={{ width: '100%', maxWidth: 680, lineHeight: 1.65, resize: 'vertical' }}
      />
    </section>
  );
}
