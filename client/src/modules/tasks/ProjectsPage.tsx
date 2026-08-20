import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../../components/Modal';
import { projectsApi, spacesApi } from './api';
import { KebabMenu } from './components';
import { AddProjectModal, AddSpaceModal } from './modals';
import type { Project, Space } from './types';

const ESTADO_PROYECTO: Record<string, string> = { completed: 'Completado', cancelled: 'Cancelado' };

/** Días enteros desde una fecha con hora de la base de datos. */
function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

// Dos semanas sin tocar un proyecto vivo ya no es una pausa, es un olvido
const DIAS_PARADO = 14;
// Con una o dos tareas, una tarjeta con aro de progreso es desproporcionada:
// ocupa lo mismo que un proyecto de veinte y dice mucho menos.
const PROYECTO_PEQUENO = 2;
const CLAVE_CERRADOS = 'aa_espacios_cerrados';

/** ¿Está terminado? Todas sus tareas hechas, o cerrado a mano. */
function terminado(p: Project): boolean {
  const total = p.totalTasks ?? 0;
  return p.status !== 'active' || (total > 0 && (p.doneTasks ?? 0) >= total);
}

/**
 * Cuánto pide tu atención este proyecto, de mayor a menor.
 *
 * El orden manual no servía: con 24 proyectos, lo que se mueve queda enterrado
 * entre lo que duerme. Manda lo que está vencido, luego lo que tienes entre
 * manos, y a igualdad de todo, lo tocado más recientemente. Lo terminado no
 * compite: va aparte.
 */
function atencion(p: Project): number {
  if (terminado(p)) return -1;
  const vencidas = p.overdueTasks ?? 0;
  const enMarcha = p.runningTasks ?? 0;
  const frescura = p.lastActivity ? Math.max(0, 120 - diasDesde(p.lastActivity)) : 0;
  return vencidas * 10000 + enMarcha * 1000 + frescura;
}

/** Cuándo se tocó por última vez, para desempatar: varios proyectos tocados
 *  «hoy» empatan en la cuenta de días, y ahí el alfabético es un sorteo. */
function tocado(p: Project): number {
  return p.lastActivity ? new Date(p.lastActivity).getTime() : 0;
}

/**
 * Proyecto en tarjeta, el mismo lenguaje que los objetivos del mes: un aro con
 * el avance, el nombre y las señales de si se mueve.
 *
 * Las señales son lo que esta pantalla no sabía decir: cuántas tareas llevas
 * vencidas, cuáles tienes entre manos y, sobre todo, qué llevas semanas sin
 * abrir. Un porcentaje solo no distingue un proyecto tranquilo de uno muerto.
 */
function TarjetaProyecto({ p, onAbrir }: { p: Project; onAbrir: () => void }) {
  const total = p.totalTasks ?? 0;
  const hechas = p.doneTasks ?? 0;
  const pct = total > 0 ? Math.round((hechas / total) * 100) : 0;
  const vencidas = p.overdueTasks ?? 0;
  const enMarcha = p.runningTasks ?? 0;
  const abiertas = total - hechas;
  const parado = p.lastActivity && abiertas > 0 ? diasDesde(p.lastActivity) : 0;

  return (
    <button className={`mk pr-card${p.status !== 'active' ? ' hecho' : ''}`} onClick={onAbrir}>
      <span className="mk-aro" style={{ ['--pct' as string]: `${pct}%` }} aria-hidden="true">
        <span className="mk-aro-n">{total > 0 ? `${pct}%` : '—'}</span>
      </span>
      <span className="mk-txt">
        <span className="mk-t">{p.name}</span>
        <span className="mk-sub">
          {ESTADO_PROYECTO[p.status] ? `${ESTADO_PROYECTO[p.status]} · ` : ''}
          {total > 0 ? `${hechas} de ${total} ${total === 1 ? 'tarea' : 'tareas'}` : 'sin tareas todavía'}
        </span>
        {(vencidas > 0 || enMarcha > 0 || parado >= DIAS_PARADO) && (
          <span className="pr-senales">
            {vencidas > 0 && (
              <span className="pr-senal vencidas">
                {vencidas} {vencidas === 1 ? 'vencida' : 'vencidas'}
              </span>
            )}
            {enMarcha > 0 && <span className="pr-senal marcha">{enMarcha} en marcha</span>}
            {parado >= DIAS_PARADO && <span className="pr-senal parado">sin tocar hace {parado} días</span>}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Proyecto en una línea, para los de una o dos tareas.
 *
 * La tarjeta con aro está pensada para un proyecto con recorrido; para «SEO &
 * Optimización: 0 de 1» era un marco enorme alrededor de nada. Aquí cabe lo
 * mismo en una fila y se leen diez de un vistazo.
 */
function FilaProyecto({ p, onAbrir }: { p: Project; onAbrir: () => void }) {
  const total = p.totalTasks ?? 0;
  const hechas = p.doneTasks ?? 0;
  const vencidas = p.overdueTasks ?? 0;
  const enMarcha = p.runningTasks ?? 0;
  const listo = total > 0 && hechas >= total;

  return (
    <button className={`pr-fila${listo ? ' hecho' : ''}`} onClick={onAbrir}>
      <span className="pr-fila-tic" aria-hidden="true">{listo ? '✓' : '·'}</span>
      <span className="pr-fila-n">{p.name}</span>
      <span className="pr-fila-s">
        {total > 0 ? `${hechas}/${total}` : 'sin tareas'}
      </span>
      {vencidas > 0 && <span className="pr-senal vencidas">{vencidas} vencida{vencidas === 1 ? '' : 's'}</span>}
      {enMarcha > 0 && <span className="pr-senal marcha">{enMarcha} en marcha</span>}
    </button>
  );
}

/**
 * Todos los proyectos que existen, en una lista densa y con buscador.
 *
 * Nace de una necesidad concreta suya: cuando lo terminado se recoge, hace
 * falta un sitio donde ver QUÉ hay creado sin rebuscar entre lo activo y lo
 * cerrado. Aquí está todo, incluido lo terminado, con su espacio al lado.
 */
function Indice({
  projects,
  spaces,
  onAbrir,
}: {
  projects: Project[];
  spaces: Space[];
  onAbrir: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const nombreEspacio = useMemo(() => new Map(spaces.map((e) => [e.id, e])), [spaces]);
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return projects
      .filter((p) => !t || p.name.toLowerCase().includes(t) || (nombreEspacio.get(p.spaceId)?.name ?? '').toLowerCase().includes(t))
      .sort((a, b) => {
        const ea = nombreEspacio.get(a.spaceId)?.name ?? '';
        const eb = nombreEspacio.get(b.spaceId)?.name ?? '';
        return ea.localeCompare(eb) || a.name.localeCompare(b.name);
      });
  }, [projects, q, nombreEspacio]);

  return (
    <section className="section">
      <input
        className="pr-buscar"
        placeholder={`Buscar entre ${projects.length} proyectos…`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="pr-indice">
        {filtrados.map((p) => {
          const esp = nombreEspacio.get(p.spaceId);
          const total = p.totalTasks ?? 0;
          const hechas = p.doneTasks ?? 0;
          return (
            <button key={p.id} className={`pr-idx${terminado(p) ? ' hecho' : ''}`} onClick={() => onAbrir(p.id)}>
              <span className="dot" style={{ background: esp?.color ?? '#0a0a0a' }} />
              <span className="pr-idx-e">{esp?.name ?? '—'}</span>
              <span className="pr-idx-n">{p.name}</span>
              <span className="pr-idx-s">
                {total > 0 ? `${hechas}/${total}` : '—'}
                {terminado(p) ? ' ✓' : ''}
              </span>
            </button>
          );
        })}
        {filtrados.length === 0 && <p className="muted mc-vacio">Nada con ese nombre.</p>}
      </div>
    </section>
  );
}

/**
 * Vista global: los espacios que más se usan primero, y dentro, los proyectos
 * que piden atención. Lo terminado se recoge solo y lo pequeño va en una línea.
 */
export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [indice, setIndice] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [adding, setAdding] = useState<'space' | 'project' | null>(null);
  const [enEspacio, setEnEspacio] = useState<number | null>(null);
  const [renombrando, setRenombrando] = useState<Space | null>(null);
  // null = todavía no se ha decidido nada; el valor por defecto se calcula
  // cuando llegan los espacios (ver más abajo).
  const [cerrados, setCerrados] = useState<Set<number> | null>(null);
  const [terminadosAbiertos, setTerminadosAbiertos] = useState<Set<number>>(new Set());
  const navigate = useNavigate();

  // Se piden TODOS, terminados incluidos: el índice los necesita y la vista
  // principal los recoge por su cuenta. Una llamada en vez de dos modos.
  const load = useCallback(async () => {
    const [p, e] = await Promise.all([projectsApi.list({ status: 'all' }), spacesApi.list()]);
    setProjects(p);
    setSpaces(e);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Espacios ordenados por uso: el que se ha tocado más recientemente arriba.
  // Dentro, los proyectos por lo que piden atención.
  const groups = useMemo(() => {
    return spaces
      .map((e) => {
        const items = projects
          .filter((p) => p.spaceId === e.id)
          .sort((a, b) => atencion(b) - atencion(a) || tocado(b) - tocado(a) || a.name.localeCompare(b.name));
        const vivos = items.filter((p) => !terminado(p));
        return {
          space: e,
          items,
          vivos,
          hechos: items.filter(terminado),
          // el pulso del espacio: lo mejor que tenga dentro
          pulso: items.length ? Math.max(...items.map(atencion)) : -2,
        };
      })
      .sort(
        (a, b) =>
          b.pulso - a.pulso ||
          Math.max(0, ...b.items.map(tocado)) - Math.max(0, ...a.items.map(tocado)) ||
          a.space.name.localeCompare(b.space.name),
      );
  }, [spaces, projects]);

  // Por defecto, TODO plegado menos el espacio más activo: abrir la pantalla y
  // encontrarse seis acordeones desplegados era el problema, no la solución. Lo
  // que él pliegue o abra a mano se recuerda.
  useEffect(() => {
    if (cerrados !== null || groups.length === 0) return;
    const guardado = localStorage.getItem(CLAVE_CERRADOS);
    if (guardado) {
      try {
        setCerrados(new Set(JSON.parse(guardado) as number[]));
        return;
      } catch {
        /* si está corrupto, se recalcula */
      }
    }
    setCerrados(new Set(groups.slice(1).map((g) => g.space.id)));
  }, [groups, cerrados]);

  function toggle(spaceId: number) {
    setCerrados((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(spaceId)) next.delete(spaceId);
      else next.add(spaceId);
      localStorage.setItem(CLAVE_CERRADOS, JSON.stringify([...next]));
      return next;
    });
  }

  const enMarchaTotal = projects.reduce((n, p) => n + (p.runningTasks ?? 0), 0);
  const hechosTotal = projects.filter(terminado).length;

  return (
    <div>
      <div className="page-head">
        <h1>Proyectos</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <KebabMenu
            items={[
              {
                label: indice ? 'Volver a los espacios' : 'Ver todos los proyectos',
                checked: indice,
                onClick: () => setIndice((v) => !v),
              },
            ]}
          />
          <button className="btn" onClick={() => setChoosing(true)}>
            + Añadir
          </button>
        </div>
      </div>

      <p className="page-sub">
        Tu trabajo por contextos: los espacios agrupan proyectos y cada proyecto lleva sus tareas y su avance.
      </p>

      {/* El titular: qué se mueve y cuánto hay guardado. El botón de la derecha
          es la puerta al listado completo, que es lo que hace que recoger lo
          terminado no signifique perderlo de vista. */}
      <div className="pr-resumen">
        <span>
          {projects.length} proyectos · <b>{enMarchaTotal}</b> {enMarchaTotal === 1 ? 'tarea en marcha' : 'tareas en marcha'} ·{' '}
          {hechosTotal} terminados
        </span>
        <button className="btn ghost sm" onClick={() => setIndice((v) => !v)}>
          {indice ? 'Ver por espacios' : 'Ver todos'}
        </button>
      </div>

      {indice ? (
        <Indice projects={projects} spaces={spaces} onAbrir={(id) => navigate(`/proyectos/${id}`)} />
      ) : (
        groups.map((g) => {
          const abierto = !(cerrados ?? new Set()).has(g.space.id);
          // el avance del espacio entero: la suma de lo suyo
          const total = g.items.reduce((n, p) => n + (p.totalTasks ?? 0), 0);
          const hechas = g.items.reduce((n, p) => n + (p.doneTasks ?? 0), 0);
          const vencidas = g.items.reduce((n, p) => n + (p.overdueTasks ?? 0), 0);
          const enMarcha = g.items.reduce((n, p) => n + (p.runningTasks ?? 0), 0);
          const pct = total > 0 ? Math.round((hechas / total) * 100) : 0;
          const grandes = g.vivos.filter((p) => (p.totalTasks ?? 0) > PROYECTO_PEQUENO);
          const pequenos = g.vivos.filter((p) => (p.totalTasks ?? 0) <= PROYECTO_PEQUENO);
          return (
            <section key={g.space.id} className="section pr-espacio">
              <div className="pr-espacio-head">
                <button className="space-acc" onClick={() => toggle(g.space.id)} aria-expanded={abierto}>
                  <span className="chev">{abierto ? '▾' : '▸'}</span>
                  <span className="dot" style={{ background: g.space.color, width: 10, height: 10 }} />
                  <span className="pr-espacio-t">{g.space.name}</span>
                  {/* en el móvil todo esto baja a su propia línea, debajo del nombre */}
                  <span className="pr-espacio-meta">
                    <span className="pr-espacio-n">
                      {g.vivos.length} {g.vivos.length === 1 ? 'activo' : 'activos'}
                      {g.hechos.length > 0 && ` · ${g.hechos.length} listo${g.hechos.length === 1 ? '' : 's'}`}
                      {total > 0 && ` · ${pct}%`}
                    </span>
                    {vencidas > 0 && (
                      <span className="pr-senal vencidas">
                        {vencidas} {vencidas === 1 ? 'vencida' : 'vencidas'}
                      </span>
                    )}
                    {enMarcha > 0 && <span className="pr-senal marcha">{enMarcha} en marcha</span>}
                    {/* la barra dice de un vistazo cómo va el espacio entero */}
                    <span className="pr-barra" aria-hidden="true">
                      <span style={{ width: `${pct}%`, background: g.space.color }} />
                    </span>
                  </span>
                </button>

                {/* Lo que antes vivía en la ficha del espacio: renombrarlo, meterle
                    un proyecto y eliminarlo. Aquí mismo, sin salir de la lista. */}
                <KebabMenu
                  items={[
                    { label: 'Nuevo proyecto aquí', onClick: () => setEnEspacio(g.space.id) },
                    { label: 'Renombrar espacio', onClick: () => setRenombrando(g.space) },
                    {
                      label: 'Eliminar espacio',
                      danger: true,
                      onClick: async () => {
                        if (
                          !confirm(
                            `¿Eliminar «${g.space.name}»? Se archiva con sus ${g.items.length} proyectos y sus tareas. Nada se borra de verdad.`,
                          )
                        )
                          return;
                        await spacesApi.archive(g.space.id);
                        load();
                      },
                    },
                  ]}
                />
              </div>

              {abierto && (
                <>
                  {g.items.length === 0 && <p className="muted mc-vacio">Sin proyectos en este espacio.</p>}

                  {grandes.length > 0 && (
                    <div className="mk-grid">
                      {grandes.map((p) => (
                        <TarjetaProyecto key={p.id} p={p} onAbrir={() => navigate(`/proyectos/${p.id}`)} />
                      ))}
                    </div>
                  )}

                  {pequenos.length > 0 && (
                    <div className="pr-filas">
                      {pequenos.map((p) => (
                        <FilaProyecto key={p.id} p={p} onAbrir={() => navigate(`/proyectos/${p.id}`)} />
                      ))}
                    </div>
                  )}

                  {/* Lo terminado no desaparece: se recoge. Un toque y está ahí. */}
                  {g.hechos.length > 0 && (
                    <>
                      <button
                        className="pr-hechos-t"
                        onClick={() =>
                          setTerminadosAbiertos((prev) => {
                            const next = new Set(prev);
                            if (next.has(g.space.id)) next.delete(g.space.id);
                            else next.add(g.space.id);
                            return next;
                          })
                        }
                      >
                        {terminadosAbiertos.has(g.space.id) ? '▾' : '▸'} Terminados ({g.hechos.length})
                      </button>
                      {terminadosAbiertos.has(g.space.id) && (
                        <div className="pr-filas">
                          {g.hechos.map((p) => (
                            <FilaProyecto key={p.id} p={p} onAbrir={() => navigate(`/proyectos/${p.id}`)} />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </section>
          );
        })
      )}

      {projects.length === 0 && <div className="empty">No hay proyectos todavía.</div>}

      {choosing && (
        <Modal title="¿Qué quieres crear?" onClose={() => setChoosing(false)}>
          <div style={{ display: 'grid', gap: 10 }}>
            <button
              className="btn"
              onClick={() => {
                setChoosing(false);
                setAdding('project');
              }}
            >
              + Nuevo proyecto
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setChoosing(false);
                setAdding('space');
              }}
            >
              + Nuevo espacio
            </button>
          </div>
        </Modal>
      )}
      {adding === 'project' && <AddProjectModal onClose={() => setAdding(null)} onCreated={load} />}
      {adding === 'space' && <AddSpaceModal onClose={() => setAdding(null)} onCreated={load} />}
      {enEspacio != null && (
        <AddProjectModal fixedSpaceId={enEspacio} onClose={() => setEnEspacio(null)} onCreated={load} />
      )}
      {renombrando && (
        <RenombrarEspacio
          space={renombrando}
          onClose={() => setRenombrando(null)}
          onGuardado={() => {
            setRenombrando(null);
            load();
          }}
        />
      )}
    </div>
  );
}


/** Renombrar un espacio sin salir de la lista. */
function RenombrarEspacio({
  space,
  onClose,
  onGuardado,
}: {
  space: Space;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [name, setName] = useState(space.name);
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="Renombrar espacio" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          try {
            await spacesApi.update(space.id, { name: name.trim() });
            onGuardado();
          } finally {
            setBusy(false);
          }
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div className="field">
          <label htmlFor="sp-n">Nombre</label>
          <input id="sp-n" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={busy || !name.trim()}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
