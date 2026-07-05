import { useEffect, useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import { projectsApi, spacesApi, tasksApi } from './api';
import { PRIORITY_LABEL, type Priority, type Project, type Space } from './types';

const PALETTE = ['#0a0a0a', '#1971c2', '#2f9e44', '#e8590c', '#9c36b5', '#c2255c', '#e8b70c'];

export function AddSpaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[1]);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await spacesApi.create({ name: name.trim(), color });
      onCreated();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Añadir espacio" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label htmlFor="m-space-name">Nombre</label>
          <input id="m-space-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="P. ej. CSO" />
        </div>
        <div className="field">
          <label>Color</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                style={{
                  width: 26, height: 26, borderRadius: '50%', background: c,
                  border: '3px solid var(--paper)',
                  outline: color === c ? '2px solid var(--ink)' : '1px solid var(--line)',
                }}
              />
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn" disabled={saving || !name.trim()}>Crear espacio</button>
        </div>
      </form>
    </Modal>
  );
}

export function AddProjectModal({
  onClose,
  onCreated,
  fixedSpaceId,
}: {
  onClose: () => void;
  onCreated: () => void;
  fixedSpaceId?: number;
}) {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceId, setSpaceId] = useState<number | ''>(fixedSpaceId ?? '');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!fixedSpaceId) spacesApi.list().then(setSpaces);
  }, [fixedSpaceId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !spaceId) return;
    setSaving(true);
    try {
      await projectsApi.create({ spaceId: Number(spaceId), name: name.trim() });
      onCreated();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Añadir proyecto" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!fixedSpaceId && (
          <div className="field">
            <label htmlFor="m-proj-space">Espacio</label>
            <select id="m-proj-space" value={spaceId} onChange={(e) => setSpaceId(Number(e.target.value))}>
              <option value="" disabled>Elige un espacio…</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="m-proj-name">Nombre</label>
          <input id="m-proj-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="P. ej. RESIDENCIA CONDES VAL | Desarrollo web" />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn" disabled={saving || !name.trim() || !spaceId}>Crear proyecto</button>
        </div>
      </form>
    </Modal>
  );
}

export function AddTaskModal({
  onClose,
  onCreated,
  fixedProjectId,
}: {
  onClose: () => void;
  onCreated: () => void;
  fixedProjectId?: number;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | ''>(fixedProjectId ?? '');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!fixedProjectId) projectsApi.list({ status: 'active' }).then(setProjects);
  }, [fixedProjectId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !projectId) return;
    setSaving(true);
    try {
      await tasksApi.create({
        projectId: Number(projectId),
        title: title.trim(),
        priority,
        dueDate: dueDate || null,
      });
      onCreated();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Añadir tarea" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!fixedProjectId && (
          <div className="field">
            <label htmlFor="m-task-project">Proyecto</label>
            <select id="m-task-project" value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
              <option value="" disabled>Elige un proyecto…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.spaceName} › {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="m-task-title">Nombre</label>
          <input id="m-task-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="¿Qué hay que hacer?" />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="m-task-priority">Prioridad</label>
            <select id="m-task-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {Object.entries(PRIORITY_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="m-task-due">Vencimiento</label>
            <input id="m-task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn" disabled={saving || !title.trim() || !projectId}>Crear tarea</button>
        </div>
      </form>
    </Modal>
  );
}
