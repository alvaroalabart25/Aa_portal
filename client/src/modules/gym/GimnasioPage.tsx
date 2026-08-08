import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  gymApi,
  hace,
  kg,
  listaMusculos,
  MUSCULOS,
  nombreMusculo,
  type DiaRutina,
  type Ejercicio,
  type Condicionante,
  type MetaGym,
  type Parte,
  type Rutina,
  type Sesion,
  type SesionHistorial,
} from './api';
import { CondicionanteModal, EjercicioModal, MetaModal } from './modals';

type Vista = 'entrenar' | 'rutina' | 'objetivo';

const VISTAS: [Vista, string][] = [
  ['entrenar', 'Entrenar'],
  ['rutina', 'Rutina'],
  ['objetivo', 'Objetivo'],
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
  const vista: Vista = pedida === 'rutina' || pedida === 'objetivo' ? pedida : 'entrenar';
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

      {!rutina ? (
        <p className="muted">Cargando…</p>
      ) : vista === 'entrenar' ? (
        <Entrenar rutina={rutina} />
      ) : vista === 'rutina' ? (
        <LaRutina rutina={rutina} onCambio={cargar} />
      ) : (
        <Objetivo rutina={rutina} />
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
  const [historial, setHistorial] = useState<SesionHistorial[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    gymApi.sesionAbierta().then(setAbierta).catch(() => {});
    gymApi.historial(8).then(setHistorial).catch(() => {});
  }, []);

  // Con una sesión abierta no se enseña «te toca»: estarías leyendo que te toca
  // Espalda mientras tienes Pecho a medias justo encima. Primero se cierra o se
  // tira lo que hay.
  const toca = useMemo(() => (abierta ? null : siguienteDia(rutina.days)), [rutina.days, abierta]);
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
      {abierta && (
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

      {toca && (
        <section className="section mc-bloque">
          <div className="mc-head">
            <h2>Te toca</h2>
            <span className="muted" style={{ fontSize: 12.5 }}>
              última vez {hace(toca.lastDone)}
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

      <section className="section mc-bloque">
        <h2>{toca ? 'Los otros días' : 'Los días de la rutina'}</h2>
        <div className="mk-grid">
          {resto.map((d) => (
            <div key={d.id} className="mk">
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
              <div key={h.id} className="gy-hist-fila">
                <span className="gy-hist-f">{fechaCorta(h.sessionDate)}</span>
                <span className="gy-hist-d">{h.dayName}</span>
                <span className="gy-hist-n">
                  {h.sets} series
                  {h.volume ? ` · ${Math.round(Number(h.volume)).toLocaleString('es-ES')} kg` : ''}
                  {duracion(h) ? ` · ${duracion(h)}` : ''}
                </span>
              </div>
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

function duracion(h: SesionHistorial): string | null {
  if (!h.endedAt) return null;
  const min = Math.round((new Date(h.endedAt).getTime() - new Date(h.startedAt).getTime()) / 60000);
  if (min <= 0 || min > 300) return null;
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

// ---------------------------------------------------------------- la rutina

function LaRutina({ rutina, onCambio }: { rutina: Rutina; onCambio: () => void }) {
  const [editando, setEditando] = useState<{ dayId: number; ejercicio?: Ejercicio } | null>(null);

  return (
    <div>
      <Cobertura rutina={rutina} />

      {rutina.days.map((d) => (
        <section key={d.id} className="section mc-bloque">
          <div className="mc-head">
            <h2>
              <NombreDia dia={d} onCambio={onCambio} />
            </h2>
            <button className="btn ghost sm" onClick={() => setEditando({ dayId: d.id })}>
              + Ejercicio
            </button>
          </div>

          {d.exercises.length === 0 ? (
            <p className="muted mc-vacio">Sin ejercicios todavía.</p>
          ) : (
            <div className="gy-lista">
              {d.exercises.map((e) => (
                <button key={e.id} className="gy-ej" onClick={() => setEditando({ dayId: d.id, ejercicio: e })}>
                  <span className="gy-ej-txt">
                    <span className="gy-ej-n">{e.name}</span>
                    <span className="gy-ej-obj">
                      {e.targetSets} × {e.targetReps}
                      {e.targetWeight ? ` · ${kg(e.targetWeight)}` : ''}
                      {e.restSeconds ? ` · ${e.restSeconds}s` : ''}
                    </span>
                    {/* el músculo, en pequeño y gris: está para consultarlo, no para leerlo */}
                    {listaMusculos(e.muscles).length > 0 && (
                      <span className="gy-ej-m">{listaMusculos(e.muscles).map(nombreMusculo).join(' · ')}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ))}

      {editando && (
        <EjercicioModal
          dayId={editando.dayId}
          ejercicio={editando.ejercicio}
          onClose={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            onCambio();
          }}
        />
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
 */
function Cobertura({ rutina }: { rutina: Rutina }) {
  const [partes, setPartes] = useState<Parte[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);

  useEffect(() => {
    gymApi.partes().then(setPartes).catch(() => {});
  }, []);

  const series = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of rutina.days) {
      for (const e of d.exercises) {
        for (const parte of listaMusculos(e.parts)) m.set(parte, (m.get(parte) ?? 0) + e.targetSets);
      }
    }
    return m;
  }, [rutina]);

  const bloques = useMemo(() => {
    return MUSCULOS.map((bloque) => {
      const suyas = partes.filter((p) => p.muscle === bloque.id);
      const total = suyas.reduce((n, p) => n + (series.get(p.id) ?? 0), 0);
      const vacias = suyas.filter((p) => !series.get(p.id));
      return { bloque, partes: suyas, total, vacias };
    }).filter((b) => b.partes.length > 0);
  }, [partes, series]);

  const [desplegado, setDesplegado] = useState(false);

  if (partes.length === 0) return null;

  const sinTocar = bloques.filter((b) => b.total === 0).map((b) => b.bloque.label);
  const conHuecos = bloques.filter((b) => b.total > 0 && b.vacias.length > 0).map((b) => b.bloque.label);

  return (
    <section className="section mc-bloque">
      {/* Trece bloques desplegados son media pantalla de scroll antes de llegar a
          la rutina. Cerrado deja el titular, que es lo único que hay que saber
          casi siempre: qué falta. */}
      <button className="gy-cob-toggle" onClick={() => setDesplegado((v) => !v)} aria-expanded={desplegado}>
        <span className="gy-cob-chev">{desplegado ? '▾' : '▸'}</span>
        <h2>Cobertura</h2>
        <span className="gy-cob-resumen">
          {sinTocar.length === 0 && conHuecos.length === 0
            ? 'todos los bloques completos'
            : [
                sinTocar.length > 0 ? `sin tocar: ${sinTocar.join(', ').toLowerCase()}` : null,
                conHuecos.length > 0 ? `con huecos: ${conHuecos.join(', ').toLowerCase()}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </span>
      </button>

      {desplegado && (
      <>
      <div className="gy-cob">
        {bloques.map(({ bloque, partes: suyas, total, vacias }) => {
          const estado = total === 0 ? 'cero' : vacias.length === 0 ? 'bien' : 'parcial';
          const abiertoEste = abierto === bloque.id;
          return (
            <div key={bloque.id} className={`gy-bl ${estado}`}>
              <button className="gy-bl-head" onClick={() => setAbierto(abiertoEste ? null : bloque.id)}>
                <span className="gy-bl-n">{bloque.label}</span>
                <span className="gy-bl-s">
                  {total} {total === 1 ? 'serie' : 'series'}
                </span>
                <span className="gy-bl-e">
                  {estado === 'bien'
                    ? 'bloque completo'
                    : estado === 'cero'
                      ? 'sin tocar'
                      : `falta ${vacias.length} de ${suyas.length}`}
                </span>
                <span className="gy-bl-chev">{abiertoEste ? '▾' : '▸'}</span>
              </button>

              {abiertoEste && (
                <div className="gy-bl-partes">
                  {suyas.map((parte) => {
                    const n = series.get(parte.id) ?? 0;
                    return (
                      <div key={parte.id} className={`gy-parte${n === 0 ? ' vacia' : ''}`}>
                        <span className="gy-parte-n">{parte.label}</span>
                        <span className="gy-parte-s">{n}</span>
                        {n === 0 && (
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
        «Bloque completo» solo quiere decir que hay al menos un ejercicio por cada parte, no que el volumen sea el
        correcto. El número de series es orientativo: suele hablarse de unas 10 por bloque a la semana, pero eso lo
        decides tú, no el portal.
      </p>
      </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- objetivo

function Objetivo({ rutina }: { rutina: Rutina }) {
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
