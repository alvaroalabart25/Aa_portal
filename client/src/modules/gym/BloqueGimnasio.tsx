import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { gymApi, type SemanaGym } from './api';

const INICIALES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** Los siete días de la semana de esa fecha, empezando en lunes. */
function diasDeLaSemana(lunes: string): string[] {
  const d = new Date(`${lunes}T12:00:00`);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    return new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(x);
  });
}

/**
 * El gimnasio en la portada del mes: los días que has ido esta semana y qué
 * hacer hoy.
 *
 * La recomendación se arma AQUÍ, con los números a la vista, y siempre dice de
 * dónde sale: «llevas 3 días sin ir» es útil, «hoy toca gimnasio» a secas es un
 * oráculo. Y es una regla escrita a mano, no un entrenador: cuenta días y
 * compara kilos, nada más.
 */
export default function BloqueGimnasio() {
  const [datos, setDatos] = useState<SemanaGym | null>(null);

  useEffect(() => {
    gymApi.semana().then(setDatos).catch(() => {});
  }, []);

  if (!datos) return null;

  const dias = diasDeLaSemana(datos.weekStart);
  const idos = new Set(datos.week.map((s) => s.sessionDate));
  const hechos = idos.size;
  const faltan = Math.max(0, datos.target - hechos);
  const diasQueQuedan = dias.filter((d) => d > datos.today).length;

  return (
    <section className="section mc-bloque">
      <div className="mc-head">
        <h2>🏋️ Gimnasio</h2>
        <Link to="/gimnasio" className="btn ghost sm">
          Entrenar
        </Link>
      </div>

      <div className="gs-semana">
        {dias.map((d, i) => {
          const fue = idos.has(d);
          const esHoy = d === datos.today;
          const pasado = d < datos.today;
          return (
            <span key={d} className={`gs-dia${fue ? ' fue' : ''}${esHoy ? ' hoy' : ''}${pasado && !fue ? ' pasado' : ''}`}>
              <span className="gs-punto" />
              {INICIALES[i]}
            </span>
          );
        })}
        <span className="gs-cuenta">
          {hechos}/{datos.target}
        </span>
      </div>

      <p className="gs-msg">{recomendacion(datos, hechos, faltan, diasQueQuedan)}</p>
    </section>
  );
}

/**
 * La regla, en orden de prioridad. Cada rama dice el motivo, para poder no
 * estar de acuerdo con ella.
 */
function recomendacion(d: SemanaGym, hechos: number, faltan: number, quedan: number): string {
  const fueHoy = d.week.some((s) => s.sessionDate === d.today);
  const desde = d.last ? diasEntre(d.last.sessionDate, d.today) : null;

  if (fueHoy) {
    return faltan > 0
      ? `Hecho por hoy. Esta semana te ${faltan === 1 ? 'queda 1 día' : `quedan ${faltan} días`} y tienes ${quedan} para meterlos.`
      : 'Hecho por hoy, y la semana ya está cumplida. Lo que venga es de regalo.';
  }

  if (faltan === 0) return `Semana cumplida: ${hechos} de ${d.target}. Si vas, que sea porque te apetece.`;

  // Cargaste mucho ayer: el descanso también entrena
  if (desde === 1 && d.last && d.avgVolume && d.last.volume && d.last.volume > d.avgVolume * 1.25) {
    return `Ayer moviste ${d.last.volume.toLocaleString('es-ES')} kg, bastante más que tu media (${d.avgVolume.toLocaleString('es-ES')}). Hoy el descanso también entrena.`;
  }
  if (desde === 1 && d.last?.energy === 1) {
    return 'Ayer acabaste sin fuerza. Si hoy sigues igual, mejor mañana.';
  }
  if (desde === 1) return `Entrenaste ayer. Puedes ir, pero te ${faltan === 1 ? 'queda 1 día' : `quedan ${faltan}`} y ${quedan} para repartirlos.`;

  if (desde != null && desde >= 4) return `Llevas ${desde} días sin pisar el gimnasio. Hoy tocaría, aunque sea flojo.`;
  if (desde != null && desde >= 2) return `${desde} días de descanso. Buen momento para ir.`;

  if (faltan > quedan + 1) return `Te ${faltan === 1 ? 'queda 1 día' : `quedan ${faltan} días`} y solo ${quedan + 1} para hacerlos. O vas hoy, o la semana se queda corta.`;
  return `Esta semana te ${faltan === 1 ? 'queda 1 día' : `quedan ${faltan} días`}. Hoy es buen día.`;
}

function diasEntre(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000);
}
