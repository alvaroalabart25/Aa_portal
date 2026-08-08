import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  gymApi,
  listaMusculos,
  nombreMusculo,
  numTxt,
  type Condicionante,
  type EjercicioEnSesion,
} from './api';

const DESCANSO_POR_DEFECTO = 90;

/**
 * Modo foco: la pantalla entera en negro, sin menú y con UNA cosa delante.
 *
 * En el gimnasio no se navega: se levanta, se apunta y se descansa. Todo lo que
 * no sea la serie que toca sobra, así que aquí no hay lista, ni pestañas, ni
 * barra de abajo. Al marcar una serie arranca solo el descanso, porque mirar el
 * reloj es la parte que siempre se olvida.
 */
export default function ModoFoco({
  ejercicios,
  sesionId,
  condiciones,
  onCambio,
  onSalir,
}: {
  ejercicios: EjercicioEnSesion[];
  sesionId: number;
  condiciones: Condicionante[];
  onCambio: () => Promise<void> | void;
  onSalir: () => void;
}) {
  // Se entra por donde se quedó: el primer hueco sin marcar
  const primerHueco = useMemo(() => {
    for (let i = 0; i < ejercicios.length; i += 1) {
      const e = ejercicios[i];
      for (let n = 1; n <= e.targetSets; n += 1) {
        if (!e.done.some((d) => d.setNumber === n)) return { ei: i, serie: n };
      }
    }
    return { ei: Math.max(0, ejercicios.length - 1), serie: 1 };
  }, [ejercicios]);

  const [ei, setEi] = useState(primerHueco.ei);
  const [serie, setSerie] = useState(primerHueco.serie);
  const [descanso, setDescanso] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);

  const ejercicio = ejercicios[ei];
  const porTiempo = ejercicio?.kind === 'tiempo';
  const antes = ejercicio?.previous.sets.find((s) => s.setNumber === serie);
  const hecha = ejercicio?.done.find((d) => d.setNumber === serie);

  const [peso, setPeso] = useState('');
  const [medida, setMedida] = useState('');
  const [fijando, setFijando] = useState(false);

  // Al cambiar de serie, los campos ya vienen puestos. Por orden: lo que ya
  // marcaste en esta serie, lo de la misma serie la vez anterior, lo que
  // acabas de hacer en la serie de antes HOY, y por último el objetivo. La
  // tercera es la que salva el primer día: sin histórico, lo que hiciste hace
  // dos minutos es la mejor pista que hay.
  useEffect(() => {
    if (!ejercicio) return;
    const previaHoy = ejercicio.done.find((d) => d.setNumber === serie - 1);
    setPeso(numTxt(hecha?.weight ?? antes?.weight ?? previaHoy?.weight ?? ejercicio.targetWeight));
    const v = porTiempo
      ? (hecha?.seconds ?? antes?.seconds ?? previaHoy?.seconds)
      : (hecha?.reps ?? antes?.reps ?? previaHoy?.reps);
    setMedida(v == null ? '' : String(v));
  }, [ei, serie, ejercicio, hecha, antes, porTiempo]);

  // El descanso corre contra el reloj, no contando ticks: si la pantalla se
  // apaga o el móvil se duerme, al volver el número sigue siendo el bueno.
  const finRef = useRef<number>(0);
  useEffect(() => {
    if (descanso == null) return;
    const t = window.setInterval(() => {
      const quedan = Math.max(0, Math.round((finRef.current - Date.now()) / 1000));
      setDescanso(quedan);
      if (quedan === 0) {
        window.clearInterval(t);
        if ('vibrate' in navigator) navigator.vibrate?.([120, 60, 120]);
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [descanso != null]); // eslint-disable-line react-hooks/exhaustive-deps

  const avanzar = useCallback(() => {
    if (!ejercicio) return;
    if (serie < ejercicio.targetSets) setSerie(serie + 1);
    else if (ei < ejercicios.length - 1) {
      setEi(ei + 1);
      setSerie(1);
    }
  }, [ejercicio, serie, ei, ejercicios.length]);

  async function marcar() {
    if (!ejercicio) return;
    setGuardando(true);
    try {
      const v = medida.trim() === '' ? null : Number(medida.replace(',', '.'));
      await gymApi.marcarSerie(sesionId, {
        exerciseId: ejercicio.id,
        setNumber: serie,
        reps: porTiempo ? null : v,
        seconds: porTiempo ? v : null,
        weight: peso.trim() === '' ? null : Number(peso.replace(',', '.')),
      });
      await onCambio();
      const segundos = ejercicio.restSeconds || DESCANSO_POR_DEFECTO;
      finRef.current = Date.now() + segundos * 1000;
      setDescanso(segundos);
    } finally {
      setGuardando(false);
    }
  }

  if (!ejercicio) return null;

  const esUltimaSerie = serie === ejercicio.targetSets;
  const esUltimoEjercicio = ei === ejercicios.length - 1;
  const hechasTotal = ejercicios.reduce((n, e) => n + e.done.length, 0);
  const totalSeries = ejercicios.reduce((n, e) => n + e.targetSets, 0);
  const aviso = condiciones.find((c) =>
    listaMusculos(c.muscles).some((m) => listaMusculos(ejercicio.muscles).includes(m)),
  );

  return (
    <div className="foco">
      <div className="foco-top">
        <button className="foco-x" onClick={onSalir} aria-label="Salir del modo foco">
          ✕
        </button>
        <span className="foco-cuenta">
          {hechasTotal}/{totalSeries}
        </span>
      </div>

      {descanso != null ? (
        <div className="foco-centro" key="descanso">
          <span className="foco-et">Descanso</span>
          <span className="foco-reloj">{`${Math.floor(descanso / 60)}:${String(descanso % 60).padStart(2, '0')}`}</span>
          <p className="foco-msg">{mensajeDescanso(descanso, esUltimaSerie, esUltimoEjercicio, ejercicio, serie)}</p>
          <button
            className="foco-btn"
            onClick={() => {
              setDescanso(null);
              avanzar();
            }}
          >
            {descanso === 0 ? 'A por la siguiente' : 'Saltar el descanso'}
          </button>
        </div>
      ) : (
        // la clave cambia con cada serie: así cada pantalla entra sola, en vez
        // de que los números cambien de golpe debajo del dedo
        <div className="foco-centro" key={`${ejercicio.id}-${serie}`}>
          {listaMusculos(ejercicio.muscles).length > 0 && (
            <span className="foco-et">{listaMusculos(ejercicio.muscles).map(nombreMusculo).join(' · ')}</span>
          )}
          <h1 className="foco-ej">{ejercicio.name}</h1>
          <span className="foco-serie">
            Serie {serie} de {ejercicio.targetSets}
            {esUltimaSerie && ' · la última'}
          </span>

          <div className="foco-campos">
            <label>
              <span>kg</span>
              <input inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} />
            </label>
            <label>
              <span>{porTiempo ? 'seg' : 'repes'}</span>
              <input inputMode="numeric" value={medida} onChange={(e) => setMedida(e.target.value)} />
            </label>
          </div>

          <p className="foco-antes">
            {antes
              ? `La última vez: ${antes.weight ? `${numTxt(antes.weight)} × ` : ''}${porTiempo ? `${antes.seconds}s` : antes.reps}`
              : `Objetivo: ${ejercicio.targetSets} × ${ejercicio.targetReps}`}
          </p>

          {/* El kg de arriba es lo que levantas HOY y se guarda al marcar la
              serie. El objetivo del ejercicio es otra cosa y hasta ahora solo se
              podía tocar en Rutina: si el número que traía era una barbaridad,
              volvía a salir cada día. Desde aquí se corrige de un toque. */}
          {peso.trim() !== '' && numTxt(ejercicio.targetWeight) !== peso.trim() && (
            <button
              className="foco-fijar"
              disabled={fijando}
              onClick={async () => {
                setFijando(true);
                try {
                  await gymApi.editarEjercicio(ejercicio.id, { targetWeight: Number(peso.replace(',', '.')) });
                  await onCambio();
                } finally {
                  setFijando(false);
                }
              }}
            >
              {fijando ? 'Guardando…' : `Dejar ${peso} kg como objetivo del ejercicio`}
            </button>
          )}

          <button className="foco-btn grande" disabled={guardando} onClick={marcar}>
            {guardando ? 'Guardando…' : hecha ? 'Rehacer esta serie' : 'Serie hecha'}
          </button>

          <p className="foco-msg">{mensajeSerie(serie, ejercicio, esUltimoEjercicio, antes, medida)}</p>
          {aviso && (
            <p className={`foco-aviso ${aviso.severity}`}>
              {aviso.severity === 'evitar' ? 'Evitar' : 'Ojo'}
              {aviso.side !== 'na' ? ` · ${aviso.side}` : ''}: {aviso.title}
              {aviso.advice ? ` — ${aviso.advice}` : ''}
            </p>
          )}
          {ejercicio.notes && <p className="foco-nota">{ejercicio.notes}</p>}
        </div>
      )}

      <div className="foco-pie">
        <button
          className="foco-mini"
          disabled={ei === 0 && serie === 1}
          onClick={() => {
            setDescanso(null);
            if (serie > 1) setSerie(serie - 1);
            else if (ei > 0) {
              setEi(ei - 1);
              setSerie(ejercicios[ei - 1].targetSets);
            }
          }}
        >
          ‹ Anterior
        </button>
        <span className="foco-pie-t">
          {ei + 1} de {ejercicios.length} ejercicios
        </span>
        <button
          className="foco-mini"
          disabled={esUltimoEjercicio && esUltimaSerie}
          onClick={() => {
            setDescanso(null);
            avanzar();
          }}
        >
          Saltar ›
        </button>
      </div>
    </div>
  );
}

/**
 * Notas de entrenador. Son frases fijas elegidas por el momento, no consejo
 * médico ni un plan: recuerdan lo que se olvida cuando llevas una hora dentro.
 */
function mensajeSerie(
  serie: number,
  ejercicio: EjercicioEnSesion,
  esUltimoEjercicio: boolean,
  antes: { weight: string | null; reps: number | null; seconds: number | null } | undefined,
  medida: string,
): string {
  if (serie === ejercicio.targetSets && esUltimoEjercicio) return 'Última serie del día. Déjalo todo aquí.';
  if (serie === ejercicio.targetSets) return 'Última de este ejercicio. Aquí es donde se gana.';
  if (serie === 1) return 'Primera serie: técnica antes que peso.';

  const anterior = antes?.reps ?? null;
  const ahora = medida.trim() === '' ? null : Number(medida);
  if (anterior != null && ahora != null && ahora > anterior) return `Vas por encima de la última vez. Sin romper la forma.`;
  if (serie === 2) return 'La segunda es la que marca el ritmo del resto.';
  return 'Controla la bajada: es donde está el trabajo de verdad.';
}

function mensajeDescanso(
  quedan: number,
  esUltimaSerie: boolean,
  esUltimoEjercicio: boolean,
  ejercicio: EjercicioEnSesion,
  serie: number,
): string {
  if (quedan === 0) {
    if (esUltimaSerie && esUltimoEjercicio) return 'Ya está. Solo queda cerrar el entrenamiento.';
    if (esUltimaSerie) return 'Siguiente ejercicio.';
    return `Toca la serie ${serie + 1} de ${ejercicio.targetSets}.`;
  }
  if (quedan > 60) return 'Respira por la nariz y suelta despacio.';
  if (quedan > 25) return 'Colócate y repasa el primer movimiento.';
  return 'Preparado.';
}
