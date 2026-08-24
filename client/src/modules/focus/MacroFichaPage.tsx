import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Modal from '../../components/Modal';
import { projectsApi, spacesApi, tasksApi } from '../tasks/api';
import TaskTable from '../tasks/TaskTable';
import type { Priority, Project, Space } from '../tasks/types';
import { focusApi, nombreMes, NOMBRE_TIPO, type Candidata, type FocusDetalle, type ProyectoDelMelon } from './api';

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
  const [vinculando, setVinculando] = useState(false);
  const [creando, setCreando] = useState(false);

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

  /**
   * Quitar la tarea del objetivo. Va como acción de la fila y NO borra nada:
   * la tarea sigue viviendo en su proyecto, solo deja de contar aquí.
   */
  const quitar = (t: { id: number }) => (
    <button
      className="mc-tarea-x"
      aria-label="Quitar del objetivo"
      title="Quitar del objetivo (la tarea no se borra)"
      onClick={async () => {
        await focusApi.quitarTarea(Number(id), t.id);
        cargar();
      }}
    >
      ✕
    </button>
  );

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

      {/* Las fechas exactas se ponen aquí; en la plani se arrastran por semanas.
          El gesto es rápido y basto, el formulario es preciso: cada uno a lo
          suyo. */}
      {d.kind === 'melon' && (
        <div className="mc-fechas">
          <label>
            <span>Empieza</span>
            <input
              type="date"
              value={d.startsOn ?? ''}
              onChange={(e) => guardar({ startsOn: e.target.value || null })}
            />
          </label>
          <label>
            <span>Se saca</span>
            <input type="date" value={d.dueOn ?? ''} onChange={(e) => guardar({ dueOn: e.target.value || null })} />
          </label>
          <span className="mc-fechas-nota">
            {d.dueOn
              ? d.startsOn
                ? 'Se dibuja como una barra en la plani.'
                : 'Se dibuja como un hito en la plani. Pon la fecha de inicio si dura semanas.'
              : 'Sin fecha de entrega no sale en la plani.'}
          </span>
        </div>
      )}

      {d.daily === 1 && <Diario item={d} onCambio={cargar} />}

      {/* Las notas, antes que las tareas: es donde se apunta el porqué del
          objetivo, y se lee antes de ponerse a hacer nada. */}
      <Notas valor={d.notes ?? ''} onGuardar={(notes) => guardar({ notes })} />

      {/* De dónde sale este objetivo. Vincular un proyecto no arrastra sus
          tareas: dice dónde buscarlas y dónde crear la siguiente. */}
      {d.kind === 'melon' && (
        <section className="section">
          <div className="page-head">
            <h2>Proyectos</h2>
            <button className="btn ghost sm" onClick={() => setVinculando(true)}>
              + Vincular proyecto
            </button>
          </div>
          {d.projects.length === 0 ? (
            <p className="muted mc-vacio">
              Sin proyectos. Vincula uno y las tareas de este objetivo saldrán de ahí, en vez de buscarlas por todo el
              portal.
            </p>
          ) : (
            <div className="mc-proys">
              {d.projects.map((p) => (
                <span key={p.id} className="mc-proy">
                  <span className="dot" style={{ background: p.spaceColor }} />
                  <Link to={`/proyectos/${p.id}`}>{p.name}</Link>
                  <em>{p.spaceName}</em>
                  <button
                    aria-label={`Quitar ${p.name} del objetivo`}
                    title="Quitar del objetivo (las tareas ya asociadas se quedan)"
                    onClick={async () => {
                      await focusApi.quitarProyecto(d.id, p.id);
                      cargar();
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          {vinculando && (
            <VincularProyecto
              itemId={d.id}
              yaPuestos={d.projects.map((p) => p.id)}
              onCerrar={(hubo) => {
                setVinculando(false);
                if (hubo) cargar();
              }}
            />
          )}
        </section>
      )}

      {d.kind === 'melon' && (
        <section className="section">
          <div className="page-head">
            <h2>Tareas de este objetivo</h2>
            <div className="head-acciones">
              <button className="btn ghost sm" onClick={() => setBuscando(true)}>
                + Asociar
              </button>
              <button className="btn sm" disabled={d.projects.length === 0} onClick={() => setCreando(true)}>
                + Nueva tarea
              </button>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.6 }}>
            {d.projects.length === 0
              ? 'Vincula un proyecto arriba para poder crear tareas desde aquí.'
              : 'Las tareas siguen viviendo en su proyecto y su espacio. Aquí solo se ven juntas porque comparten objetivo.'}
          </p>

          {d.tasks.length === 0 ? (
            <p className="empty">Sin tareas asociadas todavía.</p>
          ) : (
            <>
              <TaskTable tasks={abiertas} onChanged={cargar} acciones={quitar} />
              {cerradas.length > 0 && (
                <>
                  <h3 className="mc-sub">Cerradas · {cerradas.length}</h3>
                  <TaskTable tasks={cerradas} onChanged={cargar} acciones={quitar} />
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

          {creando && (
            <NuevaTareaDelObjetivo
              itemId={d.id}
              proyectos={d.projects}
              onCerrar={() => setCreando(false)}
              onCreada={() => {
                setCreando(false);
                cargar();
              }}
            />
          )}
        </section>
      )}

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
        rows={4}
        placeholder="Lo que vayas aprendiendo, enlaces, ideas, resúmenes…"
        /* A todo lo ancho y baja: la caja de diez líneas ocupaba media pantalla
           aunque hubiera dos frases. Se estira quien la necesite. */
        style={{ width: '100%', lineHeight: 1.65, resize: 'vertical' }}
      />
    </section>
  );
}

/**
 * Vincular un proyecto al objetivo.
 *
 * Se listan los proyectos ACTIVOS agrupados por espacio, porque es como los
 * tiene en la cabeza: «la web de la residencia» está en CSO Digital. Los que ya
 * están vinculados no salen: volver a elegirlos no haría nada.
 */
function VincularProyecto({
  itemId,
  yaPuestos,
  onCerrar,
}: {
  itemId: number;
  yaPuestos: number[];
  onCerrar: (hubo: boolean) => void;
}) {
  const [proyectos, setProyectos] = useState<Project[] | null>(null);
  const [hubo, setHubo] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    projectsApi.list({ status: 'active' }).then(setProyectos).catch(() => setProyectos([]));
  }, []);

  const puestos = new Set(yaPuestos);
  const visibles = (proyectos ?? []).filter(
    (p) => !puestos.has(p.id) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())),
  );

  return (
    <Modal title="Vincular un proyecto" onClose={() => onCerrar(hubo)}>
      <p className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>
        Vincularlo no trae sus tareas: dice de dónde salen las de este objetivo y dónde se crean las nuevas.
      </p>
      <input placeholder="Buscar un proyecto…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="mc-candidatas">
        {proyectos === null ? (
          <p className="muted">Cargando…</p>
        ) : visibles.length === 0 ? (
          <p className="muted">No queda ninguno por vincular.</p>
        ) : (
          visibles.map((p) => (
            <button
              key={p.id}
              className="mc-candidata"
              onClick={async () => {
                await focusApi.asociarProyecto(itemId, p.id);
                setHubo(true);
                setProyectos((lista) => (lista ?? []).filter((x) => x.id !== p.id));
              }}
            >
              <span className="dot" style={{ background: p.spaceColor }} />
              <span className="mc-candidata-t">{p.name}</span>
              <span className="muted">{p.spaceName}</span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}

/**
 * Crear una tarea desde el objetivo.
 *
 * Nace ya vinculada —crearla aquí es decir que es de este objetivo— y en el
 * proyecto que se elija. Con un solo proyecto vinculado no hay nada que
 * elegir: viene puesto y el campo ni estorba.
 */
function NuevaTareaDelObjetivo({
  itemId,
  proyectos,
  onCerrar,
  onCreada,
}: {
  itemId: number;
  proyectos: ProyectoDelMelon[];
  onCerrar: () => void;
  onCreada: () => void;
}) {
  const [titulo, setTitulo] = useState('');
  const [proyecto, setProyecto] = useState(proyectos[0]?.id ?? 0);
  const [vence, setVence] = useState('');
  const [prioridad, setPrioridad] = useState<Priority>('medium');
  const [guardando, setGuardando] = useState(false);

  async function crear() {
    if (!titulo.trim() || !proyecto || guardando) return;
    setGuardando(true);
    try {
      // Se crea con la API de tareas de siempre —vive en su proyecto, como
      // cualquier otra— y acto seguido se cuelga del objetivo.
      const tarea = await tasksApi.create({
        projectId: proyecto,
        title: titulo.trim(),
        priority: prioridad,
        dueDate: vence || null,
      });
      await focusApi.asociarTarea(itemId, tarea.id);
      onCreada();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal title="Nueva tarea" onClose={onCerrar}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          crear();
        }}
      >
        <label>
          <span>Qué hay que hacer</span>
          <input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Página de contacto" />
        </label>

        {proyectos.length > 1 && (
          <label>
            <span>En qué proyecto</span>
            <select value={proyecto} onChange={(e) => setProyecto(Number(e.target.value))}>
              {proyectos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.spaceName}
                </option>
              ))}
            </select>
          </label>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 1, minWidth: 0 }}>
            <span>Vence</span>
            <input type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
          </label>
          <label style={{ flex: 1, minWidth: 0 }}>
            <span>Prioridad</span>
            <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as Priority)}>
              <option value="low">Baja</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
            </select>
          </label>
        </div>

        <p className="muted" style={{ fontSize: 12.5 }}>
          {proyectos.length === 1
            ? `Se creará en ${proyectos[0].name} y quedará colgada de este objetivo.`
            : 'Quedará colgada de este objetivo, además de vivir en su proyecto.'}
        </p>

        <div className="modal-actions">
          <button type="button" className="btn ghost sm" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className="btn sm" disabled={!titulo.trim() || guardando}>
            Crear
          </button>
        </div>
      </form>
    </Modal>
  );
}
