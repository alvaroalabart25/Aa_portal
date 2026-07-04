import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import {
  PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  TASK_STATUS_LABEL,
  type Priority,
  type ProjectStatus,
  type TaskStatus,
} from './types';

export const STATUS_COLOR: Record<string, string> = {
  backlog: '#8a8a8a',
  active: '#1971c2',
  in_progress: '#1971c2',
  blocked: '#e8590c',
  completed: '#2f9e44',
  cancelled: '#adb5bd',
};

export function StatusBadge({ status }: { status: TaskStatus | ProjectStatus }) {
  const label =
    status in TASK_STATUS_LABEL
      ? TASK_STATUS_LABEL[status as TaskStatus]
      : PROJECT_STATUS_LABEL[status as ProjectStatus];
  return (
    <span className="badge">
      <span className="dot" style={{ background: STATUS_COLOR[status] }} />
      {label}
    </span>
  );
}

// Desplegable de estado con el diseño de la web (sustituye al <select> nativo).
export function StatusSelect({
  value,
  onChange,
}: {
  value: TaskStatus;
  onChange: (status: TaskStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="status-select" ref={ref}>
      <button
        type="button"
        className="status-btn"
        style={{ color: STATUS_COLOR[value] }}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="dot" style={{ background: STATUS_COLOR[value] }} />
        {TASK_STATUS_LABEL[value]}
        <span className="chev-sm">▾</span>
      </button>
      {open && (
        <div className="status-menu" role="listbox">
          {(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={s === value}
              className={`status-option${s === value ? ' current' : ''}`}
              style={{ color: STATUS_COLOR[s] }}
              onClick={() => {
                setOpen(false);
                if (s !== value) onChange(s);
              }}
            >
              <span className="dot" style={{ background: STATUS_COLOR[s] }} />
              {TASK_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}
    </div>
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
