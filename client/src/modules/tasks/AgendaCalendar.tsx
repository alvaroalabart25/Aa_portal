import { useMemo, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { tasksApi } from './api';
import type { Task } from './types';

const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MAX_CHIPS = 2; // minimal: 2 tareas visibles por día, el resto al hover

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Calendario mensual minimal: contador de tareas por día, hasta 2 chips
// y el listado completo en un panel al pasar el ratón.
// Las tareas se pueden arrastrar a otro día para cambiar su vencimiento.
export default function AgendaCalendar({ tasks, onChanged }: { tasks: Task[]; onChanged: () => void }) {
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [dragOver, setDragOver] = useState<string | null>(null);

  function startDrag(e: DragEvent, taskId: number) {
    e.dataTransfer.setData('text/task-id', String(taskId));
    e.dataTransfer.effectAllowed = 'move';
  }

  async function dropOnDay(e: DragEvent, iso: string) {
    e.preventDefault();
    setDragOver(null);
    const id = Number(e.dataTransfer.getData('text/task-id'));
    if (!id) return;
    await tasksApi.update(id, { dueDate: iso });
    onChanged();
  }

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      if (!map.has(t.dueDate)) map.set(t.dueDate, []);
      map.get(t.dueDate)!.push(t);
    }
    return map;
  }, [tasks]);

  const today = isoLocal(new Date());
  const year = month.getFullYear();
  const mon = month.getMonth();
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const offset = (new Date(year, mon, 1).getDay() + 6) % 7; // lunes = 0

  const raw = month.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const label = raw.charAt(0).toUpperCase() + raw.slice(1); // "Julio de 2026"

  const cells: Array<{ day: number; iso: string; col: number } | null> = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ day, iso, col: (offset + day - 1) % 7 });
  }

  return (
    <div>
      <div className="cal-head">
        <h2>{label}</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn ghost sm" aria-label="Mes anterior" onClick={() => setMonth(new Date(year, mon - 1, 1))}>
            ‹
          </button>
          <button className="btn ghost sm" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
            Hoy
          </button>
          <button className="btn ghost sm" aria-label="Mes siguiente" onClick={() => setMonth(new Date(year, mon + 1, 1))}>
            ›
          </button>
        </div>
      </div>

      <div className="cal-grid">
        {DOW.map((d) => (
          <div key={d} className="cal-dow">
            {d}
          </div>
        ))}
        {cells.map((c, i) =>
          c === null ? (
            <div key={`e${i}`} className="cal-day empty" />
          ) : (
            <div
              key={c.iso}
              className={`cal-day${c.iso === today ? ' today' : ''}${dragOver === c.iso ? ' dragover' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(c.iso);
              }}
              onDragLeave={() => setDragOver((d) => (d === c.iso ? null : d))}
              onDrop={(e) => dropOnDay(e, c.iso)}
            >
              <div className="cal-daytop">
                <span className="cal-num">{c.day}</span>
                {byDay.has(c.iso) && <span className="cal-count">{byDay.get(c.iso)!.length}</span>}
              </div>

              {(byDay.get(c.iso) ?? []).slice(0, MAX_CHIPS).map((t) => (
                <div
                  key={t.id}
                  className="cal-chip"
                  draggable
                  onDragStart={(e) => startDrag(e, t.id)}
                  onClick={() => navigate(`/tareas/${t.id}`)}
                >
                  <span className="dot" style={{ background: t.spaceColor ?? '#0a0a0a', width: 6, height: 6 }} />
                  <span className="cal-chip-text">{t.title}</span>
                </div>
              ))}
              {(byDay.get(c.iso)?.length ?? 0) > MAX_CHIPS && (
                <div className="cal-more">+{byDay.get(c.iso)!.length - MAX_CHIPS} más</div>
              )}

              {byDay.has(c.iso) && (
                <div className={`cal-pop${c.col >= 5 ? ' right' : ''}`}>
                  <div className="cal-pop-date">
                    {(() => {
                      const s = new Date(c.iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
                      return s.charAt(0).toUpperCase() + s.slice(1); // "Lunes, 6 de julio"
                    })()}
                  </div>
                  {byDay.get(c.iso)!.map((t) => (
                    <button
                      key={t.id}
                      className="cal-pop-item"
                      draggable
                      onDragStart={(e) => startDrag(e, t.id)}
                      onClick={() => navigate(`/tareas/${t.id}`)}
                    >
                      <span className="dot" style={{ background: t.spaceColor ?? '#0a0a0a' }} />
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span className="muted" style={{ textTransform: 'uppercase', fontSize: 11 }}>
                          {t.projectName}
                        </span>{' '}
                        {t.title}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
