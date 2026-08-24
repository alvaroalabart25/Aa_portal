import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../../components/Modal';
import { eventsApi } from '../events/api';
import type { ImportantEvent } from '../events/types';
import { focusApi, type Plan, type PlanItem } from './api';

/**
 * La plani: los objetivos colocados en el tiempo.
 *
 * Macro contesta «qué tengo entre manos este mes». Esto contesta otra cosa que
 * mes a mes no se puede ver: **cuándo sale cada cosa**, cuando hay proyectos
 * que llegan hasta enero.
 *
 * La unidad es la SEMANA, porque es como se piensa —«la primera semana de
 * septiembre», «a mediados de octubre»— y porque un objetivo no tiene día. Se
 * arrastra por semanas; las fechas exactas se ponen en la ficha.
 */

const SEMANAS = 26; // medio año: suficiente para llegar a enero desde agosto

const dosCifras = (n: number) => String(n).padStart(2, '0');
const isoDe = (d: Date) => `${d.getFullYear()}-${dosCifras(d.getMonth() + 1)}-${dosCifras(d.getDate())}`;
/** Mediodía a propósito: así ningún cambio de hora mueve un día de sitio. */
const fecha = (iso: string) => new Date(`${iso}T12:00:00`);

const masDias = (iso: string, n: number) => {
  const d = fecha(iso);
  d.setDate(d.getDate() + n);
  return isoDe(d);
};

/** El lunes de la semana de esa fecha. La semana empieza en lunes, como aquí. */
function lunesDe(iso: string): string {
  const d = fecha(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDe(d);
}

const diasEntre = (a: string, b: string) => Math.round((fecha(b).getTime() - fecha(a).getTime()) / 86400000);

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «2026-09-07» → «7 sep» */
const cortita = (iso: string) => `${fecha(iso).getDate()} ${MES_CORTO[fecha(iso).getMonth()]}`;

interface Arrastre {
  id: number;
  desde: string;
  hasta: string;
}

export default function PlanTab() {
  const [plan, setPlan] = useState<Plan | null>(null);
  // Bodas, viajes: lo que hay que tener delante al planificar sin que sea una
  // fila más. Solo los puntuales; los que se repiten llenarían la franja.
  const [eventos, setEventos] = useState<ImportantEvent[]>([]);
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);
  const [creando, setCreando] = useState(false);
  const pistaRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(
    () =>
      Promise.all([focusApi.plan(), eventsApi.list().catch(() => [])]).then(([p, e]) => {
        setPlan(p);
        setEventos(e.filter((x) => x.recurrence === 'none'));
      }),
    [],
  );
  useEffect(() => {
    void cargar();
  }, [cargar]);

  // El calendario arranca el lunes de esta semana: la plani mira hacia delante
  const inicio = useMemo(() => lunesDe(plan?.hoy ?? isoDe(new Date())), [plan?.hoy]);

  /** En qué columna cae una fecha. Puede salirse del rango: se recorta al pintar. */
  const columna = useCallback((iso: string) => Math.floor(diasEntre(inicio, lunesDe(iso)) / 7), [inicio]);

  /** Las cabeceras de mes, con cuántas semanas ocupa cada uno. */
  const meses = useMemo(() => {
    const grupos: { etiqueta: string; semanas: number }[] = [];
    for (let i = 0; i < SEMANAS; i += 1) {
      const d = fecha(masDias(inicio, i * 7));
      const etiqueta = MES_CORTO[d.getMonth()];
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.etiqueta === etiqueta) ultimo.semanas += 1;
      else grupos.push({ etiqueta, semanas: 1 });
    }
    return grupos;
  }, [inicio]);

  /** Los eventos repartidos por semana, para la franja de fechas. */
  const porSemana = useMemo(() => {
    const cajas: ImportantEvent[][] = Array.from({ length: SEMANAS }, () => []);
    for (const ev of eventos) {
      const c = Math.floor(diasEntre(inicio, lunesDe(ev.eventDate)) / 7);
      if (c >= 0 && c < SEMANAS) cajas[c].push(ev);
    }
    return cajas;
  }, [eventos, inicio]);

  if (!plan) return <p className="empty">Cargando la plani…</p>;

  const colocados = plan.items.filter((i) => i.dueOn);
  const sinFecha = plan.items.filter((i) => !i.dueOn);

  /** Lo que se está arrastrando manda sobre lo guardado, para que se vea al mover. */
  const tramo = (i: PlanItem) => {
    if (arrastre?.id === i.id) return { desde: arrastre.desde, hasta: arrastre.hasta };
    return { desde: i.startsOn ?? i.dueOn!, hasta: i.dueOn! };
  };

  /**
   * Mover o estirar una barra. `borde` dice qué se agarra: la barra entera, o
   * uno de sus dos extremos. Se cuenta en SEMANAS, que es la unidad del sitio.
   */
  function agarrar(e: ReactPointerEvent, i: PlanItem, borde: 'todo' | 'inicio' | 'fin') {
    e.preventDefault();
    e.stopPropagation();
    const pista = pistaRef.current;
    if (!pista) return;
    const anchoSemana = pista.getBoundingClientRect().width / SEMANAS;
    const x0 = e.clientX;
    const { desde, hasta } = tramo(i);
    let cur: Arrastre = { id: i.id, desde, hasta };
    let movido = false;

    const onMove = (ev: PointerEvent) => {
      const semanas = Math.round((ev.clientX - x0) / anchoSemana);
      if (semanas !== 0) movido = true;
      if (borde === 'todo') {
        cur = { id: i.id, desde: masDias(desde, semanas * 7), hasta: masDias(hasta, semanas * 7) };
      } else if (borde === 'inicio') {
        // el inicio no puede pasarse del fin
        const nuevo = masDias(desde, semanas * 7);
        cur = { id: i.id, desde: nuevo > hasta ? hasta : nuevo, hasta };
      } else {
        const nuevo = masDias(hasta, semanas * 7);
        cur = { id: i.id, desde, hasta: nuevo < desde ? desde : nuevo };
      }
      setArrastre(cur);
    };

    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setArrastre(null);
      if (!movido) return;
      // Si la barra dura una sola semana se guarda como hito: sin fecha de
      // inicio. Así no se llena la plani de barras de una semana.
      const unaSemana = lunesDe(cur.desde) === lunesDe(cur.hasta);
      await focusApi.editar(i.id, {
        startsOn: unaSemana ? null : cur.desde,
        dueOn: cur.hasta,
      });
      await cargar();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /** Poner un objetivo sin fecha en esta semana, para poder arrastrarlo. */
  async function colocar(i: PlanItem) {
    await focusApi.editar(i.id, { dueOn: masDias(inicio, 6) });
    await cargar();
  }

  const porAmbito = (ambito: 'trabajo' | 'personal') => colocados.filter((i) => i.scope === ambito);

  return (
    <div>
      <div className="mc-head">
        <h2>La plani</h2>
        <button className="btn ghost sm" onClick={() => setCreando(true)}>
          + Objetivo
        </button>
      </div>
      <p className="muted mc-vacio">
        Cuándo sale cada cosa, por semanas. Arrastra una barra para moverla y sus extremos para alargarla. Toca el
        nombre para ver sus tareas.
      </p>

      <div className="pla-wrap">
        <div className="pla" style={{ ['--sem' as string]: SEMANAS }}>
          <div className="pla-cab">
            <span className="pla-nombre pla-esquina" />
            <div className="pla-pista pla-meses" ref={pistaRef}>
              {meses.map((m, n) => (
                <span
                  key={`${m.etiqueta}-${n}`}
                  className="pla-mes"
                  style={{ width: `calc(${m.semanas} * var(--sw))` }}
                >
                  {m.etiqueta}
                </span>
              ))}
            </div>
          </div>

          {porSemana.some((s) => s.length > 0) && (
            <div className="pla-fila pla-hitos">
              <span className="pla-nombre pla-hitos-t">Fechas</span>
              <div className="pla-pista">
                {porSemana.map((deEsa, n) => (
                  <span key={n} className="pla-sem">
                    {deEsa.map((ev) => (
                      <span key={ev.id} className="pla-evento" title={`${ev.title} · ${ev.eventDate}`}>
                        {ev.emoji}
                      </span>
                    ))}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(['trabajo', 'personal'] as const).map((ambito) => {
            const suyos = porAmbito(ambito);
            if (suyos.length === 0) return null;
            return (
              <div key={ambito} className="pla-grupo">
                <span className="pla-grupo-t">{ambito === 'trabajo' ? 'Trabajo' : 'Personal'}</span>
                {suyos.map((i) => {
                  const { desde, hasta } = tramo(i);
                  const c0 = Math.max(0, columna(desde));
                  const c1 = Math.min(SEMANAS - 1, Math.max(c0, columna(hasta)));
                  const hecho = i.status === 'hecho';
                  return (
                    <div key={i.id} className="pla-fila">
                      <Link to={`/macro/${i.id}`} className="pla-nombre">
                        <span className="pla-nombre-t">{i.title}</span>
                        <span className="pla-nombre-s">
                          {hecho
                            ? 'hecho'
                            : i.total === 0
                              ? 'sin tareas'
                              : `${i.pendientes} pendiente${i.pendientes === 1 ? '' : 's'}`}
                          {i.enMarcha > 0 && ` · ${i.enMarcha} en marcha`}
                        </span>
                      </Link>
                      <div className="pla-pista">
                        {Array.from({ length: SEMANAS }, (_, n) => (
                          <span key={n} className={`pla-sem${n === 0 ? ' hoy' : ''}`} />
                        ))}
                        <span
                          className={`pla-barra${hecho ? ' hecho' : ''}${arrastre?.id === i.id ? ' moviendo' : ''}`}
                          style={{
                            left: `${(100 * c0) / SEMANAS}%`,
                            width: `${(100 * (c1 - c0 + 1)) / SEMANAS}%`,
                          }}
                          onPointerDown={(e) => agarrar(e, i, 'todo')}
                          title={`${cortita(desde)} → ${cortita(hasta)}`}
                        >
                          <span className="pla-tirador iz" onPointerDown={(e) => agarrar(e, i, 'inicio')} />
                          {/* La fecha solo cabe dentro si la barra dura dos
                              semanas o más; en un hito va fuera, al lado. */}
                          {c1 > c0 && <span className="pla-barra-t">{hecho ? '✓' : cortita(hasta)}</span>}
                          <span className="pla-tirador de" onPointerDown={(e) => agarrar(e, i, 'fin')} />
                        </span>
                        {c1 === c0 && (
                          <span className="pla-etq" style={{ left: `${(100 * (c0 + 1)) / SEMANAS}%` }}>
                            {hecho ? '✓' : cortita(hasta)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {sinFecha.length > 0 && (
        <section className="section mc-bloque">
          <div className="mc-head">
            <h2>Sin colocar</h2>
            <span className="ob-cuando">{sinFecha.length}</span>
          </div>
          <p className="muted mc-vacio">Están vivos pero no tienen fecha de salida, así que no salen arriba.</p>
          <div className="pla-sueltos">
            {sinFecha.map((i) => (
              <span key={i.id} className="pla-suelto">
                <Link to={`/macro/${i.id}`}>{i.title}</Link>
                <button onClick={() => colocar(i)}>colocar esta semana</button>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>Todos los objetivos</h2>
          <span className="ob-cuando">{plan.items.length}</span>
        </div>
        <p className="muted mc-vacio">Colocados y sin colocar, para saber de qué se compone el plan.</p>
        <div className="pla-lista">
          {plan.items.map((i) => (
            <Link key={i.id} to={`/macro/${i.id}`} className="pla-lista-f">
              <span className="pla-lista-t">{i.title}</span>
              <span className="pla-lista-d">
                {i.scope === 'trabajo' ? 'Trabajo' : 'Personal'}
                {' · '}
                {i.status === 'hecho' ? 'hecho' : i.total === 0 ? 'sin tareas' : `${i.pendientes} pendientes`}
              </span>
              <span className="pla-lista-c">
                {i.dueOn ? (i.startsOn ? `${cortita(i.startsOn)} → ${cortita(i.dueOn)}` : cortita(i.dueOn)) : 'sin fecha'}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {creando && (
        <NuevoEnLaPlani
          semanaPorDefecto={masDias(inicio, 6)}
          onCerrar={() => setCreando(false)}
          onCreado={async () => {
            setCreando(false);
            await cargar();
          }}
        />
      )}
    </div>
  );
}

/**
 * Crear un objetivo YA colocado. Nace con su fecha de salida puesta, porque
 * crear uno aquí es justamente decir cuándo sale.
 */
function NuevoEnLaPlani({
  semanaPorDefecto,
  onCerrar,
  onCreado,
}: {
  semanaPorDefecto: string;
  onCerrar: () => void;
  onCreado: () => void;
}) {
  const [titulo, setTitulo] = useState('');
  const [ambito, setAmbito] = useState<'trabajo' | 'personal'>('trabajo');
  const [sale, setSale] = useState(semanaPorDefecto);
  const [empieza, setEmpieza] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function crear() {
    if (!titulo.trim() || guardando) return;
    setGuardando(true);
    try {
      await focusApi.crear({
        kind: 'melon',
        scope: ambito,
        title: titulo.trim(),
        startsOn: empieza || null,
        dueOn: sale || null,
      });
      onCreado();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal title="Nuevo objetivo" onClose={onCerrar}>
      <div className="pla-nuevo">
        <label>
          <span>Qué</span>
          <input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Redes sociales" />
        </label>
        <label>
          <span>Ámbito</span>
          <select value={ambito} onChange={(e) => setAmbito(e.target.value as 'trabajo' | 'personal')}>
            <option value="trabajo">Trabajo</option>
            <option value="personal">Personal</option>
          </select>
        </label>
        <div className="pla-nuevo-fechas">
          <label>
            <span>Empieza</span>
            <input type="date" value={empieza} onChange={(e) => setEmpieza(e.target.value)} />
          </label>
          <label>
            <span>Se saca</span>
            <input type="date" value={sale} onChange={(e) => setSale(e.target.value)} />
          </label>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>
          Sin fecha de inicio se dibuja como un hito. El mes del objetivo sale de cuándo empieza.
        </p>
        <div className="modal-actions">
          <button className="btn ghost sm" onClick={onCerrar}>
            Cancelar
          </button>
          <button className="btn sm" disabled={!titulo.trim() || guardando} onClick={crear}>
            Crear
          </button>
        </div>
      </div>
    </Modal>
  );
}
