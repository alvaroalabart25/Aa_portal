import { useState } from 'react';

/**
 * Una gráfica de líneas, monocroma y sin adornos.
 *
 * El portal no tiene colores para distinguir series, así que se distinguen por
 * PESO: la principal en tinta llena y la secundaria más fina y apagada. Sin
 * ejes ni rejilla —en un móvil son ruido—: solo los extremos.
 *
 * Y un detalle que la hace útil de verdad: al pasar el dedo o el ratón dice
 * cuánto vale ese punto. Una línea sin números contesta «sube», pero la
 * pregunta siempre es «¿cuánto?».
 *
 * El punto y la etiqueta se pintan en HTML y no dentro del SVG: el dibujo se
 * estira en horizontal (`preserveAspectRatio="none"`) y cualquier círculo
 * saldría deformado.
 */

export interface Serie {
  nombre: string;
  puntos: number[];
  /** la secundaria se pinta más fina y apagada */
  secundaria?: boolean;
}

interface Props {
  series: Serie[];
  etiquetas: [string, string];
  /** la fecha de cada punto, para poder decirla al señalar */
  fechas?: string[];
  alto?: number;
  formato?: (n: number) => string;
}

const ANCHO = 320;

const dia = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

export default function Grafica({ series, etiquetas, fechas, alto = 120, formato = (n) => String(Math.round(n)) }: Props) {
  const [señalado, setSeñalado] = useState<number | null>(null);
  const todos = series.flatMap((s) => s.puntos);
  if (todos.length === 0) return null;

  const max = Math.max(...todos, 0);
  const min = Math.min(...todos, 0);
  const rango = max - min || 1;
  const n = Math.max(...series.map((s) => s.puntos.length));

  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * ANCHO);
  const y = (v: number) => alto - ((v - min) / rango) * alto;
  const linea = (puntos: number[]) => puntos.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const cero = min < 0 && max > 0 ? y(0) : null;

  // el índice bajo el dedo, en porcentaje del ancho real (el SVG se estira)
  const alSeñalar = (e: React.PointerEvent<HTMLDivElement>) => {
    const caja = e.currentTarget.getBoundingClientRect();
    if (caja.width === 0 || n <= 1) return;
    const proporcion = (e.clientX - caja.left) / caja.width;
    setSeñalado(Math.max(0, Math.min(n - 1, Math.round(proporcion * (n - 1)))));
  };

  const izquierda = señalado === null ? 0 : (señalado / Math.max(1, n - 1)) * 100;

  return (
    <div className="gf">
      <div
        className="gf-lienzo"
        onPointerMove={alSeñalar}
        onPointerDown={alSeñalar}
        onPointerLeave={() => setSeñalado(null)}
      >
        <svg viewBox={`0 0 ${ANCHO} ${alto}`} preserveAspectRatio="none" className="gf-svg" role="img">
          {cero !== null && <line x1="0" y1={cero} x2={ANCHO} y2={cero} className="gf-cero" />}
          {series.map((s) => (
            <polyline key={s.nombre} points={linea(s.puntos)} className={`gf-linea${s.secundaria ? ' secundaria' : ''}`} />
          ))}
        </svg>

        {señalado !== null && (
          <>
            <div className="gf-guia" style={{ left: `${izquierda}%` }} />
            {series.map((s) => {
              const v = s.puntos[señalado];
              if (v === undefined) return null;
              return (
                <div
                  key={s.nombre}
                  className={`gf-punto${s.secundaria ? ' secundaria' : ''}`}
                  style={{ left: `${izquierda}%`, top: `${(y(v) / alto) * 100}%` }}
                />
              );
            })}
            <div
              className="gf-tip"
              style={{ left: `${izquierda}%`, transform: `translateX(${izquierda > 65 ? '-100%' : izquierda < 12 ? '0' : '-50%'})` }}
            >
              {fechas?.[señalado] && <em>{dia(fechas[señalado])}</em>}
              {series.map((s) => (
                <span key={s.nombre}>
                  {series.length > 1 && `${s.nombre} `}
                  <b>{formato(s.puntos[señalado] ?? 0)}</b>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

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
