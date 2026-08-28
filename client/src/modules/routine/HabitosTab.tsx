import { useCallback, useEffect, useState } from 'react';
import { checksApi, type DailyCheck } from '../health/api';

/**
 * Los microhábitos del día: beber agua, escribir, pasear.
 *
 * Sin planificar y sin horas. La pregunta no es «¿a qué hora toca?» sino «¿lo
 * he hecho hoy?», y por eso no hay plantilla semanal ni casillas por franja:
 * hay una lista corta y un gesto.
 *
 * Marcar tiene que dar gusto. No es un checkbox: el círculo se dibuja, la fila
 * se ilumina un momento, el móvil vibra si sabe, y la racha sube delante de ti.
 * Es lo único que sostiene un hábito los días en los que no apetece.
 */

const EMOJIS = ['💧', '✍️', '🚶', '📖', '🧘', '🥗', '☀️', '💊', '🦷', '🛏️', '📵', '🎧'];

/** Un golpecito corto en el móvil. Donde no exista, no pasa nada. */
function vibrar(patron: number | number[]) {
  try {
    navigator.vibrate?.(patron);
  } catch {
    /* el navegador puede no dejar: no es motivo para nada */
  }
}

export default function HabitosTab() {
  const [checks, setChecks] = useState<DailyCheck[]>([]);
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  // null = todos los días; un número = veces por semana
  const [veces, setVeces] = useState<number | null>(null);
  // El que se acaba de marcar: le dura la animación un momento
  const [celebrando, setCelebrando] = useState<number | null>(null);
  const [dia, setDia] = useState<'nada' | 'completo'>('nada');

  const cargar = useCallback(async () => {
    const r = await checksApi.list();
    setChecks(r.checks);
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Cuenta lo CUMPLIDO: un hábito de dos veces por semana con las dos hechas
  // no pide nada hoy, aunque hoy no lo hayas tocado.
  const hechos = checks.filter((c) => c.cumplido).length;
  const total = checks.length;

  async function marcar(c: DailyCheck) {
    if (c.kind === 'peso') return; // ese se cumple pesándose, no marcándolo
    const done = !c.done;
    // Se pinta antes de que conteste el servidor: el gesto tiene que ir a la
    // velocidad del dedo, no a la de la red.
    setChecks((l) =>
      l.map((x) =>
        x.id === c.id
          ? {
              ...x,
              done,
              racha: Math.max(0, x.racha + (done ? 1 : -1)),
              estaSemana: Math.max(0, x.estaSemana + (done ? 1 : -1)),
              cumplido: x.objetivoSemanal
                ? Math.max(0, x.estaSemana + (done ? 1 : -1)) >= x.objetivoSemanal
                : done,
              // el punto de hoy es el último: se pinta al momento, sin esperar
              // a que el servidor vuelva a contar
              semana: x.semana.map((d, i) => (i === x.semana.length - 1 ? { ...d, hecho: done } : d)),
            }
          : x,
      ),
    );
    if (done) {
      setCelebrando(c.id);
      vibrar(18);
      setTimeout(() => setCelebrando(null), 700);
      if (hechos + 1 === total && total > 0) {
        setDia('completo');
        vibrar([24, 60, 24]);
        setTimeout(() => setDia('nada'), 2200);
      }
    }
    await checksApi.toggle(c.id, done).catch(() => cargar());
  }

  async function crear() {
    const t = titulo.trim();
    if (!t) return;
    await checksApi.create(t, emoji, veces);
    setTitulo('');
    setVeces(null);
    setCreando(false);
    await cargar();
  }

  async function borrar(c: DailyCheck) {
    if (!confirm(`¿Quitar «${c.title}» de tus hábitos? Lo que ya marcaste se queda.`)) return;
    await checksApi.remove(c.id);
    await cargar();
  }

  if (cargando) return <p className="muted">Cargando…</p>;

  return (
    <div>
      <div className={`hb-cuenta${dia === 'completo' ? ' completo' : ''}`}>
        <b>
          {hechos} de {total}
        </b>
        <span>
          {total === 0
            ? 'Todavía no tienes hábitos. Empieza por uno.'
            : hechos === total
              ? '¡Día completo!'
              : 'hoy'}
        </span>
      </div>

      <div className="hb-lista">
        {checks.map((c) => (
          <button
            key={c.id}
            className={`hb${c.done ? ' hecho' : ''}${c.cumplido && !c.done ? ' cumplido' : ''}${
              celebrando === c.id ? ' celebra' : ''
            }${c.kind === 'peso' ? ' solo' : ''}`}
            onClick={() => marcar(c)}
          >
            <span className="hb-marca" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="17" height="17">
                <path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="hb-emoji" aria-hidden="true">
              {c.emoji}
            </span>
            <span className="hb-txt">
              <span className="hb-t">{c.title}</span>
              <span className="hb-sub">
                {c.kind === 'peso'
                  ? 'se marca solo al pesarte'
                  : c.objetivoSemanal
                    ? `${c.estaSemana} de ${c.objetivoSemanal} esta semana`
                    : c.racha > 0
                      ? `🔥 ${c.racha === 1 ? '1 día' : `${c.racha} días seguidos`}`
                      : 'sin racha todavía'}
              </span>
            </span>
            <span className="hb-semana" aria-hidden="true">
              {c.semana.map((d) => (
                <i key={d.dia} className={d.hecho ? 'si' : ''} />
              ))}
            </span>
          </button>
        ))}
      </div>

      {creando ? (
        <div className="hb-nuevo">
          <div className="hb-emojis">
            {EMOJIS.map((e) => (
              <button key={e} className={`hb-emoji-op${e === emoji ? ' puesto' : ''}`} onClick={() => setEmoji(e)}>
                {e}
              </button>
            ))}
          </div>
          {/* Cada cuánto. No es un horario: es cuántas veces por semana, los
              días que sean. */}
          <div className="hb-cada">
            <button className={veces === null ? 'puesto' : ''} onClick={() => setVeces(null)}>
              Todos los días
            </button>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={veces === n ? 'puesto' : ''} onClick={() => setVeces(n)}>
                {n}/semana
              </button>
            ))}
          </div>
          <div className="hb-nuevo-fila">
            <input
              autoFocus
              placeholder="Beber 2 litros de agua"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && crear()}
            />
            <button className="btn" onClick={crear} disabled={!titulo.trim()}>
              Añadir
            </button>
            <button className="btn ghost" onClick={() => setCreando(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button className="btn ghost sm hb-mas" onClick={() => setCreando(true)}>
          + Hábito
        </button>
      )}

      {checks.length > 0 && (
        <div className="hb-quitar">
          {checks.map((c) => (
            <button key={c.id} onClick={() => borrar(c)}>
              Quitar {c.emoji} {c.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
