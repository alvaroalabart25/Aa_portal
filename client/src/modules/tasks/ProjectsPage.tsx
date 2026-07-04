import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { projectsApi } from './api';
import { DueDate, Progress, SpaceTag, StatusBadge } from './components';
import { AddProjectModal } from './modals';
import type { Project } from './types';

// Vista global: TODOS los proyectos de todos los espacios.
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

  return (
    <div>
      <div className="page-head">
        <h1>Proyectos</h1>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Ver completados
        </label>
      </div>
      <button className="btn sm" onClick={() => setAdding(true)}>
        + Añadir proyecto
      </button>

      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 130 }}>Estado</th>
            <th>Nombre</th>
            <th style={{ width: 110 }}>Vencimiento</th>
            <th style={{ width: 150 }}>Espacio</th>
            <th style={{ width: 170 }}>Progreso</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="row" onClick={() => navigate(`/proyectos/${p.id}`)}>
              <td>
                <StatusBadge status={p.status} />
              </td>
              <td style={{ fontWeight: 500 }}>{p.name}</td>
              <td>
                <DueDate date={p.dueDate} />
              </td>
              <td>
                <SpaceTag name={p.spaceName} color={p.spaceColor} />
              </td>
              <td>
                <Progress done={p.doneTasks ?? 0} total={p.totalTasks ?? 0} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {projects.length === 0 && <div className="empty">No hay proyectos todavía.</div>}

      {adding && <AddProjectModal onClose={() => setAdding(false)} onCreated={load} />}
    </div>
  );
}
