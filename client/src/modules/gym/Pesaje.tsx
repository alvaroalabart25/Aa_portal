import { useCallback, useEffect, useState } from 'react';
import { healthApi } from '../health/api';
import { hace, kg, type MetaGym } from './api';

/**
 * Seguimiento del pesaje, midiendo contra la meta de peso activa.
 *
 * El dato NO es nuevo: cada pesada se guarda en el mismo sitio del que ya leen
 * el Diario y la meta de peso (health_entries). Esto es otra puerta al mismo
 * dato, no un segundo dato — apuntar aquí y en el Diario es exactamente igual.
 */

interface Pesada {
  date: string; // YYYY-MM-DD
  peso: number;
}

const DIAS_ATRAS = 120;

function iso(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fechaCorta(s: string) {
  const [, m, d] = s.split('-');
  return `${Number(d)}/${Number(m)}`;
}

/**
 * Las pesadas de los últimos meses. Vive en un hook porque ahora las piden dos
 * sitios: el apunte (en Objetivo) y la gráfica (en Analíticas).
 */
function usePesadas() {
  const [pesadas, setPesadas] = useState<Pesada[] | null>(null);

  const cargar = useCallback(async () => {
    const hasta = new Date();
    const desde = new Date();
    desde.setDate(desde.getDate() - DIAS_ATRAS);
    const dias = await healthApi.summary(iso(desde), iso(hasta));
    setPesadas(
      dias
        .filter((d) => d.peso != null)
        .map((d) => ({ date: d.date, peso: Number(d.peso) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    );
  }, []);

  useEffect(() => {
    cargar().catch(() => setPesadas([]));
  }, [cargar]);

  return { pesadas, cargar };
}

/** El objetivo de peso activo, si lo hay. */
function metaDePeso(metas: MetaGym[]): number | null {
  const meta = metas.find((m) => m.kind === 'peso' && m.status === 'activo') ?? null;
  return meta?.targetValue != null ? Number(meta.targetValue) : null;
}

/**
 * La gráfica del peso: se mudó a Analíticas, que es donde vive la evolución.
 * El apunte se quedó en Objetivo, que es donde él lo escribe cada mañana.
 */
export function GraficaPeso({ metas }: { metas: MetaGym[] }) {
  const { pesadas } = usePesadas();
  const objetivo = metaDePeso(metas);
  const ultimo = pesadas?.at(-1) ?? null;
  const distancia = ultimo != null && objetivo != null ? Math.round((ultimo.peso - objetivo) * 10) / 10 : null;

  return (
    <section className="section mc-bloque">
      <h2>Peso</h2>
      {pesadas == null ? (
        <p className="muted mc-vacio">Cargando…</p>
      ) : pesadas.length === 0 ? (
        <p className="muted mc-vacio">Sin pesajes todavía. Apúntalos en la pestaña Objetivo.</p>
      ) : (
        <>
          <div className="py-actual">
            <span className="py-kg">{kg(ultimo!.peso)}</span>
            <span className="py-sub">
              pesado {hace(ultimo!.date)}
              {objetivo != null &&
                (distancia === 0
                  ? ' · en tu objetivo'
                  : ` · a ${kg(Math.abs(distancia!))} del objetivo (${kg(objetivo)})`)}
            </span>
          </div>
          {pesadas.length >= 2 ? (
            <Grafica pesadas={pesadas} objetivo={objetivo} />
          ) : (
            <p className="muted mc-vacio">Con un solo pesaje no hay línea que dibujar todavía.</p>
          )}
        </>
      )}
    </section>
  );
}

export function Pesaje({ metas }: { metas: MetaGym[] }) {
  const objetivo = metaDePeso(metas);
  const meta = metas.find((m) => m.kind === 'peso' && m.status === 'activo') ?? null;

  const { pesadas, cargar } = usePesadas();
  const [valor, setValor] = useState('');
  const [busy, setBusy] = useState(false);

  async function apuntar() {
    const v = Number(valor.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0 || busy) return;
    setBusy(true);
    try {
      await healthApi.add('peso', { value: v });
      setValor('');
      await cargar();
    } finally {
      setBusy(false);
    }
  }

  const ultimo = pesadas?.at(-1) ?? null;
  const distancia = ultimo != null && objetivo != null ? Math.round((ultimo.peso - objetivo) * 10) / 10 : null;

  return (
    <section className="section mc-bloque">
      <h2>Pesaje</h2>

      {pesadas == null ? (
        <p className="muted mc-vacio">Cargando…</p>
      ) : (
        <>
          {ultimo ? (
            <div className="py-actual">
              <span className="py-kg">{kg(ultimo.peso)}</span>
              <span className="py-sub">
                pesado {hace(ultimo.date)}
                {objetivo != null &&
                  (distancia === 0
                    ? ' · en tu objetivo'
                    : ` · a ${kg(Math.abs(distancia!))} del objetivo (${kg(objetivo)})`)}
              </span>
            </div>
          ) : (
            <p className="muted mc-vacio">
              Sin pesajes en los últimos {DIAS_ATRAS} días. Apunta el primero aquí abajo y empieza la serie.
            </p>
          )}

          {meta == null && (
            <p className="muted py-aviso">
              No hay una meta de peso activa. Crea un objetivo del tipo «peso» en «A dónde voy» y el pesaje medirá
              contra ese número.
            </p>
          )}

          <div className="py-form">
            <input
              inputMode="decimal"
              placeholder="kg de hoy"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && apuntar()}
            />
            <button className="btn sm" disabled={busy || !valor.trim()} onClick={apuntar}>
              {busy ? 'Apuntando…' : 'Apuntar pesaje'}
            </button>
          </div>

          {pesadas.length > 0 && (
            <div className="py-lista">
              {pesadas
                .slice(-6)
                .reverse()
                .map((p, i, arr) => {
                  const anterior = arr[i + 1] ?? null;
                  const dif = anterior ? Math.round((p.peso - anterior.peso) * 10) / 10 : null;
                  return (
                    <div key={p.date} className="py-fila">
                      <span className="py-fila-f">{fechaCorta(p.date)}</span>
                      <span className="py-fila-v">{kg(p.peso)}</span>
                      {dif != null && dif !== 0 && (
                        <span className={`py-fila-d ${dif > 0 ? 'sube' : 'baja'}`}>
                          {dif > 0 ? '+' : '−'}
                          {kg(Math.abs(dif))}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          <p className="muted py-nota">
            Es el mismo dato que el peso del Diario: apuntarlo aquí o allí da igual, hay una sola serie de pesajes.
          </p>
        </>
      )}
    </section>
  );
}

/** Línea de pesadas de los últimos meses, con el objetivo como raya discontinua. */
function Grafica({ pesadas, objetivo }: { pesadas: Pesada[]; objetivo: number | null }) {
  const W = 320;
  const H = 88;
  const PAD = 8;

  const ts = pesadas.map((p) => new Date(`${p.date}T12:00:00`).getTime());
  const minT = Math.min(...ts);
  const maxT = Math.max(...ts);
  const vals = pesadas.map((p) => p.peso);
  let min = Math.min(...vals, ...(objetivo != null ? [objetivo] : []));
  let max = Math.max(...vals, ...(objetivo != null ? [objetivo] : []));
  if (max - min < 2) {
    min -= 1;
    max += 1;
  }

  const x = (t: number) => (maxT === minT ? W / 2 : PAD + ((t - minT) / (maxT - minT)) * (W - PAD * 2));
  const y = (v: number) => PAD + (1 - (v - min) / (max - min)) * (H - PAD * 2);

  const puntos = pesadas.map((p, i) => `${x(ts[i])},${y(p.peso)}`).join(' ');
  const ultimo = pesadas[pesadas.length - 1];

  return (
    <div className="py-graf-caja">
      <svg viewBox={`0 0 ${W} ${H}`} className="py-graf" role="img" aria-label="Evolución del peso">
        {objetivo != null && (
          <line x1={PAD} x2={W - PAD} y1={y(objetivo)} y2={y(objetivo)} className="py-graf-obj" />
        )}
        <polyline points={puntos} className="py-graf-linea" />
        <circle cx={x(ts[ts.length - 1])} cy={y(ultimo.peso)} r="3" className="py-graf-punto" />
      </svg>
      {objetivo != null && <p className="muted py-graf-pie">— tu peso · - - objetivo {kg(objetivo)}</p>}
    </div>
  );
}
