import { useEffect, useMemo, useState } from 'react';
import { gymApi, type MetaGym, type Rutina, type SesionHistorial } from './api';
import { GraficaPeso } from './Pesaje';
import { Cobertura } from './GimnasioPage';

/**
 * Analíticas: cómo van tus entrenamientos de verdad.
 *
 * Todo lo de aquí sale de sesiones YA CERRADAS, no del plan: la pestaña
 * Objetivo dice a dónde vas y esta dice qué está pasando. Cada gráfica avisa
 * cuando no tiene datos suficientes en vez de dibujar una línea de dos puntos
 * y hacerla pasar por una tendencia.
 */

// Su regla, la de siempre: tres entrenamientos por semana
const OBJETIVO_SEMANAL = 3;
// Con menos de esto, una gráfica temporal no dice nada todavía
const MINIMO_PARA_LINEA = 3;

/** Lunes de la semana de una fecha, en ISO. Las semanas empiezan en lunes. */
function lunesDe(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const dia = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dia);
  return d.toISOString().slice(0, 10);
}

const diaMes = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

export default function Analiticas({ rutina }: { rutina: Rutina | null }) {
  const [historial, setHistorial] = useState<SesionHistorial[] | null>(null);
  // las metas solo hacen falta para pintar la raya del objetivo de peso
  const [metas, setMetas] = useState<MetaGym[]>([]);

  useEffect(() => {
    gymApi.historial(60).then(setHistorial).catch(() => setHistorial([]));
    gymApi.objetivos().then(setMetas).catch(() => {});
  }, []);

  // Solo lo terminado y con algo apuntado: una sesión abierta o vacía no es un
  // entrenamiento, y colarla movería todas las medias.
  const sesiones = useMemo(
    () =>
      (historial ?? [])
        .filter((s) => s.endedAt && s.sets > 0)
        .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate)),
    [historial],
  );

  if (historial == null) return <p className="muted">Cargando…</p>;

  return (
    <div>
      <GraficaPeso metas={metas} />
      <Constancia sesiones={sesiones} />
      <VolumenPorDia sesiones={sesiones} />
      <ComoTeVes sesiones={sesiones} />

      {/* Al final de la pantalla y sin plegar: es el bloque más largo y el que
          se lee con calma, no de pasada. */}
      {rutina && <Cobertura rutina={rutina} />}

      {sesiones.length === 0 && (
        <section className="section mc-bloque">
          <p className="muted mc-vacio">
            Todavía no hay entrenamientos terminados que analizar. En cuanto cierres alguno, esto se llena solo.
          </p>
        </section>
      )}
    </div>
  );
}

/**
 * Cuántos entrenamientos por semana, frente a los tres que te pides.
 *
 * Se cuenta por semanas de lunes a domingo aunque los días de rutina no sean
 * fijos: el objetivo es semanal y así se puede comparar una semana con otra.
 */
function Constancia({ sesiones }: { sesiones: SesionHistorial[] }) {
  const semanas = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sesiones) {
      const l = lunesDe(s.sessionDate);
      m.set(l, (m.get(l) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8);
  }, [sesiones]);

  if (semanas.length === 0) return null;
  const cumplidas = semanas.filter(([, n]) => n >= OBJETIVO_SEMANAL).length;

  return (
    <section className="section mc-bloque oscuro">
      <h2>Constancia</h2>
      <p className="an-sub">
        {cumplidas} de {semanas.length} {semanas.length === 1 ? 'semana' : 'semanas'} con tus {OBJETIVO_SEMANAL}{' '}
        entrenamientos
      </p>
      <div className="an-barras">
        {semanas.map(([lunes, n]) => (
          <div key={lunes} className="an-barra">
            <span className="an-barra-caja">
              {/* la altura es sobre el objetivo, y lo que pase de ahí se marca:
                  una semana de cuatro no debe verse igual que una de tres */}
              <span
                className={`an-barra-fill${n >= OBJETIVO_SEMANAL ? ' ok' : ''}`}
                style={{ height: `${Math.min(100, (n / OBJETIVO_SEMANAL) * 100)}%` }}
              />
            </span>
            <span className="an-barra-n">{n}</span>
            <span className="an-barra-et">{diaMes(lunes)}</span>
          </div>
        ))}
      </div>
      <p className="muted an-nota">Semanas de lunes a domingo. La raya es tu objetivo de {OBJETIVO_SEMANAL}.</p>
    </section>
  );
}

/**
 * Kilos movidos, comparando cada día de rutina CONSIGO MISMO.
 *
 * Una línea con todas las sesiones seguidas no mide progreso, mide qué día
 * tocaba: tu día de pecho mueve ~6.400 kg y el de brazos ~4.700, así que
 * subiría y bajaría en zigzag sin que tú cambies nada. Comparado por día sí
 * responde a la pregunta: ¿estoy moviendo más que la vez anterior?
 */
function VolumenPorDia({ sesiones }: { sesiones: SesionHistorial[] }) {
  const porDia = useMemo(() => {
    const m = new Map<number, { nombre: string; puntos: { fecha: string; vol: number }[] }>();
    for (const s of sesiones) {
      const vol = s.volume == null ? null : Math.round(Number(s.volume));
      if (!vol) continue;
      const e = m.get(s.dayId) ?? { nombre: s.dayName, puntos: [] };
      e.puntos.push({ fecha: s.sessionDate, vol });
      m.set(s.dayId, e);
    }
    // Se enseñan TODOS los días con al menos una sesión medida. Antes se
    // escondían los que solo tenían una —no hay nada que comparar— y el día
    // desaparecía de la lista sin decir por qué, que es peor que decirlo.
    return [...m.values()].filter((d) => d.puntos.length >= 1).sort((a, b) => b.puntos.length - a.puntos.length);
  }, [sesiones]);

  if (porDia.length === 0) {
    return (
      <section className="section mc-bloque">
        <h2>Kilos movidos</h2>
        <p className="muted mc-vacio">
          Todavía no hay ninguna sesión con kilos apuntados. En cuanto cierres una con pesos, aparece aquí.
        </p>
      </section>
    );
  }

  return (
    <section className="section mc-bloque">
      <h2>Kilos movidos</h2>
      <p className="an-sub">Cada día de rutina comparado consigo mismo, que es la única comparación que dice algo.</p>
      <div className="an-dias">
        {porDia.map((d) => {
          const ultimo = d.puntos.at(-1)!;
          const previo = d.puntos.length > 1 ? d.puntos.at(-2)! : null;
          const dif = previo ? ultimo.vol - previo.vol : null;
          const max = Math.max(...d.puntos.map((p) => p.vol));
          return (
            <div key={d.nombre} className="an-dia">
              <div className="an-dia-head">
                <span className="an-dia-n">{d.nombre}</span>
                <span className={`an-dia-dif${dif != null && dif > 0 ? ' sube' : dif != null && dif < 0 ? ' baja' : ''}`}>
                  {dif == null
                    ? 'una sola vez'
                    : dif === 0
                      ? 'igual'
                      : `${dif > 0 ? '+' : '−'}${Math.abs(dif).toLocaleString('es-ES')} kg`}
                </span>
              </div>
              <div className="an-mini">
                {d.puntos.map((p) => (
                  <span key={p.fecha} className="an-mini-b" title={`${diaMes(p.fecha)}: ${p.vol} kg`}>
                    <span style={{ height: `${Math.max(6, (p.vol / max) * 100)}%` }} />
                  </span>
                ))}
              </div>
              <span className="an-dia-pie">
                {d.puntos.map((p) => diaMes(p.fecha)).join(' · ')} —{' '}
                {dif == null
                  ? `${ultimo.vol.toLocaleString('es-ES')} kg, aún sin con qué comparar`
                  : `último ${ultimo.vol.toLocaleString('es-ES')} kg`}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Energía y ánimo con los que sales de entrenar (la encuesta del final). */
function ComoTeVes({ sesiones }: { sesiones: SesionHistorial[] }) {
  const conNota = sesiones.filter((s) => s.energy != null || s.feeling != null);
  if (conNota.length < MINIMO_PARA_LINEA) return null;

  return (
    <section className="section mc-bloque oscuro">
      <h2>Cómo sales de entrenar</h2>
      <p className="an-sub">Lo que contestas al terminar, del 1 al 5.</p>
      <div className="an-notas">
        {conNota.slice(-8).map((s) => (
          <div key={s.id} className="an-nota-fila">
            <span className="an-nota-f">{diaMes(s.sessionDate)}</span>
            <span className="an-nota-p">
              <b>Energía</b> {s.energy ?? '—'}
            </span>
            <span className="an-nota-p">
              <b>Ánimo</b> {s.feeling ?? '—'}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
