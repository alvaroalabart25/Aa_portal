import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { projectsApi } from './api';
import { KebabMenu, Progress, StatusBadge } from './components';
import { AddProjectModal } from './modals';
import type { Project } from './types';

// Vista global: TODOS los proyectos, agrupados por espacio.
export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
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
          <button className="btn" onClick={() => setAdding(true)}>
            + Añadir proyecto
          </button>
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.spaceId} className="section">
          <h2>
            <Link to={`/espacios/${g.spaceId}`} className="space-group-link">
              <span className="dot" style={{ background: g.spaceColor, display: 'inline-block', width: 10, height: 10, marginRight: 9 }} />
              {g.spaceName}
              <span className="muted" style={{ fontWeight: 400, fontSize: 14, marginLeft: 8 }}>
                · {g.items.length}
              </span>
            </Link>
          </h2>

          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '14%' }}>Estado</th>
                <th>Nombre</th>
                <th style={{ width: '24%' }}>Progreso</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((p) => (
                <tr key={p.id} className="row" onClick={() => navigate(`/proyectos/${p.id}`)}>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td style={{ fontWeight: 500 }}>{p.name}</td>
                  <td>
                    <Progress done={p.doneTasks ?? 0} total={p.totalTasks ?? 0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {projects.length === 0 && <div className="empty">No hay proyectos todavía.</div>}

      {adding && <AddProjectModal onClose={() => setAdding(false)} onCreated={load} />}
    </div>
  );
}
