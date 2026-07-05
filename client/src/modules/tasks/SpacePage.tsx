import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { projectsApi, spacesApi } from './api';
import { EditableTitle, KebabMenu, NotesBox, Progress, StatusBadge } from './components';
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

  async function removeSpace() {
    if (!confirm('¿Eliminar este espacio? Se archivará junto con sus proyectos y tareas (podrás recuperarlo, nada se borra de verdad).')) return;
    await spacesApi.archive(spaceId);
    navigate('/espacios');
  }

  if (!space) return <p className="muted">Cargando…</p>;

  return (
    <div>
      <div className="crumbs">
        <Link to="/espacios">Espacios</Link> ›{' '}
        <span style={{ color: 'var(--ink)' }}>{space.name}</span>
      </div>

      <div className="page-head">
        <EditableTitle
          value={space.name}
          prefix={
            <span className="dot" style={{ background: space.color, display: 'inline-block', width: 12, height: 12, marginRight: 10 }} />
          }
          onSave={async (name) => {
            await spacesApi.update(spaceId, { name });
            await load();
          }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <KebabMenu
            items={[
              {
                label: 'Ver completados',
                checked: showClosed,
                onClick: () => setShowClosed((v) => !v),
              },
              { label: 'Eliminar espacio', danger: true, onClick: removeSpace },
            ]}
          />
          <button className="btn" onClick={() => setAdding(true)}>
            + Añadir proyecto
          </button>
        </div>
      </div>

      <NotesBox
        value={space.notes}
        onSave={async (notes) => {
          await spacesApi.update(spaceId, { notes });
          await load();
        }}
      />

      <section className="section">
        <h2>Proyectos</h2>

        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '15%' }}>Estado</th>
              <th>Nombre</th>
              <th style={{ width: '24%' }}>Progreso</th>
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
                  <Progress done={p.doneTasks ?? 0} total={p.totalTasks ?? 0} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {projects.length === 0 && <div className="empty">Sin proyectos en este espacio.</div>}
      </section>

      {adding && <AddProjectModal fixedSpaceId={spaceId} onClose={() => setAdding(false)} onCreated={load} />}
    </div>
  );
}
