import { useEffect, useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import { eventsApi } from './api';
import { spacesApi } from '../tasks/api';
import type { Space } from '../tasks/types';
import { RECURRENCE_LABEL, type EventRecurrence, type ImportantEvent } from './types';

export default function EventoModal({
  event,
  onClose,
  onSaved,
}: {
  event: ImportantEvent | null; // null = crear
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(event?.title ?? '');
  const [eventDate, setEventDate] = useState(event?.eventDate ?? '');
  const [recurrence, setRecurrence] = useState<EventRecurrence>(event?.recurrence ?? 'none');
  const [place, setPlace] = useState<string>(event ? (event.scope === 'autonomo' ? 'autonomo' : String(event.spaceId)) : 'autonomo');
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    spacesApi.list().then(setSpaces);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !eventDate) return;
    setSaving(true);
    setError('');
    const data = {
      title: title.trim(),
      eventDate,
      recurrence,
      scope: place === 'autonomo' ? 'autonomo' : 'space',
      spaceId: place === 'autonomo' ? null : Number(place),
    };
    try {
      if (event) await eventsApi.update(event.id, data);
      else await eventsApi.create(data);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!event) return;
    if (!confirm('¿Eliminar este evento importante?')) return;
    await eventsApi.remove(event.id);
    onSaved();
    onClose();
  }

  return (
    <Modal title={event ? 'Editar evento' : 'Añadir evento importante'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label htmlFor="ev-title">Título</label>
          <input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="P. ej. Dar de alta formación Delmar" />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="ev-date">Fecha</label>
            <input id="ev-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ev-rec">Repetición</label>
            <select id="ev-rec" value={recurrence} onChange={(e) => setRecurrence(e.target.value as EventRecurrence)}>
              {Object.entries(RECURRENCE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="ev-place">Vinculado a</label>
          <select id="ev-place" value={place} onChange={(e) => setPlace(e.target.value)}>
            <option value="autonomo">Autónomo</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          <div>
            {event && (
              <button type="button" className="btn danger sm" onClick={remove}>
                Eliminar
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn" disabled={saving || !title.trim() || !eventDate}>
              {event ? 'Guardar' : 'Crear evento'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
