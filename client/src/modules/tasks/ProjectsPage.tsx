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

// Vista global: proyectos agrupados por espacio en acordeones (cerrados por
// defecto). El botón Añadir permite crear espacio o proyecto (en móvil no
// existe la sección Espacios).
export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [adding, setAdding] = useState<'space' | 'project' | null>(null);
  const [enEspacio, setEnEspacio] = useState<number | null>(null);
  const [renombrando, setRenombrando] = useState<Space | null>(null);
  // Abiertos de salida: llegar a una lista de espacios cerrados no cuenta nada.
  // El que quiera plegar uno, lo pliega.
  const [cerrados, setCerrados] = useState<Set<number>>(new Set());
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const [p, e] = await Promise.all([
      projectsApi.list({ status: showClosed ? 'all' : 'active' }),
      spacesApi.list(),
    ]);
    setProjects(p);
    setSpaces(e);
  }, [showClosed]);
  useEffect(() => {
    load();
  }, [load]);

  // Se parte de los ESPACIOS, no de los proyectos: si se armara con los
  // proyectos, un espacio recién creado no aparecería hasta tener el primero, y
  // parecería que no se ha guardado.
  const groups = useMemo(
    () =>
      spaces
        .map((e) => ({ space: e, items: projects.filter((p) => p.spaceId === e.id) }))
        .sort((a, b) => a.space.name.localeCompare(b.space.name)),
    [spaces, projects],
  );

  function toggle(spaceId: number) {
    setCerrados((prev) => {
      const next = new Set(prev);
      if (next.has(spaceId)) next.delete(spaceId);
      else next.add(spaceId);
      return next;
    });
  }

  return (
    <div>
      <div className="page-head">
        <h1>Proyectos</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <KebabMenu
            items={[
              {
                label: 'Ver completados',
                checked: showClosed,
                onClick: () => setShowClosed((v) => !v),
              },
            ]}
          />
          <button className="btn" onClick={() => setChoosing(true)}>
            + Añadir
          </button>
        </div>
      </div>

      <p className="page-sub">Tu trabajo por contextos: los espacios agrupan proyectos y cada proyecto lleva sus tareas y su avance.</p>

      {groups.map((g) => {
        const abierto = !cerrados.has(g.space.id);
        // el avance del espacio entero: la suma de lo suyo
        const total = g.items.reduce((n, p) => n + (p.totalTasks ?? 0), 0);
        const hechas = g.items.reduce((n, p) => n + (p.doneTasks ?? 0), 0);
        const vencidas = g.items.reduce((n, p) => n + (p.overdueTasks ?? 0), 0);
        const pct = total > 0 ? Math.round((hechas / total) * 100) : 0;
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
                    {g.items.length} {g.items.length === 1 ? 'proyecto' : 'proyectos'}
                    {total > 0 && ` · ${pct}%`}
                  </span>
                  {vencidas > 0 && (
                    <span className="pr-senal vencidas">
                      {vencidas} {vencidas === 1 ? 'vencida' : 'vencidas'}
                    </span>
                  )}
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

            {abierto &&
              (g.items.length === 0 ? (
                <p className="muted mc-vacio">Sin proyectos en este espacio.</p>
              ) : (
                <div className="mk-grid">
                  {g.items.map((p) => (
                    <TarjetaProyecto key={p.id} p={p} onAbrir={() => navigate(`/proyectos/${p.id}`)} />
                  ))}
                </div>
              ))}
          </section>
        );
      })}

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
