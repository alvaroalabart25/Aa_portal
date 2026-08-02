import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import { del, get, patch, post } from '../../lib/api';

type RoadmapCategory =
  | 'agenda'
  | 'suenos'
  | 'salud'
  | 'organizacion'
  | 'autonomo'
  | 'seguridad'
  | 'portal'
  | 'futuros';
type RoadmapStatus = 'pending' | 'in_progress' | 'done';

interface RoadmapItem {
  id: number;
  title: string;
  notes: string | null;
  category: RoadmapCategory;
  status: RoadmapStatus;
}

// Siguen el orden del menú del portal, y al final lo que no es un módulo
const CATEGORIES: Array<{ id: RoadmapCategory; label: string }> = [
  { id: 'agenda', label: 'Agenda' },
  { id: 'suenos', label: 'Sueños' },
  { id: 'salud', label: 'Salud' },
  { id: 'organizacion', label: 'Organización' },
  { id: 'autonomo', label: 'Finanzas' },
  { id: 'seguridad', label: 'Seguridad' },
  { id: 'portal', label: 'El portal' },
  { id: 'futuros', label: 'Futuros' },
];

const STATUS: Record<RoadmapStatus, { label: string; color: string }> = {
  pending: { label: 'Pendiente', color: '#8a8a8a' },
  in_progress: { label: 'En progreso', color: '#1971c2' },
  done: { label: 'Hecha', color: '#2f9e44' },
};

function StatusSelect({ value, onChange }: { value: RoadmapStatus; onChange: (s: RoadmapStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="status-select" ref={ref}>
      <button type="button" className="status-btn" style={{ color: STATUS[value].color }} onClick={() => setOpen(!open)}>
        <span className="dot" style={{ background: STATUS[value].color }} />
        {STATUS[value].label}
        <span className="chev-sm">▾</span>
      </button>
      {open && (
        <div className="status-menu">
          {(Object.keys(STATUS) as RoadmapStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`status-option${s === value ? ' current' : ''}`}
              style={{ color: STATUS[s].color }}
              onClick={() => {
                setOpen(false);
                if (s !== value) onChange(s);
              }}
            >
              <span className="dot" style={{ background: STATUS[s].color }} />
              {STATUS[s].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Descripción de la mejora, con autoguardado al dejar de escribir.
 * Aquí caben tanto un párrafo explicando qué implica como una lista de
 * submejoras: es texto libre a propósito, porque en esta fase todavía no se
 * sabe qué forma va a tener cada cosa.
 */
function Descripcion({ item, onGuardado }: { item: RoadmapItem; onGuardado: (notes: string) => void }) {
  const [txt, setTxt] = useState(item.notes ?? '');
  const [estado, setEstado] = useState<'' | 'guardando' | 'guardado'>('');
  const timer = useRef<number | undefined>(undefined);
  const ultimo = useRef(item.notes ?? '');

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function cambiar(v: string) {
    setTxt(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      if (v === ultimo.current) return;
      ultimo.current = v;
      setEstado('guardando');
      try {
        await patch(`/roadmap/${item.id}`, { notes: v });
        onGuardado(v);
        setEstado('guardado');
        window.setTimeout(() => setEstado(''), 1500);
      } catch {
        setEstado('');
      }
    }, 700);
  }

  return (
    <div className="rm-notes">
      <textarea
        value={txt}
        onChange={(e) => cambiar(e.target.value)}
        rows={5}
        autoFocus
        placeholder={'Qué implica esta mejora, o la lista de cosas que incluye.\n\n- una\n- otra'}
      />
      <div className="rm-notes-foot">
        <span className="muted">{estado === 'guardando' ? 'Guardando…' : estado === 'guardado' ? 'Guardado' : ''}</span>
      </div>
    </div>
  );
}

function ItemModal({
  item,
  onClose,
  onSaved,
}: {
  item: RoadmapItem | 'new';
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = item === 'new';
  const [title, setTitle] = useState(isNew ? '' : item.title);
  const [category, setCategory] = useState<RoadmapCategory>(isNew ? 'portal' : item.category);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (isNew) await post('/roadmap', { title: title.trim(), category });
      else await patch(`/roadmap/${item.id}`, { title: title.trim(), category });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (isNew) return;
    if (!confirm('¿Eliminar esta mejora del roadmap?')) return;
    await del(`/roadmap/${item.id}`);
    onSaved();
    onClose();
  }

  return (
    <Modal title={isNew ? 'Añadir mejora' : 'Editar mejora'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label htmlFor="rm-title">Mejora</label>
          <input id="rm-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="¿Qué quieres mejorar del portal?" />
        </div>
        <div className="field">
          <label htmlFor="rm-cat">Categoría</label>
          <select id="rm-cat" value={category} onChange={(e) => setCategory(e.target.value as RoadmapCategory)}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          <div>
            {!isNew && (
              <button type="button" className="btn danger sm" onClick={remove}>
                Eliminar
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn" disabled={saving || !title.trim()}>
              {isNew ? 'Añadir' : 'Guardar'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// Road Map: seguimiento estanco de las mejoras del portal, por categoría.
export default function RoadmapPage() {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [editing, setEditing] = useState<RoadmapItem | 'new' | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);

  const load = useCallback(async () => setItems(await get<RoadmapItem[]>('/roadmap')), []);
  useEffect(() => {
    load();
  }, [load]);

  const byCategory = useMemo(() => {
    const order: Record<RoadmapStatus, number> = { in_progress: 0, pending: 1, done: 2 };
    return CATEGORIES.map((c) => ({
      ...c,
      items: items.filter((i) => i.category === c.id).sort((a, b) => order[a.status] - order[b.status]),
    }));
  }, [items]);

  async function changeStatus(item: RoadmapItem, status: RoadmapStatus) {
    await patch(`/roadmap/${item.id}`, { status });
    load();
  }

  const doneCount = items.filter((i) => i.status === 'done').length;

  return (
    <div>
      <div className="page-head">
        <h1>Road Map</h1>
        <button className="btn" onClick={() => setEditing('new')}>
          + Añadir mejora
        </button>
      </div>
      {items.length > 0 && (
        <p className="muted" style={{ fontSize: 13.5, margin: '4px 0 0' }}>
          {doneCount} de {items.length} mejoras hechas · pulsa una para escribir qué implica
        </p>
      )}

      {byCategory
        .filter((c) => c.items.length > 0)
        .map((c) => (
          <section key={c.id} className="section">
            <h2>
              {c.label}
              <span className="muted" style={{ fontWeight: 400, fontSize: 14, marginLeft: 8 }}>
                · {c.items.filter((i) => i.status === 'done').length}/{c.items.length}
              </span>
            </h2>
            <div className="roadmap-list">
              {c.items.map((item) => {
                const abierto = abierta === item.id;
                return (
                  <div key={item.id}>
                    <div className="roadmap-row">
                      <span onClick={(e) => e.stopPropagation()}>
                        <StatusSelect value={item.status} onChange={(s) => changeStatus(item, s)} />
                      </span>
                      <button
                        className="roadmap-title"
                        style={item.status === 'done' ? { textDecoration: 'line-through', color: 'var(--ink-muted)' } : undefined}
                        onClick={() => setAbierta(abierto ? null : item.id)}
                        title="Pulsa para ver o escribir la descripción"
                      >
                        {item.title}
                        {item.notes && !abierto && <span className="rm-hasnotes" title="Tiene descripción" />}
                      </button>
                      <button className="btn ghost sm" onClick={() => setEditing(item)}>
                        Editar
                      </button>
                    </div>
                    {abierto && (
                      <Descripcion
                        item={item}
                        onGuardado={(notes) =>
                          setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, notes } : x)))
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      {items.length === 0 && <div className="empty">Añade la primera mejora del portal.</div>}

      {editing && <ItemModal item={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
