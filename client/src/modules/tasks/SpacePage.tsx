import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { projectsApi, spacesApi } from './api';
import { DueDate, NotesBox, Progress, StatusBadge } from './components';
import { AddProjectModal } from './modals';
import type { Project, Space } from './types';

export default function SpacePage() {
  const { id } = useParams();
  const spaceId = Number(id);
  const navigate = useNavigate();

  const [space, setSpace] = useState<Space | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      spacesApi.one(spaceId),
      projectsApi.list({ spaceId, status: showClosed ? 'all' : 'active' }),
    ]);
    setSpace(s);
    setProjects(p);
  }, [spaceId, showClosed]);

  useEffect(() => {
    load();
  }, [load]);

  if (!space) return <p className="muted">Cargando…</p>;

  return (
    <div>
      <div className="crumbs">
        <Link to="/espacios">Espacios</Link> ›{' '}
        <span style={{ color: 'var(--ink)' }}>{space.name}</span>
      </div>
      <div className="page-head">
        <h1>
          <span className="dot" style={{ background: space.color, display: 'inline-block', width: 12, height: 12, marginRight: 10 }} />
          {space.name}
        </h1>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
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
                <Progress done={p.doneTasks ?? 0} total={p.totalTasks ?? 0} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {projects.length === 0 && <div className="empty">Sin proyectos en este espacio.</div>}

      {adding && <AddProjectModal fixedSpaceId={spaceId} onClose={() => setAdding(false)} onCreated={load} />}

      <NotesBox
        value={space.notes}
        onSave={async (notes) => {
          await spacesApi.update(spaceId, { notes });
          await load();
        }}
      />
    </div>
  );
}
