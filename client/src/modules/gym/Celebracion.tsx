import { useMemo, useState } from 'react';
import { gymApi } from './api';

const EMOJIS = ['🎉', '💪', '🔥', '🏋️', '🥇', '⚡', '🙌', '✨', '🎊', '💥'];

/** Del 1 al 5. Los extremos son suyos: «sin fuerza» y «voy sobrado». */
const ENERGIA = [
  { v: 1, emoji: '🪫', label: 'Sin fuerza' },
  { v: 2, emoji: '😮‍💨', label: 'Justo' },
  { v: 3, emoji: '🙂', label: 'Normal' },
  { v: 4, emoji: '💪', label: 'Fuerte' },
  { v: 5, emoji: '🚀', label: 'Voy sobrado' },
];

const ANIMO = [
  { v: 1, emoji: '😖', label: 'Mal' },
  { v: 2, emoji: '😕', label: 'Regular' },
  { v: 3, emoji: '😐', label: 'Ni fu ni fa' },
  { v: 4, emoji: '😄', label: 'Contento' },
  { v: 5, emoji: '🤩', label: 'Genial' },
];

/**
 * El final del entrenamiento: la fiesta y la encuesta.
 *
 * La encuesta va AQUÍ y no en una pantalla aparte porque es el único momento en
 * que uno se acuerda de cómo se ha visto. Media hora después ya no es un dato,
 * es un recuerdo. Y son dos ejes separados a propósito: acabar reventado y
 * contento es normal, y mezclarlo en un número borraría justo lo que interesa
 * cuando algo se repite semana tras semana.
 */
export default function Celebracion({
  sesionId,
  series,
  volumen,
  minutos,
  onHecho,
}: {
  sesionId: number;
  series: number;
  volumen: number | null;
  minutos: number | null;
  onHecho: () => void;
}) {
  const [energy, setEnergy] = useState<number | null>(null);
  const [feeling, setFeeling] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Las posiciones se calculan una vez: si se recalcularan en cada render, los
  // emojis darían un salto cada vez que se toca un botón.
  const confeti = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) => ({
        emoji: EMOJIS[i % EMOJIS.length],
        left: Math.round(Math.random() * 96),
        delay: Math.round(Math.random() * 2600),
        dur: 3200 + Math.round(Math.random() * 2600),
        size: 18 + Math.round(Math.random() * 18),
        giro: Math.round(Math.random() * 720) - 360,
      })),
    [],
  );

  async function guardar(conEncuesta: boolean) {
    setGuardando(true);
    try {
      await gymApi.cerrar(
        sesionId,
        conEncuesta
          ? { notes: notes.trim() || null, energy: energy ?? undefined, feeling: feeling ?? undefined }
          : {},
      );
      onHecho();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fiesta">
      <div className="fiesta-confeti" aria-hidden="true">
        {confeti.map((c, i) => (
          <span
            key={i}
            style={{
              left: `${c.left}%`,
              animationDelay: `${c.delay}ms`,
              animationDuration: `${c.dur}ms`,
              fontSize: c.size,
              ['--giro' as string]: `${c.giro}deg`,
            }}
          >
            {c.emoji}
          </span>
        ))}
      </div>

      <div className="fiesta-centro">
        <h1 className="fiesta-t">Entrenamiento completado</h1>
        <p className="fiesta-s">Ya te puedes ir a casa, soldado.</p>
        <p className="fiesta-n">
          {series} {series === 1 ? 'serie' : 'series'}
          {volumen ? ` · ${Math.round(volumen).toLocaleString('es-ES')} kg movidos` : ''}
          {minutos ? ` · ${minutos} min` : ''}
        </p>

        <div className="fiesta-encuesta">
          <span className="fiesta-p">¿Con cuánta energía te has visto?</span>
          <div className="fiesta-ops">
            {ENERGIA.map((o) => (
              <button
                key={o.v}
                className={`fiesta-op${energy === o.v ? ' puesto' : ''}`}
                onClick={() => setEnergy(energy === o.v ? null : o.v)}
                title={o.label}
              >
                <span>{o.emoji}</span>
                {o.label}
              </button>
            ))}
          </div>

          <span className="fiesta-p">¿Y de ánimo?</span>
          <div className="fiesta-ops">
            {ANIMO.map((o) => (
              <button
                key={o.v}
                className={`fiesta-op${feeling === o.v ? ' puesto' : ''}`}
                onClick={() => setFeeling(feeling === o.v ? null : o.v)}
                title={o.label}
              >
                <span>{o.emoji}</span>
                {o.label}
              </button>
            ))}
          </div>

          <textarea
            className="fiesta-notas"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Algo que apuntar: dormí mal, el hombro molestó, la barra se me fue…"
          />
        </div>

        <button className="foco-btn grande" disabled={guardando} onClick={() => guardar(true)}>
          {guardando ? 'Guardando…' : 'Guardar y salir'}
        </button>
        <button className="fiesta-saltar" disabled={guardando} onClick={() => guardar(false)}>
          Salir sin contestar
        </button>
      </div>
    </div>
  );
}
