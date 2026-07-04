import { useState } from 'react';
import { marked } from 'marked';
import {
  PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  TASK_STATUS_LABEL,
  type Priority,
  type ProjectStatus,
  type TaskStatus,
} from './types';

export function StatusBadge({ status }: { status: TaskStatus | ProjectStatus }) {
  const label =
    status in TASK_STATUS_LABEL
      ? TASK_STATUS_LABEL[status as TaskStatus]
      : PROJECT_STATUS_LABEL[status as ProjectStatus];
  const color: Record<string, string> = {
    backlog: '#8a8a8a',
    active: '#1971c2',
    in_progress: '#1971c2',
    blocked: '#e8590c',
    completed: '#2f9e44',
    cancelled: '#adb5bd',
  };
  return (
    <span className="badge">
      <span className="dot" style={{ background: color[status] }} />
      {label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const glyph = { high: '↑', medium: '·', low: '↓' }[priority];
  return (
    <span className="badge" title={`Prioridad ${PRIORITY_LABEL[priority].toLowerCase()}`}>
      {glyph} {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function SpaceTag({ name, color }: { name?: string; color?: string }) {
  if (!name) return null;
  return (
    <span className="badge">
      <span className="dot" style={{ background: color ?? '#0a0a0a' }} />
      {name}
    </span>
  );
}

export function DueDate({ date }: { date: string | null }) {
  if (!date) return <span className="muted">—</span>;
  const overdue = date < new Date().toISOString().slice(0, 10);
  const [y, m, d] = date.split('-');
  return <span className={overdue ? 'overdue' : ''}>{`${d}/${m}/${y.slice(2)}`}</span>;
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress">
      <div className="bar">
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <span>
        {pct}% · {done}/{total}
      </span>
    </div>
  );
}

// Notas en Markdown: render por defecto, clic en "Editar" para modificar.
export function NotesBox({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (notes: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="section notes-box">
      <div className="page-head">
        <h2>Notas</h2>
        {!editing && (
          <button className="btn ghost sm" onClick={() => { setDraft(value ?? ''); setEditing(true); }}>
            Editar
          </button>
        )}
      </div>
      {editing ? (
        <div>
          <textarea
            rows={10}
            style={{ width: '100%' }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Escribe en Markdown…"
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn sm" onClick={save} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button className="btn ghost sm" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : value ? (
        <div className="notes-render" dangerouslySetInnerHTML={{ __html: marked.parse(value) as string }} />
      ) : (
        <p className="muted" style={{ fontSize: 14 }}>
          Sin notas. Pulsa Editar para añadir (admite Markdown).
        </p>
      )}
    </div>
  );
}
