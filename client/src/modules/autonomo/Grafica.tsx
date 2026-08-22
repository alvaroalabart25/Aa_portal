/**
 * Una gráfica de líneas, monocroma y sin adornos.
 *
 * El portal no tiene colores para distinguir series, así que se distinguen por
 * PESO: la serie principal va en tinta llena y la secundaria más fina y apagada.
 * Sin ejes ni rejilla —en un móvil son ruido—: solo el máximo, el mínimo y los
 * extremos del tiempo, que es lo que se lee de verdad de un vistazo.
 */

export interface Serie {
  nombre: string;
  puntos: number[];
  /** la secundaria se pinta más fina y apagada */
  secundaria?: boolean;
  /** a partir de qué punto la línea es previsión o reconstrucción */
  punteadaHasta?: number;
}

interface Props {
  series: Serie[];
  etiquetas: [string, string];
  alto?: number;
  /** formatea los números de los extremos */
  formato?: (n: number) => string;
}

const ANCHO = 320;

export default function Grafica({ series, etiquetas, alto = 120, formato = (n) => String(Math.round(n)) }: Props) {
  const todos = series.flatMap((s) => s.puntos);
  if (todos.length === 0) return null;

  const max = Math.max(...todos, 0);
  const min = Math.min(...todos, 0);
  const rango = max - min || 1;
  const n = Math.max(...series.map((s) => s.puntos.length));

  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * ANCHO);
  const y = (v: number) => alto - ((v - min) / rango) * alto;

  const linea = (puntos: number[]) => puntos.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  // el cero solo se dibuja si la gráfica lo cruza: si no, es una raya de adorno
  const cero = min < 0 && max > 0 ? y(0) : null;

  return (
    <div className="gf">
      <svg viewBox={`0 0 ${ANCHO} ${alto}`} preserveAspectRatio="none" className="gf-svg" role="img">
        {cero !== null && <line x1="0" y1={cero} x2={ANCHO} y2={cero} className="gf-cero" />}
        {series.map((s) => (
          <polyline
            key={s.nombre}
            points={linea(s.puntos)}
            className={`gf-linea${s.secundaria ? ' secundaria' : ''}`}
          />
        ))}
      </svg>
      <div className="gf-pies">
        <span>{etiquetas[0]}</span>
        <span>{etiquetas[1]}</span>
      </div>
      <div className="gf-leyenda">
        {series.map((s) => (
          <span key={s.nombre} className={s.secundaria ? 'secundaria' : ''}>
            <i /> {s.nombre}
          </span>
        ))}
        <span className="gf-rango">
          {formato(min)} – {formato(max)}
        </span>
      </div>
    </div>
  );
}
