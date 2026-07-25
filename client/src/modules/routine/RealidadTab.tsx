import { useCallback, useEffect, useState } from 'react';
import Modal from '../../components/Modal';
import { get } from '../../lib/api';
import { routineApi, type TodayItem } from './api';

interface WeekDayItem {
  slotId: number;
  time: string;
  title: string;
  emoji: string;
  checked: boolean;
}
interface WeekDay {
  date: string;
  items: WeekDayItem[];
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mondayOf(d: Date): Date {
  const m = new Date(d);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

// Popup "¿Qué has completado?": los eventos de hoy con su sí/no.
// Solo hoy — la realidad no se rellena hacia atrás.
function CompletadoModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<TodayItem[]>([]);

  const load = useCallback(async () => {
    const r = await routineApi.today();
    setItems(r.items);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function toggle(item: TodayItem) {
    await routineApi.check(item.slotId, !item.checked);
    await load();
    onChanged();
  }

  return (
    <Modal title="¿Qué has completado hoy?" onClose={onClose}>
      {items.length === 0 && <p className="muted" style={{ fontSize: 13.5 }}>Hoy no hay nada planificado.</p>}
      <div className="rt-checklist">
        {items.map((i) => (
          <label key={i.slotId} className={`rt-check${i.checked ? ' done' : ''}`}>
            <input type="checkbox" checked={i.checked} onChange={() => toggle(i)} />
            <span className="rt-check-emoji">{i.emoji}</span>
            <span className="rt-check-title">{i.title}</span>
            <span className="muted" style={{ fontSize: 12 }}>{i.time}</span>
          </label>
        ))}
      </div>
      <div className="modal-actions" style={{ marginTop: 14 }}>
        <button className="btn" onClick={onClose}>
          Listo
        </button>
      </div>
    </Modal>
  );
}

// Tab Realidad: la semana tal y como está ocurriendo. Cada evento del plan
// aparece como hecho (✓), fallado (✗ en días pasados) o pendiente.
export default function RealidadTab() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [days, setDays] = useState<WeekDay[]>([]);
  const [asking, setAsking] = useState(false);
  const today = isoLocal(new Date());

  const load = useCallback(async () => {
    setDays(await get<WeekDay[]>(`/routine/week?from=${isoLocal(weekStart)}`));
  }, [weekStart]);
  useEffect(() => {
    load();
  }, [load]);

  function moveWeek(delta: number) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d);
  }

  const weekLabel = `${weekStart.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} — ${new Date(
    weekStart.getTime() + 6 * 86400000,
  ).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`;

  const done = days.flatMap((d) => d.items).filter((i) => i.checked).length;
  const past = days
    .filter((d) => d.date <= today)
    .flatMap((d) => d.items).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, flexWrap: 'wrap', gap: 10 }}>
        <div className="seg">
          <button onClick={() => moveWeek(-1)} title="Semana anterior">
            ‹
          </button>
          <button onClick={() => setWeekStart(mondayOf(new Date()))}>{weekLabel}</button>
          <button onClick={() => moveWeek(1)} title="Semana siguiente">
            ›
          </button>
        </div>
        <button className="btn" onClick={() => setAsking(true)}>
          ✓ ¿Qué has completado?
        </button>
      </div>

      {past > 0 && (
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          Esta semana: <strong>{done}</strong> de {past} eventos completados hasta hoy.
        </p>
      )}

      <div className="rt-real">
        {days.map((d) => {
          const isToday = d.date === today;
          const isPast = d.date < today;
          return (
            <div key={d.date} className={`rt-real-day${isToday ? ' today' : ''}`}>
              <div className="rt-real-head">
                {new Date(`${d.date}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })}
              </div>
              {d.items.length === 0 && <span className="muted" style={{ fontSize: 11.5 }}>—</span>}
              {d.items.map((i) => {
                const status = i.checked ? 'done' : isPast ? 'missed' : isToday ? 'pending' : 'future';
                return (
                  <div key={i.slotId} className={`rt-real-item ${status}`} title={`${i.title} · ${i.time}`}>
                    <span className="rt-real-mark">{i.checked ? '✓' : isPast ? '✗' : '·'}</span>
                    <span className="rt-real-title">
                      {i.emoji} {i.title}
                    </span>
                    <span className="rt-real-time">{i.time}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        Lo que de verdad está pasando: ✓ hecho, ✗ no se hizo, · pendiente de hoy. Los días futuros se muestran en gris
        como plan. Los checks solo se marcan el día en curso.
      </p>

      {asking && <CompletadoModal onClose={() => setAsking(false)} onChanged={load} />}
    </div>
  );
}
