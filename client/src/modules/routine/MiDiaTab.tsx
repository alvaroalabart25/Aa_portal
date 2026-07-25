import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
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
  const [duration, setDuration] = useState(60);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!itemId) return;
    setSaving(true);
    try {
      await routineApi.createSlot({ itemId: Number(itemId), weekday, time, durationMin: duration });
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
            {HOURS.flatMap((h) => ['00', '30'].map((m) => `${String(h).padStart(2, '0')}:${m}`)).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rs-dur">Duración</label>
          <select id="rs-dur" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[15, 30, 45, 60, 90, 120, 180].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60} min` : ''}`}
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

// ---------- Plantilla semanal (calendario) ----------
const HOUR_PX = 48; // 1 hora = 48px (15 min = 12px)
const DAY_START = 6 * 60; // 06:00
const DAY_END = 24 * 60; // 24:00
const COL_HEIGHT = ((DAY_END - DAY_START) / 60) * HOUR_PX;

function toMin(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}
function toHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function snap(m: number, step = 15): number {
  return Math.round(m / step) * step;
}

interface CalItem {
  key: string;
  slotId: number | null; // null = fantasma al arrastrar del catálogo
  start: number; // minutos desde medianoche
  duration: number;
  title: string;
  emoji: string;
  ghost?: boolean;
  dragging?: boolean;
}

// Reparto tipo calendario: los bloques que se solapan comparten el ancho
// de la columna en sub-columnas, como en Calendario de Mac.
function layoutColumn(list: CalItem[]): Array<CalItem & { col: number; cols: number }> {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.duration - a.duration);
  const out: Array<CalItem & { col: number; cols: number }> = [];
  let cluster: Array<CalItem & { col: number; cols: number }> = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const it of cluster) it.cols = colEnds.length;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
    clusterEnd = -1;
  };
  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= it.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(0);
    }
    colEnds[col] = it.start + it.duration;
    clusterEnd = Math.max(clusterEnd, it.start + it.duration);
    cluster.push({ ...it, col, cols: 1 });
  }
  flush();
  return out;
}

function WeekTemplate({
  items,
  slots,
  onChanged,
}: {
  items: RoutineItem[];
  slots: RoutineSlot[];
  onChanged: () => void;
}) {
  const [mobileDay, setMobileDay] = useState<number>((new Date().getDay() + 6) % 7);
  const [adding, setAdding] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: number; weekday: number; start: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: number; duration: number } | null>(null);
  const [ghost, setGhost] = useState<{ weekday: number; start: number } | null>(null);
  const weekRef = useRef<HTMLDivElement>(null);

  function startNew(e: DragEvent, itemId: number) {
    e.dataTransfer.setData('text/rt', `new:${itemId}`);
  }

  // Punto del puntero -> día y minuto (imán de 15 min)
  function pointToCell(clientX: number, clientY: number) {
    const rect = weekRef.current!.getBoundingClientRect();
    const wd = Math.max(0, Math.min(6, Math.floor(((clientX - rect.left) / rect.width) * 7)));
    const raw = DAY_START + ((clientY - rect.top) / HOUR_PX) * 60;
    const min = Math.max(DAY_START, Math.min(snap(raw), DAY_END - 15));
    return { wd, min };
  }

  // Crear desde el catálogo (drag & drop nativo con bloque fantasma)
  function onGridDragOver(e: DragEvent) {
    e.preventDefault();
    const { wd, min } = pointToCell(e.clientX, e.clientY);
    setGhost({ weekday: wd, start: Math.min(min, DAY_END - 60) });
  }
  async function onGridDrop(e: DragEvent) {
    e.preventDefault();
    setGhost(null);
    const data = e.dataTransfer.getData('text/rt');
    if (!data.startsWith('new:')) return;
    const { wd, min } = pointToCell(e.clientX, e.clientY);
    await routineApi.createSlot({
      itemId: Number(data.slice(4)),
      weekday: wd,
      time: toHHMM(Math.min(min, DAY_END - 60)),
      durationMin: 60,
    });
    onChanged();
  }

  // Mover un bloque: arrastre con puntero, previsualización en vivo
  function onMoveStart(e: ReactPointerEvent, id: number) {
    if ((e.target as HTMLElement).closest('.rt-x, .rt-evt-resize')) return;
    const s = slots.find((x) => x.id === id);
    if (!s) return;
    e.preventDefault();
    const startY = e.clientY;
    const orig = toMin(s.time);
    let cur = { id, weekday: s.weekday, start: orig };
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      let ns = snap(orig + (dy / HOUR_PX) * 60);
      ns = Math.max(DAY_START, Math.min(ns, DAY_END - s.durationMin));
      const rect = weekRef.current!.getBoundingClientRect();
      const wd = Math.max(0, Math.min(6, Math.floor(((ev.clientX - rect.left) / rect.width) * 7)));
      cur = { id, weekday: wd, start: ns };
      setDrag(cur);
    };
    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      if (cur.weekday !== s.weekday || cur.start !== orig) {
        await routineApi.moveSlot(id, { weekday: cur.weekday, time: toHHMM(cur.start) });
        onChanged();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Estirar un bloque por el borde inferior
  function onResizeStart(e: ReactPointerEvent, id: number) {
    e.preventDefault();
    e.stopPropagation();
    const s = slots.find((x) => x.id === id);
    if (!s) return;
    const startY = e.clientY;
    const orig = s.durationMin;
    const startMin = toMin(s.time);
    let cur = orig;
    const onMove = (ev: PointerEvent) => {
      let nd = snap(orig + ((ev.clientY - startY) / HOUR_PX) * 60);
      nd = Math.max(15, Math.min(nd, DAY_END - startMin));
      cur = nd;
      setResizing({ id, duration: nd });
    };
    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setResizing(null);
      if (cur !== orig) {
        await routineApi.moveSlot(id, { durationMin: cur });
        onChanged();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  async function remove(slotId: number) {
    await routineApi.removeSlot(slotId);
    onChanged();
  }

  async function clearAll() {
    if (!window.confirm('¿Vaciar toda la plantilla semanal? El historial de la cuadrícula se conserva y los eventos del catálogo no se borran.')) return;
    await routineApi.clearSlots();
    onChanged();
  }

  // Slots con las previsualizaciones de arrastre/estirado aplicadas
  const effective = slots.map((s) => {
    if (drag && drag.id === s.id) return { ...s, weekday: drag.weekday, time: toHHMM(drag.start) };
    if (resizing && resizing.id === s.id) return { ...s, durationMin: resizing.duration };
    return s;
  });

  return (
    <section className="section">
      <div className="page-head">
        <h2>Configuración semanal</h2>
        {slots.length > 0 && (
          <button className="btn ghost sm" onClick={clearAll} title="Vaciar la plantilla para montarla de cero">
            🧹 Limpiar todo
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '2px 0 12px' }}>
        Arrastra un evento del catálogo al calendario. Mueve los bloques con el ratón (imán de 15 min) y estíralos por
        el borde inferior para darles la duración que necesites. La hora es orientativa: lo que puntúa es el check.
      </p>

      <div className="rt-catalog">
        {items.map((i) => (
          <span key={i.id} className="rt-chip" draggable onDragStart={(e) => startNew(e, i.id)}>
            {i.emoji} {i.title}
          </span>
        ))}
        {items.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Crea eventos en la pestaña «Eventos» para empezar.</span>}
      </div>

      {/* Escritorio: calendario semanal continuo */}
      <div className="rt-grid-wrap">
        <div className="rt-cal">
          <div className="rt-cal-head">
            <span className="rt-cal-corner" />
            {WEEKDAYS.map((d) => (
              <span key={d} className="rt-cal-day">
                {d}
              </span>
            ))}
          </div>
          <div className="rt-cal-scroll">
            <div className="rt-cal-body">
              <div className="rt-timegutter" style={{ height: COL_HEIGHT }}>
                {Array.from({ length: (DAY_END - DAY_START) / 60 - 1 }, (_, i) => (
                  <span key={i} style={{ top: (i + 1) * HOUR_PX - 7 }}>
                    {toHHMM(DAY_START + (i + 1) * 60)}
                  </span>
                ))}
              </div>
              <div
                className="rt-week"
                ref={weekRef}
                onDragOver={onGridDragOver}
                onDragLeave={() => setGhost(null)}
                onDrop={onGridDrop}
              >
                {WEEKDAYS.map((_, wd) => {
                  const dayItems: CalItem[] = effective
                    .filter((s) => s.weekday === wd)
                    .map((s) => ({
                      key: String(s.id),
                      slotId: s.id,
                      start: toMin(s.time),
                      duration: s.durationMin,
                      title: s.title,
                      emoji: s.emoji,
                      dragging: drag?.id === s.id,
                    }));
                  if (ghost && ghost.weekday === wd) {
                    dayItems.push({ key: 'ghost', slotId: null, start: ghost.start, duration: 60, title: '', emoji: '', ghost: true });
                  }
                  return (
                    <div key={wd} className="rt-col" style={{ height: COL_HEIGHT }}>
                      {layoutColumn(dayItems).map((it) => (
                        <div
                          key={it.key}
                          className={`rt-evt${it.ghost ? ' ghost' : ''}${it.dragging ? ' dragging' : ''}${resizing && String(resizing.id) === it.key ? ' dragging' : ''}`}
                          style={{
                            top: ((it.start - DAY_START) / 60) * HOUR_PX + 1,
                            height: Math.max((it.duration / 60) * HOUR_PX, 18) - 3,
                            left: `calc(${(100 / it.cols) * it.col}% + 2px)`,
                            width: `calc(${100 / it.cols}% - 5px)`,
                          }}
                          onPointerDown={it.slotId != null ? (e) => onMoveStart(e, it.slotId!) : undefined}
                        >
                          {!it.ghost && (
                            <>
                              <span className="rt-evt-title">
                                {it.emoji} {it.title}
                              </span>
                              <span className="rt-evt-time">
                                {toHHMM(it.start)}–{toHHMM(it.start + it.duration)}
                              </span>
                              <button className="rt-x" title="Quitar" onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(it.slotId!)}>
                                ×
                              </button>
                              <span className="rt-evt-resize" onPointerDown={(e) => onResizeStart(e, it.slotId!)} />
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
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
                  <span className="muted" style={{ fontSize: 12, marginRight: 8 }}>
                    {s.time}–{toHHMM(toMin(s.time) + s.durationMin)}
                  </span>
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
