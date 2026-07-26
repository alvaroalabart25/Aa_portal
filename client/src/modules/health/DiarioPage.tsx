import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import Modal from '../../components/Modal';
import { get, API_BASE } from '../../lib/api';
import { routineApi, type RoutineItem } from '../routine/api';
import { eventsApi } from '../events/api';
import { occursOn, type ImportantEvent } from '../events/types';
import { diaryApi, healthApi, type DiarySession, type HealthEntry } from './api';

const HOUR_PX = 76; // 1 hora = 76px: cada hora se lee cómoda
const COL_HEIGHT = 24 * HOUR_PX;

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayStartOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function minToHHMM(m: number): string {
  const mm = Math.max(0, Math.min(Math.round(m), 24 * 60 - 1));
  return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
}
function hhmmToMin(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}
function nowHHMM(): string {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}
function snap5(m: number): number {
  return Math.round(m / 5) * 5;
}
function itemHue(id: number): number {
  return Math.round((id * 137.508) % 360);
}

interface Block {
  s: DiarySession;
  startMin: number;
  endMin: number;
  open: boolean;
}

// Modal para añadir/corregir un bloque de actividad (edición a posteriori)
function SessionModal({
  session,
  items,
  day,
  onClose,
  onSaved,
}: {
  session: DiarySession | null; // null = crear
  items: RoutineItem[];
  day: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [itemId, setItemId] = useState<number>(session?.itemId ?? items[0]?.id ?? 0);
  const [start, setStart] = useState(session ? minToHHMM((new Date(session.startAt).getTime() - dayStartOf(day).getTime()) / 60000) : '09:00');
  const [end, setEnd] = useState(
    session ? (session.endAt ? minToHHMM((new Date(session.endAt).getTime() - dayStartOf(day).getTime()) / 60000) : '') : '10:00',
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function toIso(hhmm: string): string {
    const d = dayStartOf(day);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5))).toISOString();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!itemId || !start) return;
    if (end && hhmmToMin(end) <= hhmmToMin(start)) {
      setErr('El fin debe ser posterior al inicio');
      return;
    }
    setSaving(true);
    try {
      if (session) {
        await diaryApi.update(session.id, { itemId, startAt: toIso(start), endAt: end ? toIso(end) : session.endAt === null ? null : toIso(start) });
      } else {
        if (!end) {
          setErr('Para añadir a posteriori indica el fin');
          setSaving(false);
          return;
        }
        await diaryApi.create(itemId, toIso(start), toIso(end));
      }
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  async function removeSession() {
    if (!session) return;
    await diaryApi.remove(session.id);
    onSaved();
    onClose();
  }

  return (
    <Modal title={session ? 'Corregir bloque' : 'Añadir bloque'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label htmlFor="dy-item">Actividad</label>
          <select id="dy-item" value={itemId} onChange={(e) => setItemId(Number(e.target.value))}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.emoji} {i.title}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="dy-start">Inicio</label>
            <input id="dy-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="dy-end">Fin {session?.endAt === null && <span className="muted">(en curso)</span>}</label>
            <input id="dy-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        {err && <p style={{ fontSize: 13, color: 'var(--danger)' }}>{err}</p>}
        <div className="modal-actions">
          {session && (
            <button type="button" className="btn danger sm" onClick={removeSession} style={{ marginRight: 'auto' }}>
              Eliminar
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={saving}>
            Guardar
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Modal para crear una actividad nueva del catálogo (compartido con Rutina)
function NewItemModal({ onClose, onCreated }: { onClose: () => void; onCreated: (item: RoutineItem) => void }) {
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState('☕');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const item = await routineApi.createItem({ title: title.trim(), emoji: emoji.trim() || '🔁' });
      onCreated(item);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Nueva actividad" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="field" style={{ width: 70 }}>
            <label htmlFor="ni-emoji">Emoji</label>
            <input id="ni-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="ni-title">Nombre</label>
            <input id="ni-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Café, Desayuno, Ver pelis..." />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Queda disponible también en el catálogo de Rutina.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={saving || !title.trim()}>
            Crear
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Control remoto (Atajos de iOS): UN solo atajo con menú dinámico. El menú
// sale de las actividades ★ favoritas del catálogo (o todas si no hay).
function ControlRemotoModal({ onClose }: { onClose: () => void }) {
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    get<{ secret: string }>('/track-setup').then((r) => setSecret(r.secret));
  }, []);

  const base = `${API_BASE || window.location.origin}/api/track?t=${secret}`;

  async function copy(label: string, url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(label);
    setTimeout(() => setCopied(''), 1500);
  }

  const row = (label: string, url: string) => (
    <div key={label} className="rc-row">
      <span className="rc-label">{label}</span>
      <input className="rc-url" readOnly value={url} onFocus={(e) => e.target.select()} />
      <button className="btn ghost sm rc-copy" onClick={() => copy(label, url)}>
        {copied === label ? '✓ Copiado' : 'Copiar'}
      </button>
    </div>
  );

  return (
    <Modal title="🎛️ Control remoto (Atajos de iOS)" onClose={onClose}>
      {!secret && <p className="muted" style={{ fontSize: 13 }}>Generando token…</p>}
      {secret && (
        <>
          <p style={{ fontSize: 13.5, fontWeight: 600, margin: '4px 0 6px' }}>El atajo único (móntalo una vez)</p>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: '0 0 10px' }}>
            Un solo botón: lo tocas, sale el menú con tus actividades ★ y lo que elijas queda registrado. El menú se
            actualiza solo cuando cambias tus favoritas aquí — el iPhone no se toca más.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {row('1 · URL del menú', `${base}&action=list`)}
            {row('2 · URL de acción', `${base}&action=do&what=`)}
          </div>
          <ol className="muted" style={{ fontSize: 12.5, lineHeight: 1.7, margin: '10px 0 0', paddingLeft: 18 }}>
            <li>App <strong>Atajos</strong> → ＋ → acción <strong>«Obtener contenido de URL»</strong> → pega la URL 1.</li>
            <li>Añade <strong>«Obtener valor del diccionario»</strong> → obtener <em>Valor</em> para la clave <code>opciones</code>.</li>
            <li>
              Añade <strong>«Seleccionar de la lista»</strong> (busca «Seleccionar» en el buscador de acciones). Este
              paso es el que suele faltar: sin él se envía la lista entera y no funciona. Colócalo entre la acción
              anterior y la siguiente.
            </li>
            <li>
              Añade otra <strong>«Obtener contenido de URL»</strong> → pega la URL 2 y, pegado detrás de{' '}
              <code>what=</code>, inserta la variable <strong>Ítem seleccionado</strong> (no «Valor del diccionario»).
            </li>
            <li>Opcional: <strong>«Mostrar notificación»</strong> con «Contenido de URL» — te confirma «▶ Trabajar desde las 9:02».</li>
          </ol>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            El orden final debe ser: URL menú → Valor de <code>opciones</code> → <strong>Seleccionar de la lista</strong> → URL acción.
          </p>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 10 }}>
            Colócalo donde quieras (tu parte E): widget de Atajos en la pantalla de inicio, <strong>Centro de
            Control</strong> (iOS 18: ＋ → Atajos), pantalla de bloqueo o el botón de acción. Marca tus favoritas con la
            ★ en Rutina → Eventos.
          </p>
          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 13, cursor: 'pointer' }}>URLs sueltas (Tocar atrás, NFC, Siri o peso)</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {row('🚬 Piti', `${base}&action=cigarro&plain=1`)}
              {row('■ Parar', `${base}&action=stop&plain=1`)}
              {row('⚖️ Peso', `${base}&action=peso&plain=1&value=`)}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
              La del piti es perfecta para <strong>Tocar atrás</strong> (Ajustes → Accesibilidad → Tocar → Tocar atrás)
              o una pegatina NFC. Para el peso: añade antes «Solicitar entrada» (número) y pega su resultado al final.
              El token es secreto — no compartas estas URLs.
            </p>
          </details>
        </>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Listo
        </button>
      </div>
    </Modal>
  );
}

// Salud · Diario: la radiografía del día. Actividades secuenciales (empezar
// una para la anterior), el cigarro se superpone como marca, y el peso es la
// pregunta del día. De esta realidad saldrán las rutinas que sí encajan.
export default function DiarioPage() {
  const [day, setDay] = useState<Date>(() => dayStartOf(new Date()));
  const [sessions, setSessions] = useState<DiarySession[]>([]);
  const [entries, setEntries] = useState<HealthEntry[]>([]);
  const [items, setItems] = useState<RoutineItem[]>([]);
  const [eventsList, setEventsList] = useState<ImportantEvent[]>([]);
  const [current, setCurrent] = useState<DiarySession | null>(null);
  const [editing, setEditing] = useState<DiarySession | 'new' | null>(null);
  const [creatingItem, setCreatingItem] = useState(false);
  const [remote, setRemote] = useState(false);
  const [allActs, setAllActs] = useState(false);
  const [pesoInput, setPesoInput] = useState('');
  const [pesoTime, setPesoTime] = useState(nowHHMM());
  const [busy, setBusy] = useState(false);
  const calRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  // arrastre en la radiografía: bloques (mover/estirar) y marcas (mover)
  const [drag, setDrag] = useState<{ id: number; startMin: number; endMin: number | null } | null>(null);
  const [markDrag, setMarkDrag] = useState<{ key: string; min: number } | null>(null);

  const today = isoLocal(new Date());
  const dayIso = isoLocal(day);
  const isToday = dayIso === today;

  const load = useCallback(async () => {
    const from = dayStartOf(day);
    const to = new Date(from.getTime() + 24 * 3600 * 1000);
    const [s, d, i, c, ev] = await Promise.all([
      diaryApi.sessions(from.toISOString(), to.toISOString()),
      healthApi.day(dayIso),
      routineApi.items(),
      diaryApi.current(),
      eventsApi.list(),
    ]);
    setSessions(s);
    setEntries(d.entries);
    setItems(i);
    setCurrent(c);
    setEventsList(ev);
  }, [day, dayIso]);
  useEffect(() => {
    load();
  }, [load]);

  // Al abrir (y al cambiar de día) la radiografía se sitúa en la hora actual;
  // en días pasados, en su primer registro. Una vez centrado, no se mueve más.
  const centeredFor = useRef('');
  useEffect(() => {
    const el = calRef.current;
    if (!el || centeredFor.current === dayIso) return;
    const first = sessions.length
      ? Math.min(...sessions.map((x) => (new Date(x.startAt).getTime() - dayStartOf(day).getTime()) / 60000))
      : null;
    if (!isToday && first === null) return; // en días pasados, esperar los datos
    const ahora = new Date();
    const target = isToday ? ahora.getHours() * 60 + ahora.getMinutes() : first!;
    el.scrollTop = Math.max(0, (target / 60) * HOUR_PX - el.clientHeight / 2);
    centeredFor.current = dayIso;
  }, [dayIso, day, sessions, isToday]);

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  // Las sesiones con inicio = fin son marcas puntuales, no bloques
  const isMoment = (x: DiarySession) => x.endAt !== null && new Date(x.endAt).getTime() - new Date(x.startAt).getTime() < 60000;

  const blocks: Block[] = useMemo(() => {
    const start = dayStartOf(day).getTime();
    return sessions
      .filter((s) => !isMoment(s))
      .map((s) => {
        const sm = (new Date(s.startAt).getTime() - start) / 60000;
        const open = s.endAt === null;
        const em = open ? (isToday ? nowMin : 24 * 60) : (new Date(s.endAt!).getTime() - start) / 60000;
        const b = { s, startMin: Math.max(0, sm), endMin: Math.min(24 * 60, Math.max(em, sm + 4)), open };
        if (drag && drag.id === s.id) {
          return { ...b, startMin: drag.startMin, endMin: drag.endMin ?? (isToday ? Math.max(nowMin, drag.startMin + 4) : 24 * 60) };
        }
        return b;
      })
      .sort((a, b2) => a.startMin - b2.startMin);
  }, [sessions, day, isToday, nowMin, drag]);

  const moments = useMemo(() => {
    const start = dayStartOf(day).getTime();
    return sessions.filter(isMoment).map((s) => ({ s, min: (new Date(s.startAt).getTime() - start) / 60000 }));
  }, [sessions, day]);

  const cigs = useMemo(() => entries.filter((e) => e.kind === 'cigarro' && e.entryTime), [entries]);
  // eventos importantes de la Agenda que caen en este día
  const dayEvents = useMemo(() => eventsList.filter((e) => occursOn(e, dayIso)), [eventsList, dayIso]);
  const timedEvents = dayEvents.filter((e) => e.eventTime);
  const untimedEvents = dayEvents.filter((e) => !e.eventTime);
  const peso = useMemo(() => entries.filter((e) => e.kind === 'peso').at(-1) ?? null, [entries]);

  // contexto de cada piti: la actividad que corría en ese momento
  const cigsByContext = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of cigs) {
      const m = hhmmToMin(c.entryTime!);
      const b = blocks.find((x) => x.startMin <= m && m < x.endMin);
      const k = b ? `${b.s.emoji} ${b.s.title}` : 'sin actividad';
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return [...map.entries()];
  }, [cigs, blocks]);

  // minuto del día mostrado -> ISO para el servidor
  function isoAt(min: number): string {
    const d = dayStartOf(day);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(min / 60), Math.round(min % 60)).toISOString();
  }

  // Arrastrar un bloque: mover (cambia la hora manteniendo la duración) o
  // estirar por el borde inferior. Un toque sin mover abre el detalle.
  function onBlockDown(e: ReactPointerEvent, b: Block, mode: 'move' | 'resize') {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const origStart = b.startMin;
    const origEnd = b.open ? null : b.endMin;
    const dur = origEnd != null ? origEnd - origStart : null;
    let moved = false;
    let cur = { startMin: origStart, endMin: origEnd };

    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dy) < 3) return;
      moved = true;
      const dmin = snap5((dy / HOUR_PX) * 60);
      if (mode === 'move') {
        const ns = Math.max(0, Math.min(origStart + dmin, 24 * 60 - (dur ?? 5)));
        cur = { startMin: ns, endMin: dur != null ? ns + dur : null };
      } else {
        cur = { startMin: origStart, endMin: Math.max(origStart + 5, Math.min((origEnd ?? origStart) + dmin, 24 * 60)) };
      }
      setDrag({ id: b.s.id, ...cur });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) {
        setDrag(null);
        setEditing(b.s);
        return;
      }
      // Optimista: el bloque se queda donde lo has soltado y el guardado va
      // por detrás; solo si falla se recarga la verdad del servidor.
      const startAt = isoAt(cur.startMin);
      const endAt = cur.endMin != null ? isoAt(cur.endMin) : null;
      setSessions((list) => list.map((x) => (x.id === b.s.id ? { ...x, startAt, endAt: endAt ?? x.endAt } : x)));
      setDrag(null);
      diaryApi
        .update(b.s.id, { startAt, ...(endAt ? { endAt } : {}) })
        .catch(() => load());
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Arrastrar una marca (piti o puntual) para corregir su hora; toque = borrar
  function onMarkDown(
    e: ReactPointerEvent,
    mk: {
      key: string;
      min: number;
      save: (min: number) => Promise<unknown>;
      del: () => Promise<unknown>;
      local: (min: number) => void;
      localDel: () => void;
    },
  ) {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    let moved = false;
    let cur = mk.min;
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dy) < 3) return;
      moved = true;
      cur = Math.max(0, Math.min(snap5(mk.min + (dy / HOUR_PX) * 60), 24 * 60 - 5));
      setMarkDrag({ key: mk.key, min: cur });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) {
        mk.localDel();
        setMarkDrag(null);
        mk.del().catch(() => load());
        return;
      }
      mk.local(cur);
      setMarkDrag(null);
      mk.save(cur).catch(() => load());
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function moveDay(delta: number) {
    const d = new Date(day);
    d.setDate(d.getDate() + delta);
    setDay(dayStartOf(d));
  }

  // Puntuales (Levantarme): dejan una marca y no interrumpen lo que haya en
  // curso. El resto abre bloque y cierra el anterior.
  async function startActivity(item: RoutineItem) {
    setBusy(true);
    try {
      if (item.isInstant === 1) await diaryApi.moment(item.id);
      else await diaryApi.start(item.id);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function stopActivity() {
    setBusy(true);
    try {
      await diaryApi.stop();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function addCig() {
    setBusy(true);
    try {
      await healthApi.add('cigarro');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function savePeso() {
    const v = Number(pesoInput.replace(',', '.'));
    if (!v || v <= 0 || v > 400) return;
    setBusy(true);
    try {
      await healthApi.add('peso', { value: v, time: pesoTime });
      setPesoInput('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  const dayLabel = day.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div>
      <div className="page-head">
        <h1>Diario</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn ghost sm" onClick={() => setRemote(true)} title="Registrar desde el iPhone sin abrir la app">
          🎛️
        </button>
        <div className="seg">
          <button onClick={() => moveDay(-1)} title="Día anterior">
            ‹
          </button>
          <button onClick={() => setDay(dayStartOf(new Date()))}>
            {isToday ? 'Hoy' : dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)}
          </button>
          <button onClick={() => moveDay(1)} title="Día siguiente" disabled={dayIso >= today}>
            ›
          </button>
        </div>
        </div>
      </div>
      {isToday && (
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          {dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)} · tu día tal y como está pasando. Toca una actividad
          para empezarla (la anterior se cierra sola).
        </p>
      )}

      {isToday && (
        <section className="section" style={{ marginTop: 16 }}>
          <div className="dy-nowbar">
            <span className="dy-now-info">
              {current ? (
                <>
                  <span className="dy-nowdot" />
                  <strong className="dy-now-title">
                    {current.emoji} {current.title}
                  </strong>
                  <span className="dy-now-time">
                    {new Date(current.startAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </>
              ) : (
                <span className="muted" style={{ fontSize: 13.5 }}>Sin actividad en curso</span>
              )}
            </span>
            {current && (
              <button className="btn ghost sm dy-nowbtn" disabled={busy} onClick={stopActivity} title="Parar la actividad">
                ■ Parar
              </button>
            )}
            <button className="btn sm dy-nowbtn" disabled={busy} onClick={addCig} title="Registrar un piti ahora">
              🚬 {cigs.length}
            </button>
          </div>

          <div className="dy-actsblock">
            <button className="dy-actshead" onClick={() => setAllActs(!allActs)}>
              <span>Eventos principales ({items.length})</span>
              <span className="dy-chev">{allActs ? '⌃' : '⌄'}</span>
            </button>
            {allActs && (
              <div className="dy-acts open">
                {items.map((i) => (
                  <button
                    key={i.id}
                    className={`rt-chip dy-chip${current?.itemId === i.id ? ' active' : ''}${i.isInstant === 1 ? ' instant' : ''}`}
                    disabled={busy || current?.itemId === i.id}
                    onClick={() => startActivity(i)}
                    title={i.isInstant === 1 ? 'Puntual: deja una marca y no interrumpe nada' : undefined}
                  >
                    {i.emoji} {i.title}
                  </button>
                ))}
                <button className="rt-chip dy-chip" onClick={() => setCreatingItem(true)}>
                  ＋ Nueva
                </button>
                <button
                  className="rt-chip dy-chip dy-stopall"
                  disabled={busy || !current}
                  onClick={stopActivity}
                  title={current ? 'Cierra lo que esté en curso' : 'No hay nada en curso'}
                >
                  ■ Parar todo
                </button>
              </div>
            )}
          </div>

          <div className="dy-peso">
            {peso ? (
              <span style={{ fontSize: 13.5 }}>
                ⚖️ <strong>{peso.value} kg</strong>
                <span className="muted"> · a las {peso.entryTime}</span>
                <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={async () => { await healthApi.remove(peso.id); load(); }}>
                  ↺
                </button>
              </span>
            ) : (
              <>
                <span className="dy-peso-q">⚖️ ¿Te has pesado hoy?</span>
                <span className="dy-peso-in">
                  <input inputMode="decimal" placeholder="kg" value={pesoInput} onChange={(e) => setPesoInput(e.target.value)} />
                  <input type="time" value={pesoTime} onChange={(e) => setPesoTime(e.target.value)} />
                  <button className="btn sm" disabled={busy || !pesoInput} onClick={savePeso}>
                    ✓
                  </button>
                </span>
              </>
            )}
          </div>
        </section>
      )}

      <section className="section">
        <div className="page-head">
          <h2>Radiografía</h2>
          <button className="btn ghost sm" onClick={() => setEditing('new')}>
            ＋ Añadir bloque
          </button>
        </div>
        {untimedEvents.length > 0 && (
          <div className="dy-events-strip">
            {untimedEvents.map((e) => (
              <span key={e.id} className="dy-event-chip" title="Evento importante (se edita en Agenda · Eventos)">
                {e.emoji} {e.title}
              </span>
            ))}
          </div>
        )}
        {(cigs.length > 0 || !isToday) && (
          <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>
            🚬 {cigs.length} {cigs.length === 1 ? 'piti' : 'pitis'}
            {cigsByContext.length > 0 && <> · {cigsByContext.map(([k, n]) => `${n} ${k}`).join(' · ')}</>}
            {!isToday && peso && <> · ⚖️ {peso.value} kg a las {peso.entryTime}</>}
          </p>
        )}
        <div className="dy-cal" ref={calRef}>
          <div className="dy-body">
            <div className="dy-gutter" style={{ height: COL_HEIGHT }}>
              {Array.from({ length: 23 }, (_, i) => (
                <span key={i} style={{ top: (i + 1) * HOUR_PX - 7 }}>
                  {String(i + 1).padStart(2, '0')}:00
                </span>
              ))}
            </div>
            <div className="dy-col" ref={colRef} style={{ height: COL_HEIGHT }}>
              {(() => {
                let prevBottom = -99;
                let indent = 0;
                return blocks.map((b) => {
                const hue = itemHue(b.s.itemId);
                const compact = b.endMin - b.startMin < 45;
                const top = (b.startMin / 60) * HOUR_PX + 1;
                const height = Math.max(((b.endMin - b.startMin) / 60) * HOUR_PX - 3, 15);
                // si el bloque anterior aún ocupa este hueco, escalona a la derecha
                indent = top < prevBottom ? Math.min(indent + 1, 3) : 0;
                prevBottom = top + height;
                return (
                  <div
                    key={b.s.id}
                    className={`dy-evt${compact ? ' compact' : ''}${b.open ? ' open' : ''}`}
                    style={{
                      top,
                      height,
                      marginLeft: indent * 16,
                      zIndex: 2 + indent,
                      background: `hsla(${hue}, 65%, 95%, 0.9)`,
                      borderColor: `hsla(${hue}, 45%, 70%, 0.6)`,
                      borderLeftColor: `hsl(${hue}, 55%, 42%)`,
                    }}
                    onPointerDown={(e) => onBlockDown(e, b, 'move')}
                    title="Arrastra para cambiar la hora · toca para editar"
                  >
                    <span className="dy-evt-title">
                      {b.s.emoji} {b.s.title}
                      {b.open && <span className="dy-live"> · en curso</span>}
                    </span>
                    <span className="dy-evt-time">
                      {minToHHMM(b.startMin)}–{b.open ? '…' : minToHHMM(b.endMin)}
                    </span>
                    {!b.open && (
                      <span
                        className="dy-evt-resize"
                        title="Arrastra para cambiar la duración"
                        onPointerDown={(e) => onBlockDown(e, b, 'resize')}
                      />
                    )}
                  </div>
                );
                });
              })()}
              {timedEvents.map((e) => (
                <div
                  key={`ev${e.id}`}
                  className="dy-event"
                  style={{ top: (hhmmToMin(e.eventTime!) / 60) * HOUR_PX }}
                  title={`${e.title} · ${e.eventTime} — evento de la Agenda (se edita allí)`}
                >
                  <span className="dy-event-flag">
                    {e.emoji} {e.title} · {e.eventTime}
                  </span>
                </div>
              ))}
              {(() => {
                // Carril derecho: puntuales y pitis. Se arrastran para corregir
                // la hora; un toque sin mover los borra.
                const marks = [
                  ...moments.map(({ s: m, min }) => ({
                    key: `m${m.id}`,
                    min,
                    label: m.emoji,
                    save: (nm: number) => diaryApi.update(m.id, { startAt: isoAt(nm), endAt: isoAt(nm) }),
                    del: () => diaryApi.remove(m.id),
                    local: (nm: number) =>
                      setSessions((list) => list.map((x) => (x.id === m.id ? { ...x, startAt: isoAt(nm), endAt: isoAt(nm) } : x))),
                    localDel: () => setSessions((list) => list.filter((x) => x.id !== m.id)),
                    name: m.title,
                  })),
                  ...cigs.map((c) => ({
                    key: `c${c.id}`,
                    min: hhmmToMin(c.entryTime!),
                    label: '🚬',
                    save: (nm: number) => healthApi.setTime(c.id, minToHHMM(nm)),
                    del: () => healthApi.remove(c.id),
                    local: (nm: number) =>
                      setEntries((list) => list.map((x) => (x.id === c.id ? { ...x, entryTime: minToHHMM(nm) } : x))),
                    localDel: () => setEntries((list) => list.filter((x) => x.id !== c.id)),
                    name: 'Cigarro',
                  })),
                ]
                  .map((mk) => (markDrag?.key === mk.key ? { ...mk, min: markDrag.min } : mk))
                  .sort((a, b2) => a.min - b2.min);
                let prev = -99;
                let level = 0;
                return marks.map((mk) => {
                  level = mk.min - prev < 18 ? level + 1 : 0;
                  prev = mk.min;
                  return (
                    <span
                      key={mk.key}
                      className={`dy-mark${markDrag?.key === mk.key ? ' dragging' : ''}`}
                      style={{ top: (mk.min / 60) * HOUR_PX - 9 + level * 17 }}
                      title={`${mk.name} · ${minToHHMM(mk.min)} — arrastra para cambiar la hora, toca para borrar`}
                      onPointerDown={(e) => onMarkDown(e, mk)}
                    >
                      {mk.label} {minToHHMM(mk.min)}
                    </span>
                  );
                });
              })()}
              {isToday && <div className="dy-now" style={{ top: (nowMin / 60) * HOUR_PX }} />}
            </div>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Arrastra un bloque para cambiarlo de hora, o su borde inferior para ajustar cuánto duró; las marcas (🚬 y
          puntuales) también se arrastran. Un toque abre el detalle del bloque, y en una marca la borra. El imán es de
          5 minutos.
        </p>
      </section>

      <ResumenDias />

      {editing && (
        <SessionModal session={editing === 'new' ? null : editing} items={items} day={day} onClose={() => setEditing(null)} onSaved={load} />
      )}
      {creatingItem && <NewItemModal onClose={() => setCreatingItem(false)} onCreated={() => load()} />}
      {remote && <ControlRemotoModal onClose={() => setRemote(false)} />}
    </div>
  );
}

// Serie de los últimos 14 días: pitis y peso (con su hora)
function ResumenDias() {
  const [summary, setSummary] = useState<{ date: string; cigarros: number; peso: number | null; pesoTime: string | null }[]>([]);

  useEffect(() => {
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 13);
    healthApi.summary(isoLocal(from), isoLocal(today)).then(setSummary);
  }, []);

  if (summary.length === 0) return null;
  const maxCigs = Math.max(1, ...summary.map((s) => s.cigarros));

  return (
    <section className="section">
      <h2>Últimos 14 días</h2>
      <div className="hl-days">
        {summary.map((s) => (
          <div key={s.date} className="hl-day">
            <span className="hl-day-label">
              {new Date(`${s.date}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
            <span className="hl-day-bar">
              <span className="hl-day-fill pausa" style={{ width: `${(s.cigarros / maxCigs) * 100}%` }} />
            </span>
            <span className="hl-day-num">🚬 {s.cigarros}</span>
            <span className="hl-day-peso">{s.peso != null ? `⚖️ ${s.peso} kg · ${s.pesoTime ?? ''}` : ''}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
