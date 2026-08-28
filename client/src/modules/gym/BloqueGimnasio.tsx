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
export default function BloqueGimnasio({ desnudo = false }: { desnudo?: boolean } = {}) {
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
  // El cuarto día es un premio, no un objetivo: solo existe cuando los tres
  // están hechos. Si esta semana no dan los días para llegar a tres, ni se
  // menciona: sería ofrecer un extra a quien no ha llegado a lo básico.
  const cuartoAbierto = hechos >= datos.target;

  // El mensaje ARRIBA y la semana debajo: así, dentro de Constancia, el texto
  // cae a la altura del nombre de la formación y los puntos a la de sus días.
  const cuerpo = (
    <div className="gs-caja claro">
      <p className="gs-msg">{recomendacion(datos, hechos, faltan, diasQueQuedan)}</p>

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
          {cuartoAbierto && <b className="gs-extra">+1</b>}
        </span>
      </div>

    </div>
  );

  // `desnudo` es para la portada del mes, donde el gimnasio va como una columna
  // más de Constancia y el título lo pone el bloque de fuera. Suelto —en el
  // resto del portal— sigue trayendo su propia cabecera.
  if (desnudo) return cuerpo;

  return (
    <section className="section mc-bloque">
      <div className="mc-head">
        <h2>🏋️ Gimnasio</h2>
        <Link to="/gimnasio" className="btn ghost sm">
          Entrenar
        </Link>
      </div>
      {cuerpo}
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

  // El cuarto día solo se ofrece con los tres hechos. Y si ya no caben tres
  // esta semana, no se nombra siquiera.
  const cuartoAbierto = hechos >= d.target;

  if (fueHoy) {
    if (faltan > 0) {
      return `Hecho por hoy. Esta semana te ${faltan === 1 ? 'queda 1 día' : `quedan ${faltan} días`} y tienes ${quedan} para meterlos.`;
    }
    return quedan > 0
      ? `Semana cumplida: ${hechos} de ${d.target}. El cuarto día queda abierto, pero es opcional.`
      : 'Semana cumplida y cerrada. Descansa, que también cuenta.';
  }

  if (cuartoAbierto) {
    return quedan > 0
      ? `Ya tienes los ${d.target} de la semana. El cuarto está desbloqueado: ve si te apetece, no si toca.`
      : `Semana cumplida: ${hechos} de ${d.target}. Mañana empieza otra.`;
  }

  // Días en los que TODAVÍA puedes ir, hoy incluido. Contar solo los que
  // vienen después dejaba mensajes como «y 0 para repartirlos» un domingo.
  const oportunidades = quedan + 1;
  const loQueFalta = faltan === 1 ? '1 día' : `${faltan} días`;
  const ultimoDia = oportunidades === 1;

  // Cargaste mucho ayer: el descanso también entrena
  if (desde === 1 && d.last && d.avgVolume && d.last.volume && d.last.volume > d.avgVolume * 1.25) {
    return `Ayer moviste ${d.last.volume.toLocaleString('es-ES')} kg, bastante más que tu media (${d.avgVolume.toLocaleString('es-ES')}). Hoy el descanso también entrena${ultimoDia ? ', aunque hoy cierra la semana' : ''}.`;
  }
  if (desde === 1 && d.last?.energy === 1) {
    return 'Ayer acabaste sin fuerza. Si hoy sigues igual, mejor mañana.';
  }
  if (desde === 1) {
    return ultimoDia
      ? `Entrenaste ayer y hoy cierra la semana: es hoy o te quedas en ${hechos} de ${d.target}.`
      : `Entrenaste ayer. Te ${loQueFalta === '1 día' ? 'queda 1 día' : `quedan ${loQueFalta}`} y ${oportunidades} para meterlos.`;
  }

  if (desde != null && desde >= 4) return `Llevas ${desde} días sin pisar el gimnasio. Hoy tocaría, aunque sea flojo.`;
  if (desde != null && desde >= 2) return `${desde} días de descanso. Buen momento para ir.`;

  if (faltan > oportunidades) {
    return `Te ${loQueFalta === '1 día' ? 'queda 1 día' : `quedan ${loQueFalta}`} y solo ${oportunidades} para hacerlos. Esta semana se queda corta; no pasa nada, la que viene empieza a cero.`;
  }
  if (ultimoDia) return `Último día de la semana y te ${loQueFalta === '1 día' ? 'queda 1' : `quedan ${loQueFalta}`}. Hoy o nada.`;
  return `Esta semana te ${loQueFalta === '1 día' ? 'queda 1 día' : `quedan ${loQueFalta}`}. Hoy es buen día.`;
}

function diasEntre(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000);
}
