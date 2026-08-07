import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../../components/Modal';
import { projectsApi } from './api';
import { KebabMenu } from './components';
import { AddProjectModal, AddSpaceModal } from './modals';
import type { Project } from './types';

const ESTADO_PROYECTO: Record<string, string> = { completed: 'Completado', cancelled: 'Cancelado' };

/**
 * Proyecto en tarjeta, el mismo lenguaje que los objetivos del mes: un aro con
 * el avance y el nombre. El aro dice si el proyecto se mueve o está parado, que
 * es lo que se viene a mirar desde aquí.
 */
function TarjetaProyecto({ p, onAbrir }: { p: Project; onAbrir: () => void }) {
  const total = p.totalTasks ?? 0;
  const hechas = p.doneTasks ?? 0;
  const pct = total > 0 ? Math.round((hechas / total) * 100) : 0;

  return (
    <button className={`mk${p.status !== 'active' ? ' hecho' : ''}`} onClick={onAbrir}>
      <span className="mk-aro" style={{ ['--pct' as string]: `${pct}%` }} aria-hidden="true">
        <span className="mk-aro-n">{total > 0 ? `${pct}%` : '—'}</span>
      </span>
      <span className="mk-txt">
        <span className="mk-t">{p.name}</span>
        <span className="mk-sub">
          {ESTADO_PROYECTO[p.status] ? `${ESTADO_PROYECTO[p.status]} · ` : ''}
          {total > 0 ? `${hechas} de ${total} ${total === 1 ? 'tarea' : 'tareas'}` : 'sin tareas todavía'}
        </span>
      </span>
    </button>
  );
}

// Vista global: proyectos agrupados por espacio en acordeones (cerrados por
// defecto). El botón Añadir permite crear espacio o proyecto (en móvil no
// existe la sección Espacios).
export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [adding, setAdding] = useState<'space' | 'project' | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const navigate = useNavigate();

  const load = useCallback(
    async () => setProjects(await projectsApi.list({ status: showClosed ? 'all' : 'active' })),
    [showClosed],
  );
  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<number, { spaceId: number; spaceName: string; spaceColor: string; items: Project[] }>();
    for (const p of projects) {
      if (!map.has(p.spaceId)) {
        map.set(p.spaceId, {
          spaceId: p.spaceId,
          spaceName: p.spaceName ?? '',
          spaceColor: p.spaceColor ?? '#0a0a0a',
          items: [],
        });
      }
      map.get(p.spaceId)!.items.push(p);
    }
    return [...map.values()].sort((a, b) => a.spaceName.localeCompare(b.spaceName));
  }, [projects]);

  function toggle(spaceId: number) {
    setOpen((prev) => {
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

      {groups.map((g) => {
        const isOpen = open.has(g.spaceId);
        return (
          <section key={g.spaceId} className="section" style={{ marginTop: 26 }}>
            <button className="space-acc" onClick={() => toggle(g.spaceId)} aria-expanded={isOpen}>
              <span className="chev">{isOpen ? '▾' : '▸'}</span>
              <span className="dot" style={{ background: g.spaceColor, width: 10, height: 10 }} />
              {g.spaceName}
              <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>
                · {g.items.length}
              </span>
            </button>

            {isOpen && (
              <div className="mk-grid">
                {g.items.map((p) => (
                  <TarjetaProyecto key={p.id} p={p} onAbrir={() => navigate(`/proyectos/${p.id}`)} />
                ))}
              </div>
            )}
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
    </div>
  );
}
