import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import { routineApi, type RoutineItem } from './api';

function ItemModal({
  item,
  onClose,
  onSaved,
}: {
  item: RoutineItem | 'new';
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = item === 'new';
  const [title, setTitle] = useState(isNew ? '' : item.title);
  const [emoji, setEmoji] = useState(isNew ? '🔁' : item.emoji);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const data = { title: title.trim(), emoji: emoji.trim() || '🔁' };
      if (isNew) await routineApi.createItem(data);
      else await routineApi.updateItem(item.id, data);
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (isNew) return;
    if (!confirm('¿Eliminar este evento de la rutina? Se quitará de la plantilla semanal, pero tu historial pasado se conserva.')) return;
    await routineApi.removeItem(item.id);
    onSaved();
    onClose();
  }

  return (
    <Modal title={isNew ? 'Añadir evento de rutina' : 'Editar evento'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="ri-emoji">Emoji</label>
            <input
              id="ri-emoji"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              maxLength={8}
              style={{ width: 64, textAlign: 'center', fontSize: 18 }}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="ri-title">Nombre</label>
            <input id="ri-title" style={{ width: '100%' }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="P. ej. Gimnasio" />
          </div>
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

// Catálogo de eventos de rutina: Levantarme, Pasear, Gimnasio...
export default function RutinaEventosTab() {
  const [items, setItems] = useState<RoutineItem[]>([]);
  const [editing, setEditing] = useState<RoutineItem | 'new' | null>(null);

  const load = useCallback(async () => setItems(await routineApi.items()), []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button className="btn" onClick={() => setEditing('new')}>
          + Añadir evento
        </button>
      </div>

      <div className="roadmap-list">
        {items.map((i) => (
          <div key={i.id} className="roadmap-row">
            <span style={{ fontSize: 18 }}>{i.emoji}</span>
            <button className="roadmap-title" onClick={() => setEditing(i)} title="Clic para editar">
              {i.title}
            </button>
          </div>
        ))}
      </div>
      {items.length === 0 && <div className="empty">Crea tu primer evento: Levantarme, Pasear, Gimnasio…</div>}

      <p className="muted" style={{ fontSize: 12.5, marginTop: 16, lineHeight: 1.6 }}>
        ℹ️ Eliminar un evento lo quita del catálogo y de la plantilla semanal, pero <strong>no rompe tu historial</strong>:
        los días pasados conservan sus checks y su porcentaje en la cuadrícula de evolución.
      </p>

      {editing && <ItemModal item={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
