import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  gymApi,
  GRUPOS,
  hace,
  listaMusculos,
  MUSCULOS,
  nombreGrupo,
  nombreMusculo,
  type DiaRutina,
  type Ejercicio,
  type Condicionante,
  type MetaGym,
  type Parte,
  type Rutina,
  type Sesion,
  type SesionHistorial,
  type SesionOlvidada,
  type SemanaGym,
} from './api';
import { txtPesoKg } from './peso';
import { CondicionanteModal, MetaModal } from './modals';
import { Compartir, Sugerencias } from './Compartir';
import { CatalogoTab, ElegirEjercicio } from './Catalogo';
import { ListaOrdenable } from './Ordenable';
import DetalleEjercicio from './DetalleEjercicio';
import { Pesaje } from './Pesaje';
import Modal from '../../components/Modal';
import { notaDelDia } from './score';

type Vista = 'entrenar' | 'rutina' | 'ejercicios';

// Tres pestañas COMO MÁXIMO: es lo que cabe en línea con el título en 375 px
// sin desplazarse ni saltar de línea. Objetivo vive ahora en Salud › Objetivos.
const VISTAS: [Vista, string][] = [
  ['entrenar', 'Entrenar'],
  ['rutina', 'Rutina'],
  ['ejercicios', 'Ejercicios'],
];

/**
 * Gimnasio: la rutina, seguirla y a dónde vas.
 *
 * Los días no tienen día de la semana a propósito: la rotación siempre es la
 * misma pero los días no, así que lo que toca se deduce del orden y de cuándo
 * se hizo cada uno. Ir tres veces una semana y cuatro la siguiente no descuadra
 * nada.
 */
export default function GimnasioPage() {
  const [params, setParams] = useSearchParams();
  const pedida = params.get('tab');
  const navigate = useNavigate();
  // la pestaña Objetivo se mudó a Salud: los enlaces viejos siguen valiendo
  useEffect(() => {
    if (pedida === 'objetivo') navigate('/salud/objetivos', { replace: true });
  }, [pedida, navigate]);
  const vista: Vista = pedida === 'rutina' || pedida === 'ejercicios' ? pedida : 'entrenar';
  const irA = (v: Vista) => setParams(v === 'entrenar' ? {} : { tab: v }, { replace: true });

  const [rutina, setRutina] = useState<Rutina | null>(null);

  const cargar = useCallback(async () => setRutina(await gymApi.rutina()), []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div>
      <div className="page-head">
        <h1>Gimnasio</h1>
        <div className="head-acciones">
          <div className="seg" role="tablist">
            {VISTAS.map(([v, etiqueta]) => (
              <button
                key={v}
                role="tab"
                aria-selected={vista === v}
                className={vista === v ? 'active' : ''}
                onClick={() => irA(v)}
              >
                {etiqueta}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="page-sub">Tu rutina de entrenamiento: qué sesión toca hoy, tus tablas y tu catálogo de ejercicios.</p>

      {!rutina ? (
        <p className="muted">Cargando…</p>
      ) : vista === 'entrenar' ? (
        <Entrenar rutina={rutina} />
      ) : vista === 'rutina' ? (
        <LaRutina rutina={rutina} onCambio={cargar} />
      ) : (
        <CatalogoTab />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- entrenar

/**
 * El día que toca es el SIGUIENTE al último que se hizo, no el que más tiempo
 * lleve sin hacerse: la rotación tiene un orden y saltárselo desordena la
 * semana entera. Se puede elegir otro, claro.
 */
function siguienteDia(dias: DiaRutina[]): DiaRutina | null {
  if (dias.length === 0) return null;
  const hechos = dias.filter((d) => d.lastDone);
  if (hechos.length === 0) return dias[0];
  const ultimo = hechos.reduce((a, b) => (a.lastDone! >= b.lastDone! ? a : b));
  const i = dias.findIndex((d) => d.id === ultimo.id);
  return dias[(i + 1) % dias.length];
}

function Entrenar({ rutina }: { rutina: Rutina }) {
  const navigate = useNavigate();
  const [abierta, setAbierta] = useState<Sesion | null>(null);
  const [olvidada, setOlvidada] = useState<SesionOlvidada | null>(null);
  const [historial, setHistorial] = useState<SesionHistorial[]>([]);
  const [semana, setSemana] = useState<SemanaGym | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    gymApi.sesionAbierta().then(setAbierta).catch(() => {});
    gymApi.sesionOlvidada().then(setOlvidada).catch(() => {});
    gymApi.historial(8).then(setHistorial).catch(() => {});
    gymApi.semana().then(setSemana).catch(() => {});
  }, []);

  // El cuarto día de la semana es opcional y solo existe con los tres hechos:
  // si aún no están, esto no cambia nada y se propone el siguiente sin más.
  const idos = semana ? new Set(semana.week.map((x) => x.sessionDate)).size : 0;
  const cuartoOpcional = semana != null && idos >= semana.target;

  // Lo de hoy, si ya está hecho. Entonces no se propone nada más: la rotación
  // se reanuda mañana, que es como se entrena de verdad.
  const hoyHecho = useMemo(
    () => rutina.days.find((d) => d.lastDone === rutina.today) ?? null,
    [rutina.days, rutina.today],
  );

  // Con una sesión abierta tampoco se enseña «te toca»: estarías leyendo que te
  // toca Espalda mientras tienes Pecho a medias justo encima.
  const toca = useMemo(
    () => (abierta || hoyHecho ? null : siguienteDia(rutina.days)),
    [rutina.days, abierta, hoyHecho],
  );
  const resto = rutina.days.filter((d) => d.id !== toca?.id);

  async function empezar(dayId: number) {
    setBusy(true);
    try {
      const s = await gymApi.empezar(dayId);
      navigate(`/gimnasio/sesion/${s.id}`);
    } finally {
      setBusy(false);
    }
  }

  if (rutina.days.length === 0) {
    return <p className="empty">No hay días en la rutina. Créalos en la pestaña Rutina.</p>;
  }

  return (
    <div>
      {/* Te fuiste sin cerrar: se te pregunta al volver, no se cierra sola. La
          hora ya está bien igualmente, porque la duración se mide de la primera
          serie a la última. */}
      {olvidada && (
        <button className="gy-olvidada" onClick={() => navigate(`/gimnasio/sesion/${olvidada.id}`)}>
          <span className="gy-continuar-t">¿Cómo fue el entrenamiento?</span>
          <span className="gy-continuar-s">
            {olvidada.dayName} · {olvidada.sets} series y sin cerrar desde hace{' '}
            {olvidada.minutos >= 120 ? `${Math.round(olvidada.minutos / 60)} h` : `${olvidada.minutos} min`} · ciérralo →
          </span>
        </button>
      )}

      {abierta && !olvidada && (
        <div className="gy-abierta">
          <button className="gy-continuar" onClick={() => navigate(`/gimnasio/sesion/${abierta.id}`)}>
            <span className="gy-continuar-t">Tienes un entrenamiento a medias</span>
            <span className="gy-continuar-s">
              {rutina.days.find((d) => d.id === abierta.dayId)?.name ?? 'Sesión'} · seguir →
            </span>
          </button>
          {/* la salida, aquí mismo: si no, la sesión abierta bloquea la pantalla
              y hay que entrar en ella para poder tirarla */}
          <button
            className="gy-descartar"
            onClick={async () => {
              if (!confirm('¿Descarto el entrenamiento? Se borra lo que hubieras apuntado en él.')) return;
              await gymApi.tirar(abierta.id);
              setAbierta(null);
            }}
          >
            Descartarlo
          </button>
        </div>
      )}

      {hoyHecho && !abierta && (
        <section className="section mc-bloque">
          <div className="gy-hoy">
            <span className="gy-hoy-t">Hoy ya has entrenado</span>
            <span className="gy-hoy-s">
              {hoyHecho.name} · mañana te toca {siguienteDia(rutina.days)?.name ?? 'el siguiente'}
            </span>
          </div>
        </section>
      )}

      {toca && (
        <section className="section mc-bloque">
          <div className="mc-head">
            <h2>{cuartoOpcional ? 'El cuarto, si te apetece' : 'Te toca'}</h2>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {cuartoOpcional ? `${idos} de ${semana!.target} esta semana` : `última vez ${hace(toca.lastDone)}`}
            </span>
          </div>
          <div className="gy-toca">
            <div className="gy-toca-txt">
              <span className="gy-toca-n">{toca.name}</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {toca.exercises.length} ejercicios ·{' '}
                {toca.exercises.reduce((n, e) => n + e.targetSets, 0)} series
              </span>
            </div>
            <button className="btn" disabled={busy || !!abierta} onClick={() => empezar(toca.id)}>
              Empezar
            </button>
          </div>
        </section>
      )}

      <section className="section mc-bloque oscuro">
        <h2>{toca ? 'Los otros días' : 'Los días de la rutina'}</h2>
        <div className="mk-grid">
          {/* Islas claras dentro del bloque oscuro: `claro` devuelve los colores
              de siempre, así que la tarjeta queda blanca y su «Empezar» negro,
              sin tener que escribir una regla por cada cosa de dentro. */}
          {resto.map((d) => (
            <div key={d.id} className="mk claro">
              <span className="mk-txt">
                <span className="mk-t">{d.name}</span>
                <span className="mk-sub">
                  {d.exercises.length} ejercicios · última vez {hace(d.lastDone)}
                </span>
              </span>
              <button className="btn ghost sm" disabled={busy || !!abierta} onClick={() => empezar(d.id)}>
                Empezar
              </button>
            </div>
          ))}
        </div>
      </section>

      {historial.length > 0 && (
        <section className="section mc-bloque">
          <h2>Últimos entrenamientos</h2>
          <div className="gy-hist">
            {historial.map((h) => (
              <button key={h.id} className="gy-hist-fila" onClick={() => navigate(`/gimnasio/sesion/${h.id}`)}>
                <span className="gy-hist-f">{fechaCorta(h.sessionDate)}</span>
                <span className="gy-hist-d">{h.dayName}</span>
                <span className="gy-hist-n">
                  {h.sets} series
                  {h.volume ? ` · ${Math.round(Number(h.volume)).toLocaleString('es-ES')} kg` : ''}
                  {duracion(h) ? ` · ${duracion(h)}` : ''}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function fechaCorta(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

/**
 * De la PRIMERA serie a la ÚLTIMA, no de abrir a cerrar: si te vas del gimnasio
 * sin cerrar la sesión, el reloj deja de contar solo, porque ya no apuntas nada.
 */
function duracion(h: SesionHistorial): string | null {
  if (!h.firstSet || !h.lastSet) return null;
  const min = Math.round((new Date(h.lastSet).getTime() - new Date(h.firstSet).getTime()) / 60000);
  if (min <= 0 || min > 300) return null;
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

// ---------------------------------------------------------------- la rutina

function LaRutina({ rutina, onCambio }: { rutina: Rutina; onCambio: () => void }) {
  const [detalle, setDetalle] = useState<{ dia: DiaRutina; ejercicio: Ejercicio } | null>(null);
  // añadir = elegir de la lista; el formulario grande queda solo para editar
  const [eligiendo, setEligiendo] = useState<number | null>(null);
  const [partes, setPartes] = useState<Parte[]>([]);
  const [creandoDia, setCreandoDia] = useState(false);
  const [nuevaAnadida, setNuevaAnadida] = useState(false);
  // crear una sesión empieza declarando su objetivo; editar uno abre lo mismo
  const [declarando, setDeclarando] = useState(false);
  const [declarandoDia, setDeclarandoDia] = useState<DiaRutina | null>(null);

  useEffect(() => {
    gymApi.partes().then(setPartes).catch(() => {});
  }, []);

  async function crearDia(goalMain: string[], goalSide: string[]) {
    if (creandoDia) return;
    setCreandoDia(true);
    try {
      // El título nace del objetivo declarado («Sesión Espalda y Pierna») y se
      // cambia tocándolo, como siempre. Sin objetivo, el provisional de antes.
      const name = tituloDeObjetivo(goalMain, goalSide) ?? `Día ${rutina.days.length + 1}`;
      await gymApi.crearDia({ name, goalMain, goalSide });
      setDeclarando(false);
      onCambio();
      setNuevaAnadida(true);
      window.setTimeout(() => setNuevaAnadida(false), 6000);
    } finally {
      setCreandoDia(false);
    }
  }

  // Una cuenta nueva llega aquí sin nada. Sin esto la pantalla se quedaba en
  // blanco y no había por dónde empezar: la pestaña Entrenar mandaba aquí y
  // aquí no se podía hacer nada.
  if (rutina.days.length === 0) {
    return (
      <section className="section">
        <h2>Todavía no tienes rutina</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 520 }}>
          Una rutina son <b>días</b> y, dentro de cada día, sus <b>ejercicios</b>. Los días no llevan día de la semana:
          se hacen en orden, y el portal te dirá cuál toca según cuándo hiciste el anterior. Empieza por uno; el nombre
          lo cambias tocándolo.
        </p>
        <button className="btn" style={{ marginTop: 14 }} disabled={creandoDia} onClick={() => setDeclarando(true)}>
          {creandoDia ? 'Creando…' : 'Crear el primer día'}
        </button>
        {declarando && (
          <ObjetivoSesion
            titulo="¿Qué quieres entrenar en esta sesión?"
            accion="Crear la sesión"
            onClose={() => setDeclarando(false)}
            onGuardar={crearDia}
          />
        )}
      </section>
    );
  }

  return (
    <div>
      <Sugerencias onCambio={onCambio} />

      <button className="gy-nueva-sesion" disabled={creandoDia} onClick={() => setDeclarando(true)}>
        {creandoDia ? 'Creando…' : '+ Añadir nueva sesión'}
      </button>
      {nuevaAnadida && <p className="gy-nueva-aviso">¡Sesión añadida! Se encuentra en tus últimas sesiones.</p>}

      {rutina.days.map((d) => (
        <section key={d.id} className="section mc-bloque">
          {esNueva(d.createdAt) && <p className="gy-nuevo">Nuevo</p>}
          <div className="mc-head gy-dia-head">
            <h2>
              <NombreDia dia={d} onCambio={onCambio} />
            </h2>
            <button className="btn ghost sm" onClick={() => setEligiendo(d.id)}>
              + Ejercicio
            </button>
          </div>

          {/* El objetivo DECLARADO de la sesión: intención, no realidad. La
              cobertura de abajo mide la distancia entre las dos. */}
          <button className="gy-obj-linea" onClick={() => setDeclarandoDia(d)}>
            {d.goalMain || d.goalSide
              ? [
                  listaMusculos(d.goalMain).map(nombreGrupo).join(', '),
                  d.goalSide ? `acompaña ${listaMusculos(d.goalSide).map(nombreGrupo).join(', ')}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Declarar el objetivo de esta sesión →'}
          </button>

          <NotaDia dia={d} partes={partes} />

          {/* Qué trabaja la sesión: DERIVADO de sus ejercicios, nunca manual.
              Es la misma verdad que usa la cobertura, y por eso no puede
              desviarse de ella. */}
          {d.exercises.length > 0 && (
            <p className="gy-cats">
              {[...new Set(d.exercises.flatMap((e) => listaMusculos(e.muscles)))].map(nombreMusculo).join(' · ')}
            </p>
          )}

          {d.exercises.length === 0 ? (
            <p className="muted mc-vacio">Sin ejercicios todavía.</p>
          ) : (
            <div className="gy-lista">
              <ListaOrdenable
                ejercicios={d.exercises}
                onOrden={async (ids) => {
                  await gymApi.reordenar('ejercicios', ids);
                  onCambio();
                }}
              >
                {(e, asa) => (
                  <div key={e.id} className="gy-fila-ord">
                    <FilaEjercicio e={e} onClick={() => setDetalle({ dia: d, ejercicio: e })} />
                    {asa}
                  </div>
                )}
              </ListaOrdenable>
            </div>
          )}

          {/* Lo que improvisaste entrenando: se propone aquí, no se cuela en el
              plan. Va debajo de los ejercicios porque es una decisión, no una
              parte de la rutina todavía. */}
          {(d.proposed ?? []).length > 0 && (
            <div className="cp-prop">
              <p className="cp-prop-t">Metiste esto entrenando. ¿Se queda en el plan?</p>
              {(d.proposed ?? []).map((e) => (
                <div key={e.id} className="cp-item">
                  <div className="cp-item-txt">
                    <span className="cp-item-t">{e.name}</span>
                    <span className="cp-item-s">
                      {e.targetSets} × {e.targetReps}
                    </span>
                  </div>
                  <div className="cp-item-btns">
                    <button
                      className="btn sm"
                      onClick={async () => {
                        await gymApi.aceptarPropuesta(e.id);
                        onCambio();
                      }}
                    >
                      Se queda
                    </button>
                    <button
                      className="btn ghost sm"
                      onClick={async () => {
                        await gymApi.descartarPropuesta(e.id);
                        onCambio();
                      }}
                    >
                      Fuera
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Discreto y al final: hace falta para deshacer un día creado por
              error, pero no es una acción que se busque a menudo, y arriba
              estaría pegado al «+ Ejercicio» con el pulgar. */}
          <button
            className="gy-quitar-dia"
            onClick={async () => {
              const aviso =
                d.exercises.length > 0
                  ? `¿Quitar «${d.name}» de la rutina? Se va con sus ${d.exercises.length} ejercicios. Lo que ya hayas entrenado se conserva en el histórico.`
                  : `¿Quitar «${d.name}» de la rutina?`;
              if (!confirm(aviso)) return;
              await gymApi.borrarDia(d.id);
              onCambio();
            }}
          >
            Quitar el día
          </button>
        </section>
      ))}

      <Compartir onCambio={onCambio} />

      {eligiendo != null && (
        <ElegirEjercicio
          titulo="Añadir a este día"
          // el filtro se deriva de lo que la sesión ya trabaja
          bloques={[
            ...new Set(
              (rutina.days.find((x) => x.id === eligiendo)?.exercises ?? []).flatMap((e) => listaMusculos(e.muscles)),
            ),
          ]}
          onClose={() => setEligiendo(null)}
          onPick={async (e) => {
            // entra con el objetivo por defecto y se ajusta tocándolo, como el peso
            await gymApi.crearEjercicio({ dayId: eligiendo, catalogId: e.catalogId, name: e.name });
            onCambio();
          }}
        />
      )}

      {detalle && (
        <DetalleEjercicio
          ejercicio={detalle.ejercicio}
          dia={detalle.dia}
          onClose={() => setDetalle(null)}
          onCambio={onCambio}
        />
      )}

      {declarando && (
        <ObjetivoSesion
          titulo="¿Qué quieres entrenar en esta sesión?"
          accion="Crear la sesión"
          onClose={() => setDeclarando(false)}
          onGuardar={crearDia}
        />
      )}

      {declarandoDia && (
        <ObjetivoSesion
          titulo={declarandoDia.name}
          accion="Guardar el objetivo"
          main0={listaMusculos(declarandoDia.goalMain)}
          side0={listaMusculos(declarandoDia.goalSide)}
          onClose={() => setDeclarandoDia(null)}
          onGuardar={async (goalMain, goalSide) => {
            await gymApi.editarDia(declarandoDia.id, { goalMain, goalSide });
            setDeclarandoDia(null);
            onCambio();
          }}
        />
      )}
    </div>
  );
}

/** «Sesión Espalda y Pierna»: el título nace de lo declarado (y se edita tocándolo). */
function tituloDeObjetivo(main: string[], side: string[]): string | null {
  const nombres = [...main, ...side].map(nombreGrupo);
  if (nombres.length === 0) return null;
  const lista = nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
  return `Sesión ${lista}`;
}

const esNueva = (iso: string) => Date.now() - new Date(iso).getTime() < 7 * 86400000;

/**
 * Declarar el objetivo de una sesión: qué se entrena a fondo y qué acompaña.
 *
 * Es la intención, no la realidad: la cobertura mide contra esto sin adivinar
 * nada. Lo principal se exige entero (un nivel por debajo: un bloque pide sus
 * partes, un grupo ancho pide sus bloques); lo secundario solo pide presencia
 * y su volumen se juzga en la cobertura global, no por sesión.
 */
function ObjetivoSesion({
  titulo,
  accion,
  main0 = [],
  side0 = [],
  onClose,
  onGuardar,
}: {
  titulo: string;
  accion: string;
  main0?: string[];
  side0?: string[];
  onClose: () => void;
  onGuardar: (main: string[], side: string[]) => void | Promise<void>;
}) {
  const [main, setMain] = useState<string[]>(main0);
  const [side, setSide] = useState<string[]>(side0);
  const [guardando, setGuardando] = useState(false);

  return (
    <Modal title={titulo} onClose={onClose}>
      <p className="muted gy-obj-p">
        <b>A fondo</b> — la cobertura te lo exigirá entero:
      </p>
      <div className="us-chips">
        {GRUPOS.map((g) => {
          const on = main.includes(g.id);
          return (
            <button
              key={g.id}
              type="button"
              className={`us-chip${on ? ' on' : ''}`}
              onClick={() => {
                setMain((v) => (on ? v.filter((x) => x !== g.id) : [...v, g.id]));
                setSide((v) => v.filter((x) => x !== g.id));
              }}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      <p className="muted gy-obj-p">
        <b>De acompañamiento</b> — solo se pedirá que tenga trabajo; si acumula lo
        suficiente se ve en la cobertura general:
      </p>
      <div className="us-chips">
        {GRUPOS.filter((g) => !main.includes(g.id)).map((g) => {
          const on = side.includes(g.id);
          return (
            <button
              key={g.id}
              type="button"
              className={`us-chip${on ? ' on' : ''}`}
              onClick={() => setSide((v) => (on ? v.filter((x) => x !== g.id) : [...v, g.id]))}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      <button
        className="btn"
        style={{ marginTop: 16 }}
        disabled={guardando}
        onClick={async () => {
          setGuardando(true);
          try {
            await onGuardar(main, side);
          } finally {
            setGuardando(false);
          }
        }}
      >
        {guardando ? 'Guardando…' : main.length + side.length === 0 ? `${accion} (sin objetivo)` : accion}
      </button>
    </Modal>
  );
}

/**
 * La cobertura de la sesión, con su desglose a un toque.
 *
 * Una sola pregunta: ¿lo que planificas aquí cubre las partes de lo que esta
 * sesión quiere entrenar? El objetivo se deriva de los músculos PRINCIPALES de
 * sus ejercicios, así que a nadie se le exige lo que solo trabaja de rebote,
 * ni se le compara con la rutina de otro.
 */
function NotaDia({ dia, partes }: { dia: DiaRutina; partes: Parte[] }) {
  const [abierto, setAbierto] = useState(false);
  const nota = useMemo(() => (partes.length ? notaDelDia(dia, partes) : null), [dia, partes]);
  if (!nota) return null;

  const nivel = nota.total >= 8 ? 'bien' : nota.total >= 6 ? 'parcial' : 'cero';

  return (
    <div className="gy-nota">
      <button className={`gy-nota-head ${nivel}`} onClick={() => setAbierto((v) => !v)}>
        <span className="gy-nota-n">{String(nota.total).replace('.', ',')}</span>
        <span className="gy-nota-de">/ 10</span>
        <span className="gy-nota-t">
          {nota.cubiertas === nota.posibles
            ? nota.declarado
              ? 'cubre su objetivo entero'
              : 'cubre todo lo que trabaja'
            : `cubre ${nota.cubiertas} de ${nota.posibles} de ${nota.declarado ? 'su objetivo' : 'lo que trabaja'}`}
        </span>
        <span className="gy-nota-chev">{abierto ? '▾' : '▸'}</span>
      </button>

      {abierto && (
        <div className="gy-nota-detalle">
          {nota.filas.map((f) => (
            <div key={f.id} className="gy-crit">
              <span className="gy-crit-l">
                {f.label}
                {f.secundario && <span className="gy-crit-2"> · acompaña</span>}
              </span>
              <span className="gy-crit-p">
                {f.cubiertas}/{f.posibles}
              </span>
              <span className="gy-crit-d">
                {f.secundario
                  ? f.cubiertas > 0
                    ? 'presente: tiene trabajo de verdad'
                    : 'sin ningún ejercicio que lo entrene'
                  : f.faltan.length === 0
                    ? 'todo con trabajo'
                    : f.faltan.map((x) => `falta ${x.label.toLowerCase()} (${x.ideas.join(' o ').toLowerCase()})`).join(' · ')}
              </span>
            </div>
          ))}
          {nota.sinMusculos.length > 0 && (
            <p className="muted gy-crit-nota">
              {nota.sinMusculos.join(', ')} no declara músculos, así que no puede contar aquí.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function NombreDia({ dia, onCambio }: { dia: DiaRutina; onCambio: () => void }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(dia.name);

  if (!editando) {
    return (
      <button className="gy-nombre" onClick={() => setEditando(true)} title="Cambiar el nombre">
        {dia.name}
      </button>
    );
  }
  return (
    <input
      className="gy-nombre-input"
      value={valor}
      autoFocus
      onChange={(e) => setValor(e.target.value)}
      onBlur={async () => {
        setEditando(false);
        if (valor.trim() && valor !== dia.name) {
          await gymApi.editarDia(dia.id, { name: valor.trim() });
          onCambio();
        }
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/**
 * Qué trabajas y qué te falta, por dentro de cada bloque.
 *
 * «Pecho: 31 series» no contesta a la pregunta de verdad, que es si tocas todo
 * el bloque o repites siempre la misma zona. Por eso se cuenta por PARTE y el
 * bloque se resume a partir de ahí.
 *
 * Se cuenta por VUELTA completa a la rutina, no por semana: como no hay días
 * fijos, una semana pueden ser tres días y otra cuatro, y el número por semana
 * cambiaría sin que tú cambies nada.
 *
 * Vivía en la pestaña Rutina; ahora se enseña en Objetivo & Analíticas (por
 * eso el export), porque responde a un objetivo («¿cubro toda la musculatura
 * que quiero cubrir?»), no a la edición de la tabla.
 */
export function Cobertura({ rutina }: { rutina: Rutina }) {
  const [partes, setPartes] = useState<Parte[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);

  useEffect(() => {
    gymApi.partes().then(setPartes).catch(() => {});
  }, []);

  // Trabajo por parte en una vuelta completa: el principal (lo que entrenas) y
  // el colateral (lo que trabaja de rebote) se cuentan separados.
  const trabajo = useMemo(() => {
    const prin = new Map<string, number>();
    const col = new Map<string, number>();
    for (const d of rutina.days) {
      for (const e of d.exercises) {
        for (const parte of listaMusculos(e.parts)) prin.set(parte, (prin.get(parte) ?? 0) + e.targetSets);
        for (const parte of listaMusculos(e.partsSecondary)) col.set(parte, (col.get(parte) ?? 0) + e.targetSets);
      }
    }
    return { prin, col };
  }, [rutina]);

  const bloques = useMemo(() => {
    return MUSCULOS.map((bloque) => {
      const suyas = partes.filter((p) => p.muscle === bloque.id);
      const total = suyas.reduce((n, p) => n + (trabajo.prin.get(p.id) ?? 0), 0);
      const colateral = suyas.reduce((n, p) => n + (trabajo.col.get(p.id) ?? 0), 0);
      const vacias = suyas.filter((p) => !trabajo.prin.get(p.id) && !trabajo.col.get(p.id));
      return { bloque, partes: suyas, total, colateral, vacias };
    }).filter((b) => b.partes.length > 0);
  }, [partes, trabajo]);

  // Los bloques que CUBREN los objetivos declarados de las sesiones. Si algo
  // está declarado y no aparece nunca, ese es el peor aviso posible: dices que
  // lo entrenas y no está. Lo no declarado sin trabajo es solo información.
  const declarados = useMemo(() => {
    const s = new Set<string>();
    for (const d of rutina.days) {
      for (const gid of [...listaMusculos(d.goalMain), ...listaMusculos(d.goalSide)]) {
        for (const m of GRUPOS.find((g) => g.id === gid)?.muscles ?? []) s.add(m);
      }
    }
    return s;
  }, [rutina]);
  const hayObjetivos = declarados.size > 0;

  if (partes.length === 0) return null;

  const intactos = bloques.filter((b) => b.total === 0 && b.colateral === 0);
  const declaradoSinTocar = hayObjetivos
    ? intactos.filter((b) => declarados.has(b.bloque.id)).map((b) => b.bloque.label)
    : [];
  const sinTocar = hayObjetivos
    ? intactos.filter((b) => !declarados.has(b.bloque.id)).map((b) => b.bloque.label)
    : intactos.map((b) => b.bloque.label);
  const soloRebote = bloques.filter((b) => b.total === 0 && b.colateral > 0).map((b) => b.bloque.label);
  const conHuecos = bloques.filter((b) => b.total > 0 && b.vacias.length > 0).map((b) => b.bloque.label);
  // La proporción: un bloque puede estar «tocado» y aun así casi sin trabajo.
  // La vara de medir es la media de tus propios bloques entrenados, no un
  // número de manual: se avisa cuando uno no llega ni a un tercio de ella.
  const entrenados = bloques.filter((b) => b.total > 0);
  const media = entrenados.length ? Math.round(entrenados.reduce((n, b) => n + b.total, 0) / entrenados.length) : 0;
  const escasos = entrenados
    .filter((b) => entrenados.length > 1 && b.total * 3 <= media)
    .map((b) => `${b.bloque.label} (${b.total})`);

  return (
    <section className="section mc-bloque">
      {/* Sin conmutador: en Analíticas este es el bloque del final de la
          pantalla y no compite con nada, así que se ve entero. El titular se
          queda de subtítulo, que es lo que hay que saber de un vistazo. */}
      <h2>Análisis de rutina &amp; Cobertura</h2>
      <p className="gy-cob-resumen">
          {declaradoSinTocar.length === 0 &&
          sinTocar.length === 0 &&
          conHuecos.length === 0 &&
          soloRebote.length === 0 &&
          escasos.length === 0
            ? 'todos los bloques completos'
            : [
                declaradoSinTocar.length > 0
                  ? `declarado y sin tocar: ${declaradoSinTocar.join(', ').toLowerCase()}`
                  : null,
                sinTocar.length > 0
                  ? `${hayObjetivos ? 'fuera de tus objetivos' : 'sin tocar'}: ${sinTocar.join(', ').toLowerCase()}`
                  : null,
                soloRebote.length > 0 ? `solo de rebote: ${soloRebote.join(', ').toLowerCase()}` : null,
                escasos.length > 0 ? `casi sin trabajo: ${escasos.join(', ').toLowerCase()}` : null,
                conHuecos.length > 0 ? `con huecos: ${conHuecos.join(', ').toLowerCase()}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
      </p>

      <div className="gy-cob">
        {bloques.map(({ bloque, partes: suyas, total, colateral, vacias }) => {
          const estado =
            total === 0 ? (colateral > 0 ? 'parcial' : 'cero') : vacias.length === 0 ? 'bien' : 'parcial';
          const abiertoEste = abierto === bloque.id;
          return (
            <div key={bloque.id} className={`gy-bl ${estado}`}>
              <button className="gy-bl-head" onClick={() => setAbierto(abiertoEste ? null : bloque.id)}>
                <span className="gy-bl-n">{bloque.label}</span>
                <span className="gy-bl-s">
                  {total} {total === 1 ? 'serie' : 'series'}
                  {colateral > 0 && ` +${colateral} de rebote`}
                </span>
                <span className="gy-bl-e">
                  {total === 0 && colateral > 0
                    ? 'solo de rebote'
                    : estado === 'bien'
                      ? 'bloque completo'
                      : estado === 'cero'
                        ? hayObjetivos
                          ? declarados.has(bloque.id)
                            ? 'declarado y sin tocar'
                            : 'fuera de tus objetivos'
                          : 'sin tocar'
                        : `falta ${vacias.length} de ${suyas.length}`}
                </span>
                <span className="gy-bl-chev">{abiertoEste ? '▾' : '▸'}</span>
              </button>

              {abiertoEste && (
                <div className="gy-bl-partes">
                  {suyas.map((parte) => {
                    const n = trabajo.prin.get(parte.id) ?? 0;
                    const c = trabajo.col.get(parte.id) ?? 0;
                    return (
                      <div key={parte.id} className={`gy-parte${n === 0 && c === 0 ? ' vacia' : ''}`}>
                        <span className="gy-parte-n">{parte.label}</span>
                        <span className="gy-parte-s">{n === 0 && c > 0 ? `${c} de rebote` : n}</span>
                        {n === 0 && c === 0 && (
                          <span className="gy-parte-idea">
                            probaría con {parte.ideas.slice(0, 2).join(' o ')}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="muted mc-vacio">
        «Bloque completo» quiere decir que cada parte tiene al menos un ejercicio, no que el volumen sea el correcto.
        «De rebote» es trabajo colateral: el bíceps en un jalón cuenta como trabajo que existe, pero no como entrenar
        bíceps. Y «casi sin trabajo» compara cada bloque con la media de TUS bloques entrenados —ahora {media} series
        por vuelta— y avisa por debajo de un tercio de ella, no contra un número de manual.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- objetivo

export function Objetivo({ rutina }: { rutina: Rutina }) {
  const [metas, setMetas] = useState<MetaGym[]>([]);
  const [condiciones, setCondiciones] = useState<Condicionante[]>([]);
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<MetaGym | null>(null);
  const [creandoCond, setCreandoCond] = useState(false);
  const [editandoCond, setEditandoCond] = useState<Condicionante | null>(null);

  const cargar = useCallback(async () => setMetas(await gymApi.objetivos()), []);
  const cargarCond = useCallback(async () => setCondiciones(await gymApi.condicionantes()), []);
  useEffect(() => {
    cargar();
    cargarCond();
  }, [cargar, cargarCond]);

  const fase = metas.find((m) => m.kind === 'fase' && m.status === 'activo');
  const activas = metas.filter((m) => m.status === 'activo' && m.kind !== 'fase');
  const logradas = metas.filter((m) => m.status === 'logrado');
  const ejercicios = rutina.days.flatMap((d) => d.exercises);

  return (
    <div>
      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>A dónde voy</h2>
          <button className="btn ghost sm" onClick={() => setCreando(true)}>
            + Objetivo
          </button>
        </div>

        {fase ? (
          <button className="gy-fase" onClick={() => setEditando(fase)}>
            <span className="gy-fase-et">Fase actual</span>
            <span className="gy-fase-t">{fase.title}</span>
            {fase.notes && <span className="gy-fase-n">{fase.notes}</span>}
          </button>
        ) : (
          <p className="muted mc-vacio">
            Sin fase marcada. Añade un objetivo del tipo «fase» (hipertrofia, fuerza, definición) y el resto de la
            pantalla se lee con ese contexto.
          </p>
        )}

        {activas.length === 0 ? (
          <p className="muted mc-vacio">Ninguna meta medible todavía.</p>
        ) : (
          <div className="mk-grid">
            {activas.map((m) => (
              <TarjetaMeta key={m.id} meta={m} ejercicios={ejercicios} onAbrir={() => setEditando(m)} />
            ))}
          </div>
        )}
      </section>

      {/* El seguimiento del pesaje mide contra la meta de peso activa; escribe
          en el mismo dato del Diario, no en uno nuevo. */}
      <Pesaje metas={metas} />

      {/* Los condicionantes no son metas: son con lo que se entrena. Por eso van
          en su propio bloque y no mezclados con lo que quieres conseguir. */}
      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>Condicionantes</h2>
          <button className="btn ghost sm" onClick={() => setCreandoCond(true)}>
            + Condicionante
          </button>
        </div>

        {condiciones.filter((c) => c.status === 'activo').length === 0 ? (
          <p className="muted mc-vacio">
            Nada apuntado. Aquí van las lesiones y limitaciones con las que entrenas (una SLAP en el hombro, una
            rodilla delicada): salen avisando en los ejercicios de esa zona.
          </p>
        ) : (
          <div className="gy-conds">
            {condiciones
              .filter((c) => c.status === 'activo')
              .map((c) => (
                <button key={c.id} className={`gy-cond ${c.severity}`} onClick={() => setEditandoCond(c)}>
                  <span className="gy-cond-t">
                    {c.title}
                    {c.side !== 'na' && <span className="gy-cond-lado">{c.side}</span>}
                  </span>
                  <span className="gy-cond-m">
                    {c.severity === 'evitar' ? 'Evitar' : 'Con cuidado'}
                    {listaMusculos(c.muscles).length > 0 && ` · ${listaMusculos(c.muscles).map(nombreMusculo).join(', ')}`}
                  </span>
                  {c.advice && <span className="gy-cond-a">{c.advice}</span>}
                </button>
              ))}
          </div>
        )}
      </section>

      {logradas.length > 0 && (
        <section className="section mc-bloque">
          <h2>Logradas</h2>
          <div className="mk-grid mc-hechos">
            {logradas.map((m) => (
              <TarjetaMeta key={m.id} meta={m} ejercicios={ejercicios} onAbrir={() => setEditando(m)} />
            ))}
          </div>
        </section>
      )}

      {(creandoCond || editandoCond) && (
        <CondicionanteModal
          condicionante={editandoCond ?? undefined}
          onClose={() => {
            setCreandoCond(false);
            setEditandoCond(null);
          }}
          onGuardado={() => {
            setCreandoCond(false);
            setEditandoCond(null);
            cargarCond();
          }}
        />
      )}

      {(creando || editando) && (
        <MetaModal
          meta={editando ?? undefined}
          ejercicios={ejercicios}
          onClose={() => {
            setCreando(false);
            setEditando(null);
          }}
          onGuardado={() => {
            setCreando(false);
            setEditando(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}

function TarjetaMeta({
  meta,
  ejercicios,
  onAbrir,
}: {
  meta: MetaGym;
  ejercicios: Ejercicio[];
  onAbrir: () => void;
}) {
  const objetivo = meta.targetValue == null ? null : Number(meta.targetValue);
  const salida = meta.startValue == null ? null : Number(meta.startValue);
  const ahora = meta.current;

  // El avance se mide desde donde saliste, no desde cero: ir de 79 a 80 kg es un
  // 0 % recorrido, no un 99 %. Sin punto de salida no se pinta aro: un
  // porcentaje que no significa nada es peor que ninguno.
  let pct: number | null = null;
  if (objetivo != null && ahora != null && salida != null && objetivo !== salida) {
    pct = Math.max(0, Math.min(100, Math.round(((ahora - salida) / (objetivo - salida)) * 100)));
  }

  const unidad = meta.unit || (meta.kind === 'peso' || meta.kind === 'ejercicio' ? 'kg' : '');
  const nombreEj = meta.exerciseId ? ejercicios.find((e) => e.id === meta.exerciseId)?.name : null;

  return (
    <button className={`mk pr-card${meta.status === 'logrado' ? ' hecho' : ''}`} onClick={onAbrir}>
      {pct != null && (
        <span className="mk-aro" style={{ ['--pct' as string]: `${pct}%` }} aria-hidden="true">
          <span className="mk-aro-n">{pct}%</span>
        </span>
      )}
      <span className="mk-txt">
        <span className="mk-t">{meta.title}</span>
        <span className="mk-sub">
          {ahora != null && objetivo != null
            ? `${salida != null && salida !== ahora ? `${salida} → ` : ''}${ahora} → ${objetivo} ${unidad}`.trim()
            : objetivo != null
              ? `objetivo ${objetivo} ${unidad}`.trim()
              : 'sin número'}
          {nombreEj ? ` · ${nombreEj}` : ''}
          {meta.currentDate ? ` · medido ${hace(meta.currentDate)}` : ''}
        </span>
        {meta.kind === 'peso' && ahora == null && (
          <span className="pr-senales">
            <span className="pr-senal parado">apunta tu peso en Salud · Diario</span>
          </span>
        )}
      </span>
    </button>
  );
}

/** Una fila de ejercicio en la rutina: nombre, objetivo y músculo en gris. */
function FilaEjercicio({ e, onClick }: { e: Ejercicio; onClick: () => void }) {
  return (
    <button className="gy-ej" onClick={onClick}>
      <span className="gy-ej-txt">
        <span className="gy-ej-n">{e.name}</span>
        <span className="gy-ej-obj">
          {e.targetSets} × {e.targetReps}
          {e.targetWeight ? ` · ${txtPesoKg(e.targetWeight, e.barKg)}` : ''}
          {e.restSeconds ? ` · ${e.restSeconds}s` : ''}
        </span>
        {listaMusculos(e.muscles).length > 0 && (
          <span className="gy-ej-m">{listaMusculos(e.muscles).map(nombreMusculo).join(' · ')}</span>
        )}
      </span>
    </button>
  );
}

