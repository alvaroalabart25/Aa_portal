import { useCallback, useEffect, useMemo, useState } from 'react';
import { healthApi, type DaySummary, type HealthEntry, type HealthKind } from './api';

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Contador grande de un tipo de piti: +1 al toque, − para corregir
function Tally({
  emoji,
  label,
  count,
  busy,
  onAdd,
  onUndo,
}: {
  emoji: string;
  label: string;
  count: number;
  busy: boolean;
  onAdd: () => void;
  onUndo: () => void;
}) {
  return (
    <div className="hl-tally">
      <span className="hl-tally-emoji">{emoji}</span>
      <div className="hl-tally-mid">
        <span className="hl-tally-label">{label}</span>
        <span className="hl-tally-count">{count}</span>
      </div>
      <div className="hl-tally-btns">
        <button className="btn sm" disabled={busy} onClick={onAdd}>
          +1
        </button>
        <button className="btn ghost sm" disabled={busy || count === 0} onClick={onUndo} title="Quitar el último">
          −
        </button>
      </div>
    </div>
  );
}

// Salud · Diario: registrar la realidad del día (pitis y peso) y ver la
// serie de los últimos días. La base para comparar plan vs realidad.
export default function DiarioPage() {
  const [entries, setEntries] = useState<HealthEntry[]>([]);
  const [summary, setSummary] = useState<DaySummary[]>([]);
  const [pesoInput, setPesoInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 13);
    const [d, s] = await Promise.all([healthApi.day(), healthApi.summary(isoLocal(from), isoLocal(today))]);
    setEntries(d.entries);
    setSummary(s);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(
    () => ({
      pausa: entries.filter((e) => e.kind === 'cig_pausa').length,
      trabajo: entries.filter((e) => e.kind === 'cig_trabajo').length,
      peso: entries.filter((e) => e.kind === 'peso').at(-1)?.value ?? null,
    }),
    [entries],
  );

  async function add(kind: HealthKind, value?: number) {
    setBusy(true);
    try {
      await healthApi.add(kind, value);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function undo(kind: HealthKind) {
    const last = entries.filter((e) => e.kind === kind).at(-1);
    if (!last) return;
    setBusy(true);
    try {
      await healthApi.remove(last.id);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function savePeso() {
    const v = Number(pesoInput.replace(',', '.'));
    if (!v || v <= 0 || v > 400) {
      setMsg('Pon un peso válido en kg (ej. 78,4)');
      return;
    }
    setMsg('');
    await add('peso', v);
    setPesoInput('');
  }

  const maxCigs = Math.max(1, ...summary.map((s) => s.cigPausa + s.cigTrabajo));

  return (
    <div>
      <div className="page-head">
        <h1>Diario</h1>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
        Tu realidad del día, sin juicio: primero medir, luego decidir. Cada toque queda registrado con fecha.
      </p>

      <section className="section" style={{ marginTop: 18 }}>
        <h2>Hoy</h2>
        <div className="hl-tallies">
          <Tally emoji="🚬" label="Piti en pausa" count={counts.pausa} busy={busy} onAdd={() => add('cig_pausa')} onUndo={() => undo('cig_pausa')} />
          <Tally emoji="💻" label="Piti trabajando" count={counts.trabajo} busy={busy} onAdd={() => add('cig_trabajo')} onUndo={() => undo('cig_trabajo')} />
          <div className="hl-tally">
            <span className="hl-tally-emoji">⚖️</span>
            <div className="hl-tally-mid">
              <span className="hl-tally-label">Peso</span>
              <span className="hl-tally-count">{counts.peso != null ? `${counts.peso} kg` : '—'}</span>
            </div>
            <div className="hl-tally-btns" style={{ flexDirection: 'row', alignItems: 'center' }}>
              <input
                inputMode="decimal"
                placeholder="kg"
                value={pesoInput}
                onChange={(e) => setPesoInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && savePeso()}
                style={{ width: 72 }}
              />
              <button className="btn sm" disabled={busy || !pesoInput} onClick={savePeso}>
                ✓
              </button>
            </div>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          Total pitis hoy: <strong>{counts.pausa + counts.trabajo}</strong> · {counts.pausa} en pausa · {counts.trabajo} trabajando
        </p>
        {msg && <p style={{ fontSize: 13, marginTop: 6 }}>{msg}</p>}
      </section>

      <section className="section">
        <h2>Últimos 14 días</h2>
        {summary.length === 0 && <div className="empty">Aún sin registros. Empieza hoy con un toque arriba. ☝️</div>}
        <div className="hl-days">
          {summary.map((s) => {
            const total = s.cigPausa + s.cigTrabajo;
            return (
              <div key={s.date} className="hl-day">
                <span className="hl-day-label">{dayLabel(s.date)}</span>
                <span className="hl-day-bar">
                  <span className="hl-day-fill pausa" style={{ width: `${(s.cigPausa / maxCigs) * 100}%` }} />
                  <span className="hl-day-fill trabajo" style={{ width: `${(s.cigTrabajo / maxCigs) * 100}%` }} />
                </span>
                <span className="hl-day-num">
                  🚬 {total}
                  <span className="muted" style={{ fontSize: 11 }}> ({s.cigPausa}/{s.cigTrabajo})</span>
                </span>
                <span className="hl-day-peso">{s.peso != null ? `⚖️ ${s.peso} kg` : ''}</span>
              </div>
            );
          })}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Barra: pitis del día (oscuro = en pausa, claro = trabajando). El peso muestra el último registro de cada día.
        </p>
      </section>
    </div>
  );
}
