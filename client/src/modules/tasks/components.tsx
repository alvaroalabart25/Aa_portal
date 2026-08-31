import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  avisaAplazada,
  AVISO_APLAZADA_EN_MARCHA,
  DIAS_SEMANA,
  listaDias,
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
  in_review: '#7048e8',
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

// Desplegable de prioridad en línea (mismo patrón que el de estado).
export function PrioritySelect({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (priority: Priority) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const glyph: Record<Priority, string> = { high: '↑', medium: '·', low: '↓' };

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
        style={{ color: PRIORITY_COLOR[value], fontWeight: 600 }}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {glyph[value]} {PRIORITY_LABEL[value]}
        <span className="chev-sm">▾</span>
      </button>
      {open && (
        <div className="status-menu" role="listbox">
          {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
            <button
              key={p}
              type="button"
              role="option"
              aria-selected={p === value}
              className={`status-option${p === value ? ' current' : ''}`}
              style={{ color: PRIORITY_COLOR[p] }}
              onClick={() => {
                setOpen(false);
                if (p !== value) onChange(p);
              }}
            >
              {glyph[p]} {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
      )}
    </div>
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

/**
 * Cuántas veces se ha aplazado una tarea.
 *
 * A partir de dos: mover algo una vez es normal, repetirlo es la señal de que
 * se te está haciendo bola. De cuatro en adelante se marca, para que salte a la
 * vista sin tener que leer el número.
 */
export function Aplazada({ veces, estado }: { veces?: number; estado: TaskStatus }) {
  // Ver `avisaAplazada`: en backlog cuenta desde la primera vez; en marcha hace
  // falta que sea exagerado, porque mover una tarea larga es lo normal.
  if (!avisaAplazada(estado, veces)) return null;
  const n = veces ?? 0;
  return (
    <span
      className={`aplazada${n >= AVISO_APLAZADA_EN_MARCHA ? ' bola' : ''}`}
      title={`Aplazada ${n} ${n === 1 ? 'vez' : 'veces'}`}
      aria-label={`Aplazada ${n} ${n === 1 ? 'vez' : 'veces'}`}
    >
      ↻{n}
    </span>
  );
}

/**
 * Los días en los que una tarea vuelve.
 *
 * Siete botones y nada más: elegir días es una pregunta de siete respuestas y
 * cualquier desplegable la haría más larga de contestar que de pensar. Sin
 * ninguno marcado, la tarea no se repite —el estado apagado ES una opción, no
 * un error—, así que no hace falta un interruptor aparte para quitarla.
 */
export function DiasDeRepeticion({
  value,
  onChange,
  compacto = false,
}: {
  value?: string;
  onChange: (dias: string) => void | Promise<void>;
  compacto?: boolean;
}) {
  const puestos = listaDias(value);

  function alternar(dia: number) {
    const siguiente = puestos.includes(dia) ? puestos.filter((d) => d !== dia) : [...puestos, dia];
    onChange(siguiente.sort((a, b) => a - b).join(','));
  }

  return (
    <div className={`rep-dias${compacto ? ' compacto' : ''}`} role="group" aria-label="Días en los que se repite">
      {DIAS_SEMANA.map(([n, corta, larga]) => (
        <button
          key={n}
          type="button"
          className={puestos.includes(n) ? 'on' : ''}
          aria-pressed={puestos.includes(n)}
          aria-label={larga}
          title={larga}
          onClick={() => alternar(n)}
        >
          {corta}
        </button>
      ))}
      {puestos.length > 0 && (
        <button type="button" className="rep-quitar" onClick={() => onChange('')} title="Que no se repita">
          ✕
        </button>
      )}
    </div>
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

// Etiquetas permitidas en las notas: solo formato, nada ejecutable. Todo lo
// que entra y sale del editor pasa por aquí, así un texto con <script> o con
// un onerror= (por ejemplo, si algún día importamos datos de terceros) se
// queda en texto inofensivo en lugar de ejecutarse con tu sesión delante.
const NOTES_HTML = {
  ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 's', 'br', 'p', 'div', 'span', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'h1', 'h2', 'h3'],
  // `data-chk` marca una lista como de tareas y `data-ok` una tarea hecha. Son
  // atributos de datos: no ejecutan nada y no traen estilos de fuera, que es
  // por lo que la casilla NO es un <input> de verdad —habría que dejar entrar
  // etiquetas de formulario en un texto que se guarda tal cual—.
  ALLOWED_ATTR: ['href', 'target', 'rel', 'data-chk', 'data-ok'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
};

export function sanitizeNotes(html: string): string {
  return DOMPurify.sanitize(html, NOTES_HTML);
}

function notesToHtml(value: string | null): string {
  if (!value) return '';
  if (/<[a-z][\s\S]*>/i.test(value)) return sanitizeNotes(value); // ya es HTML (formato nuevo)
  // notas antiguas en Markdown; breaks: los saltos de línea simples cuentan
  return sanitizeNotes(marked.parse(value, { breaks: true, async: false }) as string);
}

/**
 * El editor enriquecido del portal: negrita, cursiva, subrayado, tachado y
 * listas, sin salir del sitio y guardando solo.
 *
 * Es la pieza que comparten las notas de una tarea y el bloc de notas. Guarda
 * HTML saneado; si lo que llega es texto plano de antes, se convierte al vuelo.
 *
 * `barra: 'alEnfocar'` esconde los botones hasta que se escribe en él: en una
 * lista de varios editores —el bloc, un día por caja— cinco barras de
 * herramientas a la vez son más ruido que ayuda.
 */
export function EditorRico({
  value,
  onSave,
  placeholder = 'Escribe aquí… (guardado automático)',
  barra = 'siempre',
  onEstado,
}: {
  value: string | null;
  onSave: (notes: string) => Promise<void>;
  placeholder?: string;
  barra?: 'siempre' | 'alEnfocar';
  onEstado?: (etiqueta: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  const [enfocado, setEnfocado] = useState(false);
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
    const toSave = textOnly === '' ? '' : sanitizeNotes(html);
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

  const etiqueta = { idle: '', pending: 'Sin guardar…', saving: 'Guardando…', saved: '✓ Guardado' }[status];
  useEffect(() => onEstado?.(etiqueta), [etiqueta, onEstado]);

  function cmd(command: string) {
    document.execCommand(command);
    ref.current?.focus();
    onInput();
  }

  /** La lista donde está el cursor, si la hay. */
  function listaActual(): HTMLUListElement | null {
    const nodo = window.getSelection()?.anchorNode ?? null;
    const el = nodo instanceof Element ? nodo : nodo?.parentElement;
    if (!el || !ref.current?.contains(el)) return null;
    return el.closest('ul');
  }

  /**
   * Lista de tareas: la misma lista de siempre, marcada como `data-chk`.
   *
   * No hay `<input type=checkbox>` de verdad a propósito: obligaría a dejar
   * entrar etiquetas de formulario en un texto que se guarda tal cual, y el
   * estado de un input marcado a mano no viaja en el HTML. La casilla la pinta
   * el CSS y lo marcado se apunta en el propio `li`, que sí se guarda.
   */
  function checklist() {
    const ya = listaActual();
    if (ya) {
      // ya estás en una lista: solo cambia de tipo, sin deshacerla
      if (ya.hasAttribute('data-chk')) ya.removeAttribute('data-chk');
      else ya.setAttribute('data-chk', '1');
    } else {
      document.execCommand('insertUnorderedList');
      listaActual()?.setAttribute('data-chk', '1');
    }
    ref.current?.focus();
    onInput();
  }

  /**
   * Marcar y desmarcar: se pulsa LA CASILLA, no el renglón. Si bastara con
   * tocar cualquier sitio del texto no se podría poner el cursor para escribir.
   */
  function alPulsar(e: ReactMouseEvent<HTMLDivElement>) {
    const li = (e.target as HTMLElement)?.closest?.('li');
    if (!li || !li.parentElement?.hasAttribute('data-chk')) return;
    const x = e.clientX - li.getBoundingClientRect().left;
    if (x > 24) return;
    if (li.hasAttribute('data-ok')) li.removeAttribute('data-ok');
    else li.setAttribute('data-ok', '1');
    onInput();
  }

  const verBarra = barra === 'siempre' || enfocado;

  return (
    <>
      {verBarra && (
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
          <button type="button" title="Lista de tareas" onMouseDown={(e) => { e.preventDefault(); checklist(); }}>
            ☑ Tareas
          </button>
          <button type="button" title="Tachado" onMouseDown={(e) => { e.preventDefault(); cmd('strikeThrough'); }}>
            <s>S</s>
          </button>
          {barra === 'alEnfocar' && etiqueta && <span className="notes-estado">{etiqueta}</span>}
        </div>
      )}
      <div
        ref={ref}
        className="notes-editor"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={onInput}
        onClick={alPulsar}
        onFocus={() => setEnfocado(true)}
        onBlur={(e) => {
          // los botones de la barra no roban el foco (hacen preventDefault),
          // así que si el foco se va de verdad, es que se ha ido del editor
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) setEnfocado(false);
          void doSave();
        }}
      />
    </>
  );
}

// Notas de una tarea: el editor de arriba con su cabecera y su estado.
export function NotesBox({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (notes: string) => Promise<void>;
}) {
  const [etiqueta, setEtiqueta] = useState('');
  return (
    <div className="section notes-box">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h2>Notas</h2>
        <span className="muted" style={{ fontSize: 12 }}>{etiqueta}</span>
      </div>
      <EditorRico value={value} onSave={onSave} onEstado={setEtiqueta} />
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
