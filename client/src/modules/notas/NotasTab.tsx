import { useCallback, useEffect, useRef, useState } from 'react';
import { notasApi, type MesDeNotas, type Nota } from './api';

/**
 * El bloc de notas: lo que se apunta a vuelapluma antes de saber qué es.
 *
 * Un día con algo escrito es un bloque con su fecha en negrita; un día sin nada
 * no existe. Por eso el título del día sale UNA sola vez por muchas veces que
 * vuelvas a escribir, y por eso el bloc no se llena de días en blanco.
 *
 * Arriba siempre el de hoy, listo para escribir aunque esté vacío: es el único
 * día que se enseña sin tener nada, porque es al que vienes.
 */

/** «2026-08-25» → «Lunes, 25 de agosto» */
function diaLargo(iso: string): string {
  const t = new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** «2026-08» → «Agosto de 2026» */
function mesLargo(ym: string): string {
  const [a, m] = ym.split('-').map(Number);
  const t = new Date(a, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const mesDe = (iso: string) => iso.slice(0, 7);

export default function NotasTab() {
  const [datos, setDatos] = useState<MesDeNotas | null>(null);
  const [meses, setMeses] = useState<{ mes: string; dias: number }[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [viejas, setViejas] = useState<Record<string, Nota[]>>({});

  const cargar = useCallback(async () => {
    const [m, ms] = await Promise.all([notasApi.mes(), notasApi.meses().catch(() => [])]);
    setDatos(m);
    setMeses(ms);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** Abrir un mes anterior: se trae solo cuando se pide, no de entrada. */
  async function abrirMes(mes: string) {
    if (abierto === mes) return setAbierto(null);
    setAbierto(mes);
    if (!viejas[mes]) {
      const m = await notasApi.mes(mes);
      setViejas((v) => ({ ...v, [mes]: m.notas }));
    }
  }

  if (!datos) return <p className="empty">Cargando el bloc…</p>;

  const hoy = datos.hoy;
  const deHoy = datos.notas.find((n) => n.fecha === hoy);
  const anteriores = datos.notas.filter((n) => n.fecha !== hoy);
  // Los meses que ya están cerrados: el de en curso se ve entero arriba
  const cerrados = meses.filter((m) => m.mes !== mesDe(hoy));

  return (
    <section className="section mc-bloque">
      <div className="mc-head">
        <h2>Bloc de notas</h2>
        <span className="ob-cuando">{mesLargo(datos.mes)}</span>
      </div>
      <p className="muted mc-vacio">
        Lo que se te ocurra, sin pensar dónde va. Cada día se guarda con su fecha y se puede volver a él cuando quieras.
      </p>

      <div className="nt-dias">
        <Dia fecha={hoy} texto={deHoy?.texto ?? ''} esHoy onGuardado={cargar} />
        {anteriores.map((n) => (
          <Dia key={n.fecha} fecha={n.fecha} texto={n.texto} onGuardado={cargar} />
        ))}
      </div>

      {cerrados.length > 0 && (
        <div className="nt-viejos">
          <h3 className="mc-sub">Meses anteriores</h3>
          {cerrados.map((m) => (
            <div key={m.mes} className="nt-mes">
              <button className="nt-mes-t" onClick={() => abrirMes(m.mes)} aria-expanded={abierto === m.mes}>
                <span className={`chev${abierto === m.mes ? ' open' : ''}`}>›</span>
                {mesLargo(m.mes)}
                <em>
                  {m.dias} {m.dias === 1 ? 'día' : 'días'}
                </em>
              </button>
              {abierto === m.mes && (
                <div className="nt-dias">
                  {(viejas[m.mes] ?? []).map((n) => (
                    <Dia key={n.fecha} fecha={n.fecha} texto={n.texto} onGuardado={cargar} />
                  ))}
                  {!viejas[m.mes] && <p className="muted">Cargando…</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Un día del bloc. Se guarda solo al dejar de escribir, como las notas de un
 * objetivo: en un bloc no hay un botón de guardar que valga.
 *
 * La caja crece con lo que escribes y no al revés: una caja de diez líneas para
 * una frase ocupa media pantalla, y una de dos para media página obliga a
 * hacer scroll dentro del scroll.
 */
function Dia({
  fecha,
  texto,
  esHoy = false,
  onGuardado,
}: {
  fecha: string;
  texto: string;
  esHoy?: boolean;
  onGuardado: () => void;
}) {
  const [txt, setTxt] = useState(texto);
  const [estado, setEstado] = useState<'' | 'guardado'>('');
  const timer = useRef<number | undefined>(undefined);
  const ultimo = useRef(texto);
  const caja = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTxt(texto);
    ultimo.current = texto;
  }, [texto]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // que la caja mida lo que el texto, sin barra de scroll propia
  useEffect(() => {
    const c = caja.current;
    if (!c) return;
    c.style.height = 'auto';
    c.style.height = `${Math.max(c.scrollHeight, 46)}px`;
  }, [txt]);

  function cambiar(v: string) {
    setTxt(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      if (v === ultimo.current) return;
      ultimo.current = v;
      await notasApi.guardar(fecha, v);
      setEstado('guardado');
      window.setTimeout(() => setEstado(''), 1500);
      // Vaciar una nota la borra, y eso cambia la lista: hay que recargar.
      if (!v.trim()) onGuardado();
    }, 700);
  }

  return (
    <div className={`nt-dia${esHoy ? ' hoy' : ''}`}>
      <div className="nt-dia-t">
        <b>{diaLargo(fecha)}</b>
        {esHoy && <em>hoy</em>}
        {estado && <span className="nt-guardado">Guardado</span>}
      </div>
      <textarea
        ref={caja}
        value={txt}
        onChange={(e) => cambiar(e.target.value)}
        placeholder={esHoy ? 'Escribe lo que sea…' : ''}
        rows={1}
      />
    </div>
  );
}
