import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import { routineApi, type DayStat, type RoutineItem, type RoutineSlot, type TodayItem } from './api';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 06:00 - 23:00

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- Cuadrícula de evolución ----------
function Square({ stat, today }: { stat: DayStat; today: string }) {
  const future = stat.date > today;
  const ratio = stat.scheduled > 0 ? Math.min(stat.checked / stat.scheduled, 1) : 0;
  let style: React.CSSProperties = {};
  if (future) style = { background: 'transparent', borderStyle: 'dashed' };
  else if (stat.scheduled === 0) style = { background: 'var(--paper-soft)' };
  else if (ratio === 0) style = { background: 'var(--paper)' };
  else style = { background: `rgba(10, 10, 10, ${(0.12 + 0.88 * ratio).toFixed(2)})` };
  return (
    <span
      className={`rt-square${stat.date === today ? ' today' : ''}`}
      style={style}
      title={`${stat.date} · ${stat.checked}/${stat.scheduled}`}
    />
  );
}

function MonthGrid({ stats, today }: { stats: DayStat[]; today: string }) {
  if (stats.length === 0) return null;
  const firstWd = (new Date(`${stats[0].date}T12:00:00`).getDay() + 6) % 7;
  return (
    <div className="rt-monthgrid">
      {WEEKDAYS.map((d) => (
        <span key={d} className="rt-dow">
          {d[0]}
        </span>
      ))}
      {Array.from({ length: firstWd }, (_, i) => (
        <span key={`e${i}`} />
      ))}
      {stats.map((s) => (
        <Square key={s.date} stat={s} today={today} />
      ))}
    </div>
  );
}

function Evolution() {
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [stats, setStats] = useState<DayStat[]>([]);
  const today = isoLocal(new Date());
  const now = new Date();

  useEffect(() => {
    const y = now.getFullYear();
    const from = mode === 'month' ? isoLocal(new Date(y, now.getMonth(), 1)) : `${y}-01-01`;
    const to = mode === 'month' ? isoLocal(new Date(y, now.getMonth() + 1, 0)) : `${y}-12-31`;
    routineApi.stats(from, to).then(setStats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const byMonth = useMemo(() => {
    const map = new Map<string, DayStat[]>();
    for (const s of stats) {
      const k = s.date.slice(0, 7);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return [...map.entries()];
  }, [stats]);

  const monthLabel = now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  return (
    <section className="section" style={{ marginTop: 20 }}>
      <div className="page-head">
        <h2>
          Evolución
          <span className="muted" style={{ fontWeight: 400, fontSize: 14, marginLeft: 8 }}>
            · {mode === 'month' ? monthLabel : now.getFullYear()}
          </span>
        </h2>
        <div className="seg">
          <button className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>
            Mes
          </button>
          <button className={mode === 'year' ? 'active' : ''} onClick={() => setMode('year')}>
            Año
          </button>
        </div>
      </div>

      {mode === 'month' ? (
        <MonthGrid stats={stats} today={today} />
      ) : (
        <div className="rt-year">
          {byMonth.map(([month, list]) => (
            <div key={month} className="rt-year-month">
              <span className="rt-year-label">
                {new Date(`${month}-01T12:00:00`).toLocaleDateString('es-ES', { month: 'short' })}
              </span>
              <MonthGrid stats={list} today={today} />
            </div>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        Cada cuadrado es un día: negro sólido = rutina completa; más claro = parcial. Los checks solo se marcan el día
        en curso — no se puede completar hacia atrás.
      </p>
    </section>
  );
}

// ---------- Checklist de hoy ----------
function TodayChecklist({ onChanged }: { onChanged: () => void }) {
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

  const done = items.filter((i) => i.checked).length;
  const dayLabel = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <section className="section">
      <div className="page-head">
        <h2>
          Hoy
          <span className="muted" style={{ fontWeight: 400, fontSize: 14, marginLeft: 8 }}>
            · {dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)}
          </span>
        </h2>
        {items.length > 0 && (
          <span className="muted" style={{ fontSize: 13.5 }}>
            {done}/{items.length} completados
          </span>
        )}
      </div>

      {items.length === 0 && <div className="empty">Hoy no hay rutina configurada. Arrastra eventos abajo. 👇</div>}
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
    </section>
  );
}

// ---------- Modal para añadir slot (móvil / sin drag) ----------
function AddSlotModal({
  items,
  weekday,
  onClose,
  onCreated,
}: {
  items: RoutineItem[];
  weekday: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [itemId, setItemId] = useState<number | ''>(items[0]?.id ?? '');
  const [time, setTime] = useState('08:00');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!itemId) return;
    setSaving(true);
    try {
      await routineApi.createSlot({ itemId: Number(itemId), weekday, time });
      onCreated();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Añadir al ${WEEKDAYS[weekday]}`} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label htmlFor="rs-item">Evento</label>
          <select id="rs-item" value={itemId} onChange={(e) => setItemId(Number(e.target.value))}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.emoji} {i.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rs-time">Hora (orientativa)</label>
          <select id="rs-time" value={time} onChange={(e) => setTime(e.target.value)}>
            {HOURS.map((h) => (
              <option key={h} value={`${String(h).padStart(2, '0')}:00`}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={saving || !itemId}>
            Añadir
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Plantilla semanal ----------
function WeekTemplate({
  items,
  slots,
  onChanged,
}: {
  items: RoutineItem[];
  slots: RoutineSlot[];
  onChanged: () => void;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [mobileDay, setMobileDay] = useState<number>((new Date().getDay() + 6) % 7);
  const [adding, setAdding] = useState<number | null>(null);

  function startNew(e: DragEvent, itemId: number) {
    e.dataTransfer.setData('text/rt', `new:${itemId}`);
  }
  function startMove(e: DragEvent, slotId: number) {
    e.dataTransfer.setData('text/rt', `slot:${slotId}`);
  }

  async function drop(e: DragEvent, weekday: number, hour: number) {
    e.preventDefault();
    setDragOver(null);
    const data = e.dataTransfer.getData('text/rt');
    if (!data) return;
    const time = `${String(hour).padStart(2, '0')}:00`;
    const [kind, idStr] = data.split(':');
    if (kind === 'new') await routineApi.createSlot({ itemId: Number(idStr), weekday, time });
    if (kind === 'slot') await routineApi.moveSlot(Number(idStr), { weekday, time });
    onChanged();
  }

  async function remove(slotId: number) {
    await routineApi.removeSlot(slotId);
    onChanged();
  }

  const byCell = useMemo(() => {
    const map = new Map<string, RoutineSlot[]>();
    for (const s of slots) {
      const k = `${s.weekday}-${Number(s.time.slice(0, 2))}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return map;
  }, [slots]);

  return (
    <section className="section">
      <div className="page-head">
        <h2>Configuración semanal</h2>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '2px 0 12px' }}>
        Arrastra un evento a un día y hora. La hora es orientativa: muévela cuando quieras, lo que puntúa es completar
        el check del día.
      </p>

      <div className="rt-catalog">
        {items.map((i) => (
          <span key={i.id} className="rt-chip" draggable onDragStart={(e) => startNew(e, i.id)}>
            {i.emoji} {i.title}
          </span>
        ))}
        {items.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Crea eventos en la pestaña «Eventos» para empezar.</span>}
      </div>

      {/* Escritorio: rejilla semanal con drag & drop */}
      <div className="rt-grid-wrap">
        <div className="rt-grid">
          <span className="rt-gridhead" />
          {WEEKDAYS.map((d) => (
            <span key={d} className="rt-gridhead">
              {d}
            </span>
          ))}
          {HOURS.map((h) => [
            <span key={`h${h}`} className="rt-hour">
              {String(h).padStart(2, '0')}:00
            </span>,
            ...WEEKDAYS.map((_, wd) => {
              const k = `${wd}-${h}`;
              return (
                <div
                  key={k}
                  className={`rt-cell${dragOver === k ? ' over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(k);
                  }}
                  onDragLeave={() => setDragOver((d) => (d === k ? null : d))}
                  onDrop={(e) => drop(e, wd, h)}
                >
                  {(byCell.get(k) ?? []).map((s) => (
                    <span key={s.id} className="rt-block" draggable onDragStart={(e) => startMove(e, s.id)}>
                      {s.emoji} {s.title}
                      <button className="rt-x" title="Quitar" onClick={() => remove(s.id)}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              );
            }),
          ])}
        </div>
      </div>

      {/* Móvil: día a día con selector */}
      <div className="rt-mobile">
        <div className="rt-daychips">
          {WEEKDAYS.map((d, wd) => (
            <button key={d} className={`rt-daychip${mobileDay === wd ? ' active' : ''}`} onClick={() => setMobileDay(wd)}>
              {d}
            </button>
          ))}
        </div>
        <div className="rt-daylist">
          {slots
            .filter((s) => s.weekday === mobileDay)
            .map((s) => (
              <div key={s.id} className="rt-block" style={{ justifyContent: 'space-between' }}>
                <span>
                  <span className="muted" style={{ fontSize: 12, marginRight: 8 }}>{s.time}</span>
                  {s.emoji} {s.title}
                </span>
                <button className="rt-x" onClick={() => remove(s.id)}>
                  ×
                </button>
              </div>
            ))}
          {slots.filter((s) => s.weekday === mobileDay).length === 0 && (
            <p className="muted" style={{ fontSize: 13 }}>Nada configurado este día.</p>
          )}
          <button className="btn ghost sm" onClick={() => setAdding(mobileDay)}>
            + Añadir al {WEEKDAYS[mobileDay]}
          </button>
        </div>
      </div>

      {adding !== null && (
        <AddSlotModal items={items} weekday={adding} onClose={() => setAdding(null)} onCreated={onChanged} />
      )}
    </section>
  );
}

// ---------- Subtab "Mi día" ----------
export default function MiDiaTab() {
  const [items, setItems] = useState<RoutineItem[]>([]);
  const [slots, setSlots] = useState<RoutineSlot[]>([]);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    const [i, s] = await Promise.all([routineApi.items(), routineApi.slots()]);
    setItems(i);
    setSlots(s);
    setRefresh((n) => n + 1);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      {/* key fuerza recarga de evolución y checklist tras cambios */}
      <Evolution key={`ev${refresh}`} />
      <TodayChecklist key={`td${refresh}`} onChanged={load} />
      <WeekTemplate items={items} slots={slots} onChanged={load} />
    </div>
  );
}
