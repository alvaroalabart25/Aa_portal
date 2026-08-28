import { useCallback, useEffect, useState } from 'react';
import { EditorRico } from '../tasks/components';
import { passkeysSoportadas } from '../../lib/passkeys';
import {
  abrirPersona,
  cerrarPersona,
  hayPase,
  personaApi,
  type EntradaPersona,
  type MesDePersona,
} from './api';

/**
 * Persona: conocerse escribiendo.
 *
 * De momento es un diario y una pregunta. Nada de fichas ni de tests: lo
 * primero es coger el hábito de vomitar lo que tienes en la cabeza, y para eso
 * hace falta una caja en blanco y una excusa para empezar. Cuando esto tenga
 * forma sabremos qué más hace falta.
 *
 * Cerrado con llave, y de verdad: la puerta la abre Face ID y el pase vive solo
 * en esta pestaña. Al recargar, al volver mañana o al cerrar el módulo, se
 * vuelve a pedir. El servidor tampoco sirve nada sin ese pase, así que no es un
 * candado de pantalla.
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

export default function PersonaPage() {
  const [abierto, setAbierto] = useState(hayPase());
  const [abriendo, setAbriendo] = useState(false);
  const [error, setError] = useState('');
  const [datos, setDatos] = useState<MesDePersona | null>(null);
  const [meses, setMeses] = useState<{ mes: string; dias: number }[]>([]);
  const [viejos, setViejos] = useState<Record<string, EntradaPersona[]>>({});
  const [mesAbierto, setMesAbierto] = useState<string | null>(null);
  const [etiqueta, setEtiqueta] = useState('');

  const cargar = useCallback(async () => {
    const [m, ms] = await Promise.all([personaApi.mes(), personaApi.meses().catch(() => [])]);
    setDatos(m);
    setMeses(ms);
  }, []);

  useEffect(() => {
    if (abierto) void cargar().catch(() => cerrar());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  // Al salir de la pantalla se cierra: volver a entrar vuelve a pedir la cara.
  useEffect(() => {
    return () => cerrarPersona();
  }, []);

  function cerrar() {
    cerrarPersona();
    setDatos(null);
    setAbierto(false);
  }

  async function abrir(otroDispositivo = false) {
    setAbriendo(true);
    setError('');
    try {
      await abrirPersona(otroDispositivo);
      setAbierto(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo abrir';
      setError(/NotAllowed|abort/i.test(msg) ? 'Se canceló' : msg);
    } finally {
      setAbriendo(false);
    }
  }

  if (!abierto) {
    return (
      <div className="pe-cerrado">
        <span className="pe-candado" aria-hidden="true">
          ⌘
        </span>
        <h1>Persona</h1>
        <p className="muted">
          Lo que escribes aquí es solo tuyo. Se abre con Face ID cada vez, aunque ya hayas entrado en el portal.
        </p>
        {passkeysSoportadas() ? (
          <>
            <button className="btn" disabled={abriendo} onClick={() => abrir()}>
              {abriendo ? 'Abriendo…' : 'Abrir con Face ID'}
            </button>
            {/* Salida para el ordenador que no tiene la llave en su llavero:
                el navegador saca el QR y se firma con el iPhone. */}
            <button className="pe-otro" disabled={abriendo} onClick={() => abrir(true)}>
              Usar otro dispositivo
            </button>
          </>
        ) : (
          <p className="muted">Este navegador no tiene Face ID. Entra desde el móvil o registra una llave en Configuración.</p>
        )}
        {error && <p className="error-msg">{error}</p>}
      </div>
    );
  }

  if (!datos) return <p className="muted">Abriendo…</p>;

  const deHoy = datos.entradas.find((e) => e.fecha === datos.hoy);
  const anteriores = datos.entradas.filter((e) => e.fecha !== datos.hoy);
  const otrosMeses = meses.filter((m) => m.mes !== datos.mes);

  async function abrirMes(mes: string) {
    if (mesAbierto === mes) return setMesAbierto(null);
    setMesAbierto(mes);
    if (!viejos[mes]) {
      const m = await personaApi.mes(mes);
      setViejos((v) => ({ ...v, [mes]: m.entradas }));
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Persona</h1>
        <button className="btn ghost sm" onClick={cerrar}>
          Cerrar
        </button>
      </div>
      <p className="muted page-sub">
        Escribe lo que tengas en la cabeza. Sin orden y sin que tenga que servir para nada: con el tiempo, esto dice
        quién eres mejor que cualquier lista de rasgos.
      </p>

      <div className="section pe-hoy">
        <div className="bit-cab">
          <h2>{diaLargo(datos.hoy)}</h2>
          <span className="muted bit-guardado">{etiqueta}</span>
        </div>
        {/* La pregunta es una excusa para arrancar, no un formulario: la caja
            admite cualquier cosa y se puede ignorar sin más. */}
        <p className="pe-pregunta">{datos.pregunta}</p>
        <EditorRico
          key={datos.hoy}
          value={deHoy?.texto ?? null}
          onSave={async (texto) => {
            await personaApi.guardar(datos.hoy, texto, datos.pregunta);
            await cargar();
          }}
          onEstado={setEtiqueta}
          placeholder="Vomita lo que tengas…"
        />
      </div>

      {anteriores.map((e) => (
        <div key={e.fecha} className="bit-dia pe-dia">
          <span className="bit-fecha">{diaLargo(e.fecha)}</span>
          {e.pregunta && <p className="pe-pregunta pe-pregunta-vieja">{e.pregunta}</p>}
          <EditorRico
            value={e.texto}
            onSave={async (texto) => {
              await personaApi.guardar(e.fecha, texto, e.pregunta);
              await cargar();
            }}
            barra="alEnfocar"
          />
        </div>
      ))}

      {otrosMeses.length > 0 && (
        <div className="nt-viejos">
          {otrosMeses.map((m) => (
            <div key={m.mes} className="nt-mes">
              <button className="nt-mes-t" onClick={() => abrirMes(m.mes)}>
                <span className={`chev${mesAbierto === m.mes ? ' open' : ''}`}>›</span>
                {mesLargo(m.mes)}
                <em>
                  {m.dias} {m.dias === 1 ? 'día' : 'días'}
                </em>
              </button>
              {mesAbierto === m.mes &&
                (viejos[m.mes] ?? []).map((e) => (
                  <div key={e.fecha} className="bit-dia pe-dia">
                    <span className="bit-fecha">{diaLargo(e.fecha)}</span>
                    {e.pregunta && <p className="pe-pregunta pe-pregunta-vieja">{e.pregunta}</p>}
                    <EditorRico
                      value={e.texto}
                      onSave={async (texto) => {
                        await personaApi.guardar(e.fecha, texto, e.pregunta);
                        const m2 = await personaApi.mes(m.mes);
                        setViejos((v) => ({ ...v, [m.mes]: m2.entradas }));
                      }}
                      barra="alEnfocar"
                    />
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
