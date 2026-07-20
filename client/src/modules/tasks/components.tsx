import { useEffect, useRef, useState, type ReactNode } from 'react';
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

export const PRIORITY_COLOR: Record<Priority, string> = {
  high: '#c92a2a',
  medium: '#1971c2',
  low: '#2f9e44',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const glyph = { high: '↑', medium: '·', low: '↓' }[priority];
  return (
    <span
      className="badge"
      style={{ color: PRIORITY_COLOR[priority], fontWeight: 600 }}
      title={`Prioridad ${PRIORITY_LABEL[priority].toLowerCase()}`}
    >
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

// Vencimiento editable en línea: clic sobre la fecha -> selector de fecha.
export function DueDateEdit({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (date: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        className="date-inline"
        defaultValue={value ?? ''}
        onChange={async (e) => {
          const v = e.target.value || null;
          if (v !== value) await onChange(v);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
    );
  }

  return (
    <button type="button" className="date-btn" title="Clic para cambiar la fecha" onClick={() => setEditing(true)}>
      <DueDate date={value} />
    </button>
  );
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

function notesToHtml(value: string | null): string {
  if (!value) return '';
  if (/<[a-z][\s\S]*>/i.test(value)) return value; // ya es HTML (formato nuevo)
  // notas antiguas en Markdown; breaks: los saltos de línea simples cuentan
  return marked.parse(value, { breaks: true, async: false }) as string;
}

// Notas: editor enriquecido siempre activo (negrita/cursiva/subrayado/listas)
// con AUTOGUARDADO (debounce 1s + al salir del campo + al salir de la página).
export function NotesBox({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (notes: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  // contenido inicial una sola vez (no re-pintar mientras se escribe)
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = notesToHtml(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doSave() {
    if (!dirtyRef.current || !ref.current) return;
    dirtyRef.current = false;
    // si solo quedan <br> y etiquetas vacías, guardar vacío de verdad
    const html = ref.current.innerHTML;
    const textOnly = html.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim();
    const toSave = textOnly === '' ? '' : html;
    setStatus('saving');
    try {
      await onSave(toSave);
      if (toSave === '' && document.activeElement !== ref.current) ref.current.innerHTML = '';
      setStatus('saved');
    } catch {
      dirtyRef.current = true;
      setStatus('pending');
    }
  }

  function onInput() {
    dirtyRef.current = true;
    setStatus('pending');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(doSave, 1000);
  }

  // al desmontar (navegar a otra vista), volcar lo pendiente
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void doSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cmd(command: string) {
    document.execCommand(command);
    ref.current?.focus();
    onInput();
  }

  const statusLabel = { idle: '', pending: 'Sin guardar…', saving: 'Guardando…', saved: '✓ Guardado' }[status];

  return (
    <div className="section notes-box">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h2>Notas</h2>
        <span className="muted" style={{ fontSize: 12 }}>{statusLabel}</span>
      </div>
      <div className="notes-toolbar">
        <button type="button" title="Negrita (⌘B)" style={{ fontWeight: 700 }} onMouseDown={(e) => { e.preventDefault(); cmd('bold'); }}>
          B
        </button>
        <button type="button" title="Cursiva (⌘I)" style={{ fontStyle: 'italic' }} onMouseDown={(e) => { e.preventDefault(); cmd('italic'); }}>
          I
        </button>
        <button type="button" title="Subrayado (⌘U)" onMouseDown={(e) => { e.preventDefault(); cmd('underline'); }}>
          <u>U</u>
        </button>
        <button type="button" title="Lista" onMouseDown={(e) => { e.preventDefault(); cmd('insertUnorderedList'); }}>
          • Lista
        </button>
        <button type="button" title="Tachado" onMouseDown={(e) => { e.preventDefault(); cmd('strikeThrough'); }}>
          <s>S</s>
        </button>
      </div>
      <div
        ref={ref}
        className="notes-editor"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Escribe aquí… (guardado automático)"
        onInput={onInput}
        onBlur={doSave}
      />
    </div>
  );
}

// Título editable: clic sobre el texto para renombrar (Enter/blur guarda, Esc cancela).
export function EditableTitle({
  value,
  onSave,
  prefix,
}: {
  value: string;
  onSave: (name: string) => Promise<void>;
  prefix?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  async function finish() {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== value) await onSave(name);
    else setDraft(value);
  }

  if (editing) {
    return (
      <input
        className="title-input"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <h1 className="title-editable" title="Clic para renombrar" onClick={() => setEditing(true)}>
      {prefix}
      {value}
    </h1>
  );
}

// Menú de tres puntos (⋯) con opciones y conmutadores.
export interface KebabItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  checked?: boolean; // si se define, la opción es un conmutador con ✓
}

export function KebabMenu({ items }: { items: KebabItem[] }) {
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
        className="kebab-btn"
        aria-label="Más opciones"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      {open && (
        <div className="status-menu" style={{ left: 'auto', right: 0 }} role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`status-option${it.danger ? ' danger' : ''}`}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.checked !== undefined && (
                <span style={{ width: 14, textAlign: 'center' }}>{it.checked ? '✓' : ''}</span>
              )}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
