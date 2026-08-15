import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  descansoSugerido,
  gymApi,
  listaMusculos,
  nombreMusculo,
  numTxt,
  type Condicionante,
  type EjercicioEnSesion,
} from './api';

const DESCANSO_POR_DEFECTO = 90;
/** Con estas repeticiones o menos, el peso era demasiado. Regla suya. */
const REPES_DE_CASTIGO = 5;

type Fase = 'descanso' | 'lista' | 'enCurso' | 'apuntar';

/** «8-10» → 8, «13» → 13, «al fallo» → nada. El primer número que aparezca. */
function delObjetivo(txt: string | null | undefined): number | null {
  const m = String(txt ?? '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

const reloj = (s: number) => `${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(s) % 60).padStart(2, '0')}`;

/**
 * Modo foco: la pantalla entera en negro, sin menú y con UNA cosa delante.
 *
 * El ciclo es descanso → preparar → serie → apuntar, y no al revés, porque el
 * peso se decide DESCANSANDO, cuando sabes cómo estás. Además así el descanso
 * lo cierras tú al empezar la serie, y eso es lo que permite medirlo de verdad:
 * un descanso que acaba solo mide lo que yo propuse, no lo que tú necesitas.
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
  const [saltados, setSaltados] = useState<number[]>([]);
  const lista = useMemo(() => ejercicios.filter((e) => !saltados.includes(e.id)), [ejercicios, saltados]);

  // Se entra por donde se quedó: el primer hueco sin marcar
  const primerHueco = useMemo(() => {
    for (let i = 0; i < lista.length; i += 1) {
      const e = lista[i];
      for (let n = 1; n <= e.targetSets; n += 1) {
        if (!e.done.some((d) => d.setNumber === n)) return { ei: i, serie: n };
      }
    }
    return { ei: Math.max(0, lista.length - 1), serie: 1 };
  }, [lista]);

  const [ei, setEi] = useState(primerHueco.ei);
  const [serie, setSerie] = useState(primerHueco.serie);
  // La primera serie del día no tiene descanso previo que medir
  const [fase, setFase] = useState<Fase>('lista');
  const [guardando, setGuardando] = useState(false);
  const [castigo, setCastigo] = useState<{ peso: number; serie: number } | null>(null);
  // Añadir un ejercicio que no estaba, sin salir del modo foco: la máquina
  // libre se ve DESDE el banco, no desde la pantalla de la sesión.
  const [anadiendo, setAnadiendo] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [guardandoNuevo, setGuardandoNuevo] = useState(false);
  const [esCastigo, setEsCastigo] = useState(false);

  async function anadirNuevo() {
    if (!nombreNuevo.trim() || guardandoNuevo) return;
    setGuardandoNuevo(true);
    try {
      await gymApi.improvisar(sesionId, { name: nombreNuevo.trim() });
      // se añade al final de la lista: saltamos directos a él, que para eso
      // lo acabas de pedir
      await onCambio();
      setEi(lista.length);
      setSerie(1);
      setFase('lista');
      setNombreNuevo('');
      setAnadiendo(false);
    } finally {
      setGuardandoNuevo(false);
    }
  }

  const ejercicio = lista[ei];
  const porTiempo = ejercicio?.kind === 'tiempo';
  const antes = ejercicio?.previous.sets.find((s) => s.setNumber === serie);
  const hecha = ejercicio?.done.find((d) => d.setNumber === serie);

  const [peso, setPeso] = useState('');
  const [previstas, setPrevistas] = useState('');
  const [reales, setReales] = useState('');

  // Los relojes van contra la hora, no contando ticks: si se apaga la pantalla
  // o el móvil se duerme, al volver los números siguen siendo los buenos.
  const [sugerido, setSugerido] = useState(DESCANSO_POR_DEFECTO);
  const [transcurrido, setTranscurrido] = useState(0);
  const inicioRef = useRef<number>(Date.now());
  const [serieSegs, setSerieSegs] = useState(0);
  const ultimoRef = useRef<{ real: number; sugerido: number } | null>(null);

  useEffect(() => {
    if (fase !== 'descanso' && fase !== 'enCurso') return;
    const t = window.setInterval(() => {
      const s = Math.round((Date.now() - inicioRef.current) / 1000);
      if (fase === 'descanso') {
        setTranscurrido(s);
        if (s === sugerido && 'vibrate' in navigator) navigator.vibrate?.([120, 60, 120]);
      } else setSerieSegs(s);
    }, 250);
    return () => window.clearInterval(t);
  }, [fase, sugerido]);

  // Al cambiar de serie, lo previsto viene puesto: lo de la misma serie la vez
  // anterior, o lo que acabas de hacer hace dos minutos, o el objetivo.
  useEffect(() => {
    if (!ejercicio) return;
    const previaHoy = ejercicio.done.find((d) => d.setNumber === serie - 1);
    setPeso(numTxt(hecha?.weight ?? antes?.weight ?? previaHoy?.weight ?? ejercicio.targetWeight));
    const v =
      (porTiempo
        ? (hecha?.seconds ?? antes?.seconds ?? previaHoy?.seconds)
        : (hecha?.reps ?? antes?.reps ?? previaHoy?.reps)) ?? delObjetivo(ejercicio.targetReps);
    setPrevistas(v == null ? '' : String(v));
    setReales(v == null ? '' : String(v));
  }, [ei, serie, ejercicio, hecha, antes, porTiempo]);

  const avanzar = useCallback(
    (aDescanso: boolean) => {
      if (!ejercicio) return;
      if (serie < ejercicio.targetSets) setSerie(serie + 1);
      else if (ei < lista.length - 1) {
        setEi(ei + 1);
        setSerie(1);
      }
      setEsCastigo(false);
      if (aDescanso) {
        inicioRef.current = Date.now();
        setTranscurrido(0);
        setFase('descanso');
      } else setFase('lista');
    },
    [ejercicio, serie, ei, lista.length],
  );

  function empezarSerie() {
    if (fase === 'descanso') ultimoRef.current = { real: transcurrido, sugerido };
    inicioRef.current = Date.now();
    setSerieSegs(0);
    setFase('enCurso');
  }

  async function apuntar() {
    if (!ejercicio) return;
    setGuardando(true);
    try {
      const hechas = reales.trim() === '' ? null : Number(reales.replace(',', '.'));
      const plan = previstas.trim() === '' ? null : Number(previstas.replace(',', '.'));
      const kgNum = peso.trim() === '' ? null : Number(peso.replace(',', '.'));
      await gymApi.marcarSerie(sesionId, {
        exerciseId: ejercicio.id,
        setNumber: esCastigo ? ejercicio.targetSets + 1 : serie,
        reps: porTiempo ? null : hechas,
        plannedReps: porTiempo ? null : plan,
        seconds: porTiempo ? hechas : null,
        weight: kgNum,
        restBefore: ultimoRef.current?.real ?? null,
        duration: serieSegs || null,
        punishment: esCastigo,
      });
      await onCambio();

      // El próximo descanso se calcula con lo que acabas de descansar de verdad
      setSugerido(
        descansoSugerido({
          ultimoReal: ultimoRef.current?.real ?? null,
          ultimoSugerido: ultimoRef.current?.sugerido ?? null,
          media: ejercicio.restAvg,
          objetivo: ejercicio.restSeconds,
        }),
      );

      // ¿Se te fue el peso? Se propone, no se impone.
      const previoHoy = ejercicio.done.filter((d) => d.setNumber < serie).at(-1);
      if (!esCastigo && !porTiempo && hechas != null && hechas <= REPES_DE_CASTIGO) {
        const menos = previoHoy?.weight ? Number(previoHoy.weight) : kgNum ? Math.round(kgNum * 0.8 * 2) / 2 : null;
        if (menos) {
          setCastigo({ peso: menos, serie: serie });
          setGuardando(false);
          return;
        }
      }
      avanzar(true);
    } finally {
      setGuardando(false);
    }
  }

  function saltarEjercicio() {
    if (!ejercicio) return;
    setSaltados((p) => [...p, ejercicio.id]);
    setSerie(1);
    setFase('lista');
    setEi((i) => Math.min(i, Math.max(0, lista.length - 2)));
  }

  if (!ejercicio) {
    return (
      <div className="foco">
        <div className="foco-centro">
          <h1 className="foco-ej">No queda nada</h1>
          <button className="foco-btn" onClick={onSalir}>
            Salir y cerrar
          </button>
        </div>
      </div>
    );
  }

  const esUltimaSerie = serie === ejercicio.targetSets;
  const esUltimoEjercicio = ei === lista.length - 1;
  const hechasTotal = ejercicios.reduce((n, e) => n + e.done.length, 0);
  const totalSeries = lista.reduce((n, e) => n + e.targetSets, 0);
  const aviso = condiciones.find((c) =>
    listaMusculos(c.muscles).some((m) => listaMusculos(ejercicio.muscles).includes(m)),
  );
  const restante = sugerido - transcurrido;

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

      {castigo ? (
        <div className="foco-centro" key="castigo">
          <span className="foco-et">Se te fue el peso</span>
          <h1 className="foco-ej">¿Serie de castigo?</h1>
          <p className="foco-msg">
            Has hecho {reales} repeticiones. Una serie más con {numTxt(castigo.peso)} kg y la dejas bien cerrada.
          </p>
          <button
            className="foco-btn grande"
            onClick={() => {
              setPeso(numTxt(castigo.peso));
              setEsCastigo(true);
              setCastigo(null);
              inicioRef.current = Date.now();
              setTranscurrido(0);
              setFase('descanso');
            }}
          >
            Sí, serie de castigo
          </button>
          <button
            className="foco-fijar"
            onClick={() => {
              setCastigo(null);
              avanzar(true);
            }}
          >
            No, sigo
          </button>
        </div>
      ) : anadiendo ? (
        <div className="foco-centro" key="anadir">
          <span className="foco-et">Fuera del plan</span>
          <h1 className="foco-ej">¿Qué añades?</h1>
          <input
            className="foco-nombre"
            autoFocus
            value={nombreNuevo}
            onChange={(e) => setNombreNuevo(e.target.value)}
            placeholder="Nombre del ejercicio"
            onKeyDown={(e) => e.key === 'Enter' && anadirNuevo()}
          />
          <p className="foco-antes">No entra en tu rutina: al terminar te preguntará si se queda.</p>
          <button className="foco-btn grande" disabled={!nombreNuevo.trim() || guardandoNuevo} onClick={anadirNuevo}>
            {guardandoNuevo ? 'Añadiendo…' : 'Añadir y hacerlo ahora'}
          </button>
          <button className="foco-mini" onClick={() => { setAnadiendo(false); setNombreNuevo(''); }}>
            Cancelar
          </button>
        </div>
      ) : fase === 'descanso' ? (
        <div className="foco-centro" key={`descanso-${serie}`}>
          <span className="foco-et">Descanso{esCastigo ? ' · antes del castigo' : ''}</span>
          <span className={`foco-reloj${restante < 0 ? ' pasado' : ''}`}>{reloj(Math.max(0, restante))}</span>
          {/* pasado el propuesto, un segundo reloj hacia arriba: para ver
              cuánto de más estás descansando sin perder el primero */}
          {restante <= 0 && (
            <span className="foco-extra">
              +{reloj(-restante)} de más
            </span>
          )}
          <p className="foco-msg">
            {restante <= 0
              ? 'Descansa si estás fatigado: la siguiente la vas a dar todo.'
              : mensajeDescanso(restante, esUltimaSerie, esUltimoEjercicio, ejercicio, serie)}
          </p>

          {/* el peso y las repes se deciden AQUÍ, descansando, que es cuando
              sabes cómo estás */}
          <span className="foco-et">Para la siguiente</span>
          <div className="foco-campos">
            <label>
              <span>kg</span>
              <input inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} />
            </label>
            <label>
              <span>{porTiempo ? 'seg' : 'repes'}</span>
              <input inputMode="numeric" value={previstas} onChange={(e) => setPrevistas(e.target.value)} />
            </label>
          </div>

          <button className="foco-btn grande" onClick={empezarSerie}>
            Empezar la serie
          </button>
        </div>
      ) : fase === 'enCurso' ? (
        <div className="foco-centro" key={`curso-${serie}`}>
          <span className="foco-et">{ejercicio.name}</span>
          <h1 className="foco-ej">
            {peso ? `${peso} kg` : 'Sin peso'} × {previstas || '?'}
          </h1>
          <span className="foco-reloj chico">{reloj(serieSegs)}</span>
          <p className="foco-msg">{mensajeSerie(serie, ejercicio, esUltimoEjercicio, esCastigo)}</p>
          <button className="foco-btn grande" onClick={() => setFase('apuntar')}>
            Serie hecha
          </button>
        </div>
      ) : fase === 'apuntar' ? (
        <div className="foco-centro" key={`apuntar-${serie}`}>
          <span className="foco-et">{ejercicio.name}</span>
          <h1 className="foco-ej">¿Cuántas te han salido?</h1>
          <div className="foco-campos">
            <label>
              <span>kg</span>
              <input inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} />
            </label>
            <label>
              <span>{porTiempo ? 'seg' : 'repes'}</span>
              <input inputMode="numeric" value={reales} onChange={(e) => setReales(e.target.value)} />
            </label>
          </div>
          <p className="foco-antes">
            Ibas a por {previstas || '?'}
            {serieSegs ? ` · ${reloj(serieSegs)} de serie` : ''}
          </p>
          <button className="foco-btn grande" disabled={guardando} onClick={apuntar}>
            {guardando ? 'Guardando…' : 'Guardar y descansar'}
          </button>
        </div>
      ) : (
        <div className="foco-centro" key={`lista-${ejercicio.id}-${serie}`}>
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
              <input inputMode="numeric" value={previstas} onChange={(e) => setPrevistas(e.target.value)} />
            </label>
          </div>

          <p className="foco-antes">
            {antes
              ? `La última vez: ${antes.weight ? `${numTxt(antes.weight)} × ` : ''}${porTiempo ? `${antes.seconds}s` : antes.reps}`
              : `Objetivo: ${ejercicio.targetSets} × ${ejercicio.targetReps}`}
          </p>

          <button className="foco-btn grande" onClick={empezarSerie}>
            Empezar la serie
          </button>

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

      {!anadiendo && (
        <button className="foco-anadir" onClick={() => setAnadiendo(true)}>
          + Añadir un ejercicio que no estaba
        </button>
      )}

      <div className="foco-pie">
        <button className="foco-mini" onClick={saltarEjercicio} disabled={lista.length <= 1}>
          Saltar ejercicio
        </button>
        <span className="foco-pie-t">
          {ei + 1} de {lista.length}
        </span>
        <button className="foco-mini" disabled={esUltimoEjercicio && esUltimaSerie} onClick={() => avanzar(false)}>
          Saltar serie ›
        </button>
      </div>
    </div>
  );
}

/**
 * Notas de entrenador. Frases fijas elegidas por el momento, no consejo médico
 * ni un plan: recuerdan lo que se olvida cuando llevas una hora dentro.
 */
function mensajeSerie(serie: number, ejercicio: EjercicioEnSesion, esUltimoEjercicio: boolean, esCastigo: boolean): string {
  if (esCastigo) return 'Esta va limpia: peso que controlas y técnica perfecta.';
  if (serie === ejercicio.targetSets && esUltimoEjercicio) return 'Última serie del día. Déjalo todo aquí.';
  if (serie === ejercicio.targetSets) return 'Última de este ejercicio. Aquí es donde se gana.';
  if (serie === 1) return 'Técnica antes que peso.';
  return 'Controla la bajada: es donde está el trabajo de verdad.';
}

function mensajeDescanso(
  quedan: number,
  esUltimaSerie: boolean,
  esUltimoEjercicio: boolean,
  ejercicio: EjercicioEnSesion,
  serie: number,
): string {
  if (quedan > 60) return 'Respira por la nariz y suelta despacio.';
  if (quedan > 25) return 'Colócate y repasa el primer movimiento.';
  if (esUltimaSerie && esUltimoEjercicio) return 'La última del día. Cuando quieras.';
  if (esUltimaSerie) return `Última de ${ejercicio.name.toLowerCase()}.`;
  return `Ahora la ${serie} de ${ejercicio.targetSets}.`;
}
