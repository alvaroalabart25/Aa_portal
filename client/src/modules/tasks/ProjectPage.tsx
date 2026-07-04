import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { projectsApi, tasksApi } from './api';
import { NotesBox, Progress, StatusBadge } from './components';
import { AddTaskModal } from './modals';
import TaskTable from './TaskTable';
import type { Project, Task } from './types';

export default function ProjectPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([
      projectsApi.one(projectId),
      tasksApi.list({ projectId, status: showCompleted ? 'all' : 'open' }),
    ]);
    setProject(p);
    setTasks(t);
  }, [projectId, showCompleted]);

  useEffect(() => {
    load();
  }, [load]);

  async function completeProject() {
    if (!confirm('¿Completar el proyecto? Sus tareas abiertas se completarán también.')) return;
    await projectsApi.update(projectId, { status: 'completed' });
    await load();
  }

  async function removeProject() {
    if (!confirm('¿Eliminar este proyecto? Se archivará junto con sus tareas (podrás recuperarlo, nada se borra de verdad).')) return;
    await projectsApi.archive(projectId);
    navigate(`/espacios/${project?.spaceId}`);
  }

  if (!project) return <p className="muted">Cargando…</p>;

  return (
    <div>
      <div className="crumbs">
        <Link to="/espacios">Espacios</Link> ›{' '}
        <Link to={`/espacios/${project.spaceId}`}>{project.spaceName}</Link> ›{' '}
        <span style={{ color: 'var(--ink)' }}>{project.name}</span>
      </div>

      <div className="page-head">
        <h1>{project.name}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn danger sm" onClick={removeProject}>
            Eliminar proyecto
          </button>
          {project.status === 'active' && (
            <button className="btn ghost sm" onClick={completeProject}>
              ✓ Completar proyecto
            </button>
          )}
          <button className="btn sm" onClick={() => setAdding(true)}>
            + Añadir tarea
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <StatusBadge status={project.status} />
        <Progress done={project.doneTasks ?? 0} total={project.totalTasks ?? 0} />
      </div>

      <NotesBox
        value={project.notes ?? null}
        onSave={async (notes) => {
          await projectsApi.update(projectId, { notes });
          await load();
        }}
      />

      <section className="section">
        <div className="page-head">
          <h2>Tareas</h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
            />
            Ver completadas
          </label>
        </div>

        <TaskTable tasks={tasks} showProject={false} onChanged={load} />
      </section>

      {adding && <AddTaskModal fixedProjectId={projectId} onClose={() => setAdding(false)} onCreated={load} />}
    </div>
  );
}
