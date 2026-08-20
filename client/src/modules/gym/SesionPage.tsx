import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Celebracion from './Celebracion';
import { EjercicioModal } from './modals';
import ModoFoco from './ModoFoco';
import { ElegirEjercicio } from './Catalogo';
import { ListaOrdenable } from './Ordenable';
import {
  descansoSugerido,
  gymApi,
  kg,
  listaMusculos,
  nombreMusculo,
  numTxt,
  type Condicionante,
  type DiaRutina,
  type EjercicioEnSesion,
  type SesionDetalle,
} from './api';

const reloj = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Seguir el entrenamiento, serie a serie.
 *
 * Cada serie se guarda en cuanto se marca, no al final: si el móvil se apaga a
 * mitad de sesión no se pierde nada. Y cada una llega con lo que hiciste la vez
 * anterior ya escrito, porque lo normal es repetir o subir un poco, no empezar
 * de cero cada día.
 */
export default function SesionPage() {
  const { id } = useParams();
  const sesionId = Number(id);
  const navigate = useNavigate();
  const [datos, setDatos] = useState<SesionDetalle | null>(null);
  const [dias, setDias] = useState<DiaRutina[]>([]);
  const [condiciones, setCondiciones] = useState<Condicionante[]>([]);
  const [error, setError] = useState('');
  const [foco, setFoco] = useState(false);
  const [editando, setEditando] = useState<EjercicioEnSesion | null>(null);
  const [sustituyendo, setSustituyendo] = useState<EjercicioEnSesion | null>(null);
  const [celebrando, setCelebrando] = useState(false);
  const [improvisando, setImprovisando] = useState(false);
  // El descanso en curso: nace al marcar una serie y muere al marcar la
  // siguiente (o al cerrarlo a mano).
  const [descanso, setDescanso] = useState<{
    nombre: string;
    serie: number;
    desde: number;
    sugerido: number;
  } | null>(null);

  const cargar = useCallback(async () => setDatos(await gymApi.sesion(sesionId)), [sesionId]);
  useEffect(() => {
    cargar();
    gymApi.rutina().then((r) => setDias(r.days)).catch(() => {});
    gymApi.condicionantes().then((c) => setCondiciones(c.filter((x) => x.status === 'activo'))).catch(() => {});
  }, [cargar]);

  if (!datos) return <p className="muted">Cargando…</p>;

  const total = datos.exercises.reduce((n, e) => n + e.targetSets, 0);
  const hechas = datos.exercises.reduce((n, e) => n + e.done.length, 0);
  const cerrada = datos.session.endedAt != null;

  async function terminar() {
    if (hechas === 0) {
      if (!confirm('No has marcado ninguna serie, así que no hay nada que guardar. ¿Descarto el entrenamiento?')) return;
      await gymApi.tirar(sesionId);
      navigate('/gimnasio');
      return;
    }
    // la sesión se cierra en la pantalla de fiesta, junto con la encuesta: es
    // el único momento en que uno se acuerda de cómo se ha visto
    setCelebrando(true);
  }

  if (celebrando) {
    const volumen = datos.exercises.reduce(
      (n, e) => n + e.done.reduce((m, d) => m + (d.weight && d.reps ? Number(d.weight) * d.reps : 0), 0),
      0,
    );
    // De la primera serie a la última: si cierras desde el coche, esos minutos
    // no cuentan. El reloj se paró cuando dejaste de levantar.
    const marcas = datos.exercises.flatMap((e) => e.done).map((d) => new Date(d.createdAt).getTime());
    const min = marcas.length > 1 ? Math.round((Math.max(...marcas) - Math.min(...marcas)) / 60000) : 0;
    return (
      <Celebracion
        sesionId={sesionId}
        series={hechas}
        volumen={volumen || null}
        minutos={min > 0 && min < 300 ? min : null}
        onHecho={() => navigate('/gimnasio')}
      />
    );
  }

  if (cerrada) return <Resumen datos={datos} />;

  if (foco) {
    return (
      <ModoFoco
        ejercicios={datos.exercises}
        sesionId={sesionId}
        condiciones={condiciones}
        onCambio={cargar}
        onSalir={() => setFoco(false)}
      />
    );
  }

  return (
    <div>
      <div className="tk-crumbs">
        <Link to="/gimnasio" className="btn ghost sm tk-back">
          ‹ Gimnasio
        </Link>
        <span className="tk-path">{new Date(`${datos.session.sessionDate}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </div>

      <div className="page-head">
        <h1>{datos.day?.name ?? 'Entrenamiento'}</h1>
        <div className="head-acciones">
          <span className="gy-marcador">
            {hechas}/{total}
          </span>
        </div>
      </div>

      {/* El reloj de descanso, pegado arriba mientras haces scroll. */}
      {!cerrada && descanso && <BarraDescanso descanso={descanso} onCerrar={() => setDescanso(null)} />}

      {/* Equivocarse de día al entrar es lo más fácil del mundo: mientras no
          haya nada apuntado, se cambia aquí mismo. */}
      {!cerrada && hechas === 0 && dias.length > 1 && (
        <label className="gy-cambiar">
          <span>¿No era este día?</span>
          <select
            value={datos.session.dayId}
            onChange={async (e) => {
              setError('');
              try {
                await gymApi.cambiarDia(sesionId, Number(e.target.value));
                await cargar();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'No se pudo cambiar');
              }
            }}
          >
            {dias.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <div className="error-msg">{error}</div>}

      {/* La lista entera vale para consultar; para entrenar, una cosa delante */}
      {!cerrada && (
        <button className="btn gy-foco" onClick={() => setFoco(true)}>
          Modo foco · una serie cada vez
        </button>
      )}

      <ListaOrdenable
        ejercicios={datos.exercises}
        conAsa={!cerrada}
        etiqueta="Superserie · uno de cada, alternando"
        onOrden={async (ids) => {
          await gymApi.reordenar('ejercicios', ids);
          await cargar();
        }}
      >
        {(e, asa) => (
          <BloqueEjercicio
            key={e.id}
            ejercicio={e}
            sesionId={sesionId}
            onCambio={cargar}
            bloqueado={cerrada}
            condiciones={condiciones}
            onEditar={() => setEditando(e)}
            onDescanso={(serie) =>
              setDescanso({
                nombre: e.name,
                serie,
                desde: Date.now(),
                // la misma cuenta que el modo foco: lo que tienes puesto en el
                // ejercicio mezclado con tu media real en él
                sugerido: descansoSugerido({
                  ultimoReal: null,
                  ultimoSugerido: null,
                  media: e.restAvg ?? null,
                  objetivo: e.restSeconds,
                }),
              })
            }
            onSustituir={() => setSustituyendo(e)}
            onQuitar={async () => {
              const aviso =
                e.done.length > 0
                  ? `¿Quitar «${e.name}»? Sale también del plan de este día; las ${e.done.length} series que ya has apuntado se conservan en el histórico.`
                  : `¿Quitar «${e.name}»? Sale también del plan de este día.`;
              if (!confirm(aviso)) return;
              await gymApi.borrarEjercicio(e.id);
              await cargar();
            }}
            asa={asa}
          />
        )}
      </ListaOrdenable>

      {/* Sustituir un ejercicio SIN salir del entrenamiento: hoy la máquina
          está ocupada o el hombro dice que no, y la ficha de Rutina queda
          lejos con el móvil en la mano. El nuevo hereda el sitio y la
          superserie; lo ya apuntado se queda en el histórico del viejo. */}
      {sustituyendo && (
        <ElegirEjercicio
          titulo={`Sustituir ${sustituyendo.name}`}
          bloques={[...new Set(datos.exercises.flatMap((e) => (e.muscles || '').split(',').filter(Boolean)))]}
          onClose={() => setSustituyendo(null)}
          onPick={async (e) => {
            await gymApi.sustituir(sustituyendo.id, { catalogId: e.catalogId, name: e.name });
            setSustituyendo(null);
            await cargar();
          }}
        />
      )}

      {!cerrada && (
        <>
          {/* Meter algo que no estaba en el plan. Se escribe a mano: en el
              gimnasio, con una mano ocupada, teclear cuatro palabras es más
              rápido que buscar en una lista. No toca la rutina: al acabar te lo
              propone en Rutina y allí decides si se queda. */}
          {improvisando && (
            <ElegirEjercicio
              titulo="Añadir a este entrenamiento"
              bloques={[...new Set(datos.exercises.flatMap((e) => (e.muscles || '').split(',').filter(Boolean)))]}
              onClose={() => setImprovisando(false)}
              onPick={async (e) => {
                await gymApi.improvisar(sesionId, { catalogId: e.catalogId, name: e.name });
                await cargar();
              }}
            />
          )}
          <button className="gy-anadir-ej" onClick={() => setImprovisando(true)}>
            + Añadir un ejercicio que no estaba
          </button>

          {/* dos cosas distintas y con nombres distintos: terminar GUARDA lo
              hecho, descartar lo BORRA. «Tirar» valía para las dos. */}
          <button className="btn gy-terminar" onClick={terminar}>
            {hechas === 0
              ? 'Descartar · al final no lo hago'
              : `Terminar y guardar · ${hechas} ${hechas === 1 ? 'serie' : 'series'}`}
          </button>
          {/* tirarla siempre a mano: entrar por error con series ya apuntadas
              también pasa, y no puede obligarte a cerrar un entrenamiento falso */}
          {hechas > 0 && (
            <button
              className="gy-descartar gy-descartar-pie"
              onClick={async () => {
                if (!confirm(`¿Descarto el entrenamiento? Se borran las ${hechas} series que llevas apuntadas.`)) return;
                await gymApi.tirar(sesionId);
                navigate('/gimnasio');
              }}
            >
              Descartar sin guardar · se borran las {hechas} series
            </button>
          )}
        </>
      )}
      {cerrada && <p className="muted mc-vacio">Sesión cerrada. Lo que ves es lo que quedó registrado.</p>}

      {editando && (
        <EjercicioModal
          dayId={editando.dayId}
          ejercicio={editando}
          onClose={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}

function BloqueEjercicio({
  ejercicio,
  sesionId,
  onCambio,
  bloqueado,
  condiciones,
  onEditar,
  onDescanso,
  onSustituir,
  onQuitar,
  asa,
}: {
  ejercicio: EjercicioEnSesion;
  sesionId: number;
  onCambio: () => void;
  bloqueado: boolean;
  condiciones: Condicionante[];
  onEditar: () => void;
  /** al marcar una serie: arranca el reloj de descanso de la pantalla */
  onDescanso: (serie: number) => void;
  onSustituir: () => void;
  onQuitar: () => void | Promise<void>;
  asa?: import('react').ReactNode;
}) {
  const series = Array.from({ length: ejercicio.targetSets }, (_, i) => i + 1);
  const completo = ejercicio.done.length >= ejercicio.targetSets;
  // Colapsado por defecto: la sesión se lee de un vistazo —qué está hecho y
  // qué queda— y solo se abre el ejercicio que estás haciendo. Los ya
  // completos arrancan cerrados con más motivo.
  const [abierto, setAbierto] = useState(false);
  const [anadiendo, setAnadiendo] = useState(false);

  /** Una serie más en el plan de este ejercicio. */
  async function anadirSerie() {
    if (anadiendo) return;
    setAnadiendo(true);
    try {
      await gymApi.editarEjercicio(ejercicio.id, { targetSets: ejercicio.targetSets + 1 });
      onCambio();
    } finally {
      setAnadiendo(false);
    }
  }

  // El aviso sale aquí, delante del ejercicio, y no en una pantalla aparte que
  // no se abre con el móvil en la mano y sudando
  const avisos = condiciones.filter((c) =>
    listaMusculos(c.muscles).some((m) => listaMusculos(ejercicio.muscles).includes(m)),
  );

  return (
    <section className={`gy-bloque${completo ? ' hecho' : ''}`}>
      <div
        className="gy-bloque-head gy-bloque-toggle"
        role="button"
        tabIndex={0}
        onClick={() => setAbierto((v) => !v)}
        onKeyDown={(e) => e.key === 'Enter' && setAbierto((v) => !v)}
      >
        <div>
          <h2 className="gy-bloque-n">{ejercicio.name}</h2>
          {/* la vista de pájaro: cuántas series llevas de las que tocan */}
          <p className="gy-bloque-resumen">
            {ejercicio.done.length} de {ejercicio.targetSets} series
            {completo ? ' · hecho' : ''}
          </p>
        </div>
        <div className="gy-bloque-lado" onClick={(e) => e.stopPropagation()}>
          {completo && <span className="gy-tic">✓</span>}
          {asa}
          <span
            className={`gy-ej-chev${abierto ? ' abierto' : ''}`}
            onClick={() => setAbierto((v) => !v)}
            aria-hidden
          >
            ›
          </span>
        </div>
      </div>

      {abierto && (
        <>
      {/* el objetivo se toca aquí mismo: si el número está mal, volvería a
          salir cada día hasta que alguien se acordara de ir a Rutina */}
      <button className="gy-bloque-obj" onClick={onEditar} title="Cambiar el objetivo del ejercicio">
        {ejercicio.targetSets} × {ejercicio.targetReps}
        {ejercicio.targetWeight ? ` · objetivo ${kg(ejercicio.targetWeight)}` : ''}
        {ejercicio.restSeconds ? ` · ${ejercicio.restSeconds}s de descanso` : ''}
      </button>
      {listaMusculos(ejercicio.muscles).length > 0 && (
        <p className="gy-ej-m">{listaMusculos(ejercicio.muscles).map(nombreMusculo).join(' · ')}</p>
      )}

      {avisos.map((c) => (
        <p key={c.id} className={`gy-aviso ${c.severity}`}>
          <strong>
            {c.severity === 'evitar' ? 'Evitar' : 'Ojo'}
            {c.side !== 'na' ? ` · ${c.side}` : ''}:
          </strong>{' '}
          {c.title}
          {c.advice ? ` — ${c.advice}` : ''}
        </p>
      ))}

      {ejercicio.notes && <p className="gy-bloque-nota">{ejercicio.notes}</p>}

      <div className="gy-series">
        {series.map((n) => (
          <FilaSerie
            key={n}
            n={n}
            ejercicio={ejercicio}
            sesionId={sesionId}
            onCambio={onCambio}
            bloqueado={bloqueado}
            onDescanso={onDescanso}
          />
        ))}
      </div>

      {/* Lo que hoy no se puede hacer se cambia AQUÍ, sin ir a Rutina: la
          máquina ocupada o la molestia aparecen entrenando, no planificando. */}
      {!bloqueado && (
        <div className="gy-bloque-acciones">
          {/* Una serie más de las planeadas. Sube el objetivo del ejercicio, o
              sea que queda en la RUTINA: si hoy te salen cinco, mañana el plan
              son cinco. Es distinto de la serie de castigo, que es de hoy. */}
          <button className="btn ghost sm" disabled={anadiendo} onClick={anadirSerie}>
            {anadiendo ? 'Añadiendo…' : '+ Serie'}
          </button>
          <button className="btn ghost sm" onClick={onSustituir}>
            Sustituir por otro
          </button>
          <button className="btn ghost sm" onClick={onQuitar}>
            Quitar
          </button>
        </div>
      )}
        </>
      )}
    </section>
  );
}

/**
 * El reloj de descanso de la pantalla de entrenamiento.
 *
 * Aparece al marcar una serie y se queda pegado arriba mientras haces scroll,
 * porque el descanso se mira de reojo entre series, no se busca.
 *
 * La cuenta va HACIA ABAJO desde lo que toca descansar en ese ejercicio y, al
 * llegar a 0:00, sigue hacia arriba diciendo cuánto te pasas: el número
 * sugerido es una propuesta, no una orden, y saber que llevas dos minutos de
 * más es más útil que un reloj que se apaga.
 *
 * Lo que propone sale de la MISMA cuenta que el modo foco (`descansoSugerido`):
 * el descanso que tienes puesto en el ejercicio mezclado con tu media real en
 * él. Lo que NO hace es guardar este descanso como dato: aquí nadie dice cuándo
 * empieza la serie siguiente, así que el tiempo entre dos marcas incluye la
 * serie. Medirlo de verdad sigue siendo cosa del modo foco, donde tú cierras el
 * descanso al pulsar «Empezar la serie».
 */
function BarraDescanso({
  descanso,
  onCerrar,
}: {
  descanso: { nombre: string; serie: number; desde: number; sugerido: number };
  onCerrar: () => void;
}) {
  const [transcurrido, setTranscurrido] = useState(() => Math.floor((Date.now() - descanso.desde) / 1000));
  const avisadoRef = useRef(false);

  useEffect(() => {
    // Se calcula desde la hora de arranque, no sumando: si el móvil bloquea la
    // pantalla o cambias de app, el reloj vuelve con la cuenta correcta.
    const id = window.setInterval(() => {
      setTranscurrido(Math.floor((Date.now() - descanso.desde) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [descanso.desde]);

  // Un toque de vibración al llegar a cero: el móvil está en el banco, no en la
  // mano, y así no hace falta mirarlo.
  useEffect(() => {
    if (avisadoRef.current || transcurrido < descanso.sugerido) return;
    avisadoRef.current = true;
    if ('vibrate' in navigator) navigator.vibrate?.([120, 60, 120]);
  }, [transcurrido, descanso.sugerido]);

  const restante = descanso.sugerido - transcurrido;
  const pasado = restante <= 0;

  return (
    <div className={`gy-desc${pasado ? ' pasado' : ''}`}>
      <div className="gy-desc-txt">
        <span className="gy-desc-et">Descanso · {descanso.nombre} serie {descanso.serie}</span>
        <span className="gy-desc-reloj">{reloj(Math.abs(restante))}</span>
        {pasado && <span className="gy-desc-mas">de más</span>}
      </div>
      <button className="gy-desc-x" onClick={onCerrar} aria-label="Quitar el reloj de descanso">
        ✕
      </button>
    </div>
  );
}

function FilaSerie({
  n,
  ejercicio,
  sesionId,
  onCambio,
  bloqueado,
  onDescanso,
}: {
  n: number;
  ejercicio: EjercicioEnSesion;
  sesionId: number;
  onCambio: () => void;
  bloqueado: boolean;
  onDescanso: (serie: number) => void;
}) {
  const hecha = ejercicio.done.find((d) => d.setNumber === n);
  const antes = ejercicio.previous.sets.find((s) => s.setNumber === n);
  const porTiempo = ejercicio.kind === 'tiempo';

  // De salida, lo de la vez anterior: lo normal es repetir o subir un poco
  const [peso, setPeso] = useState(numTxt(hecha?.weight ?? antes?.weight ?? ejercicio.targetWeight));
  const [medida, setMedida] = useState(
    String(
      (porTiempo ? (hecha?.seconds ?? antes?.seconds) : (hecha?.reps ?? antes?.reps)) ?? '',
    ),
  );
  const [busy, setBusy] = useState(false);

  async function marcar() {
    if (bloqueado) return;
    setBusy(true);
    try {
      if (hecha) {
        await gymApi.borrarSerie(sesionId, hecha.id);
      } else {
        const v = medida.trim() === '' ? null : Number(medida.replace(',', '.'));
        await gymApi.marcarSerie(sesionId, {
          exerciseId: ejercicio.id,
          setNumber: n,
          reps: porTiempo ? null : v,
          seconds: porTiempo ? v : null,
          weight: peso === '' ? null : Number(String(peso).replace(',', '.')),
        });
        // acabas de cerrar una serie: empieza el descanso. Al desmarcar no,
        // que eso es corregir un dato, no terminar de levantar.
        onDescanso(n);
      }
      onCambio();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`gy-serie${hecha ? ' puesta' : ''}`}>
      <span className="gy-serie-n">{n}</span>

      <label className="gy-campo">
        <span>kg</span>
        <input
          inputMode="decimal"
          value={peso}
          disabled={bloqueado || !!hecha}
          onChange={(e) => setPeso(e.target.value)}
        />
      </label>

      <label className="gy-campo">
        <span>{porTiempo ? 'seg' : 'repes'}</span>
        <input
          inputMode="numeric"
          value={medida}
          disabled={bloqueado || !!hecha}
          onChange={(e) => setMedida(e.target.value)}
        />
      </label>

      {/* lo de la vez anterior, en gris: es la referencia, no un dato editable.
          Si no hay vez anterior no se pinta: un guion suelto solo ocupa sitio. */}
      {antes && (
        <span className="gy-antes">
          la última: {antes.weight ? `${numTxt(antes.weight)} × ` : ''}
          {porTiempo ? `${antes.seconds}s` : antes.reps}
        </span>
      )}

      <button
        className={`gy-check${hecha ? ' puesto' : ''}`}
        disabled={busy || bloqueado}
        aria-label={hecha ? `Desmarcar la serie ${n}` : `Marcar la serie ${n}`}
        onClick={marcar}
      >
        ✓
      </button>
    </div>
  );
}


const ENERGIA_TXT = ['', 'Sin fuerza', 'Justo', 'Normal', 'Fuerte', 'Voy sobrado'];
const ANIMO_TXT = ['', 'Mal', 'Regular', 'Ni fu ni fa', 'Contento', 'Genial'];

/**
 * Un entrenamiento ya cerrado, en modo lectura.
 *
 * La duración va de la PRIMERA serie a la ÚLTIMA, no de abrir a cerrar la
 * sesión: irse del gimnasio con el móvil en el bolsillo no puede convertir hora
 * y media en tres horas.
 */
function Resumen({ datos }: { datos: SesionDetalle }) {
  const series = datos.exercises.flatMap((e) => e.done);
  const volumen = series.reduce((n, d) => n + (d.weight && d.reps ? Number(d.weight) * d.reps : 0), 0);
  const tiempos = series.map((d) => new Date(d.createdAt ?? datos.session.startedAt).getTime()).filter(Boolean);
  const minutos =
    tiempos.length > 1 ? Math.round((Math.max(...tiempos) - Math.min(...tiempos)) / 60000) : null;
  const descansos = series.map((d) => d.restBefore).filter((x): x is number => x != null);
  const descansoMedio = descansos.length ? Math.round(descansos.reduce((a, b) => a + b, 0) / descansos.length) : null;

  return (
    <div>
      <div className="tk-crumbs">
        <Link to="/gimnasio" className="btn ghost sm tk-back">
          ‹ Gimnasio
        </Link>
        <span className="tk-path">
          {new Date(`${datos.session.sessionDate}T12:00:00`).toLocaleDateString('es-ES', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </span>
      </div>

      <div className="page-head">
        <h1>{datos.day?.name ?? 'Entrenamiento'}</h1>
      </div>

      <div className="gy-res-cifras">
        <span>
          <b>{series.length}</b> series
        </span>
        {volumen > 0 && (
          <span>
            <b>{Math.round(volumen).toLocaleString('es-ES')}</b> kg movidos
          </span>
        )}
        {minutos != null && (
          <span>
            <b>{minutos}</b> min entrenando
          </span>
        )}
        {descansoMedio != null && (
          <span>
            <b>{Math.floor(descansoMedio / 60)}:{String(descansoMedio % 60).padStart(2, '0')}</b> de descanso medio
          </span>
        )}
      </div>

      {(datos.session.energy || datos.session.feeling || datos.session.notes) && (
        <section className="section mc-bloque">
          <h2>Cómo te viste</h2>
          <div className="gy-res-encuesta">
            {datos.session.energy && <span className="pr-senal">Energía · {ENERGIA_TXT[datos.session.energy]}</span>}
            {datos.session.feeling && <span className="pr-senal">Ánimo · {ANIMO_TXT[datos.session.feeling]}</span>}
          </div>
          {datos.session.notes && <p className="gy-res-notas">{datos.session.notes}</p>}
        </section>
      )}

      <section className="section mc-bloque">
        <h2>Lo que hiciste</h2>
        {datos.exercises.map((e) => (
          <div key={e.id} className={`gy-res-ej${e.done.length === 0 ? ' saltado' : ''}`}>
            <div className="gy-res-ej-head">
              <span className="gy-res-ej-n">{e.name}</span>
              <span className="gy-res-ej-s">
                {e.done.length === 0 ? 'te lo saltaste' : `${e.done.length} de ${e.targetSets} series`}
              </span>
            </div>
            {e.done.length > 0 && (
              <div className="gy-res-series">
                {e.done
                  .slice()
                  .sort((a, b) => a.setNumber - b.setNumber)
                  .map((d) => (
                    <span key={d.id} className={`gy-res-serie${d.punishment ? ' castigo' : ''}`}>
                      {d.weight ? `${numTxt(d.weight)} × ` : ''}
                      {d.seconds != null ? `${d.seconds}s` : d.reps}
                      {d.plannedReps != null && d.reps != null && d.reps < d.plannedReps && (
                        <b title={`Ibas a por ${d.plannedReps}`}> ↓</b>
                      )}
                    </span>
                  ))}
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
