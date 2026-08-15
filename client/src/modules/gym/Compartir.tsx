import { useCallback, useEffect, useState } from 'react';
import { gymApi, type Compartido, type Sugerencia } from './api';

/**
 * Lo que el otro ha cambiado y tú aún no has decidido.
 *
 * Va arriba del todo en Rutina y no solo en el aviso del móvil: un push que no
 * ves desaparece, y entonces el cambio no existe en ninguna parte. Aquí espera
 * hasta que lo resuelvas.
 */
export function Sugerencias({ onCambio }: { onCambio: () => void }) {
  const [lista, setLista] = useState<Sugerencia[]>([]);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    try {
      setLista(await gymApi.sugerencias());
    } catch {
      /* sin sugerencias no se rompe la pantalla */
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!lista.length) return null;

  async function resolver(s: Sugerencia, aceptar: boolean) {
    setOcupado(s.id);
    setAviso('');
    try {
      if (aceptar) {
        const r = await gymApi.aceptarSugerencia(s.id);
        if (r.aviso) setAviso(r.aviso);
        onCambio();
      } else {
        await gymApi.rechazarSugerencia(s.id);
      }
      await cargar();
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section className="section cp-sug">
      <h2>
        Cambios de quien comparte contigo
        <span className="cp-cuenta">{lista.length}</span>
      </h2>
      <p className="muted cp-nota">
        Son propuestas: no te cambian la rutina hasta que las cojas. Lo que descartes no vuelve. Las series, las
        repeticiones y el peso los pones tú: eso no viaja.
      </p>

      {aviso && <div className="cp-aviso">{aviso}</div>}

      <div className="cp-lista">
        {lista.map((s) => (
          <div key={s.id} className="cp-item">
            <div className="cp-item-txt">
              <span className="cp-item-t">
                <b>{s.de}</b> {verbo(s.kind)} <b>{s.name}</b>
              </span>
              <span className="cp-item-s">
                {s.dayName}
                {s.kind === 'alta' && !s.enTuListado ? ' · no está en tu listado' : ''}
              </span>
            </div>
            <div className="cp-item-btns">
              <button className="btn sm" disabled={ocupado === s.id} onClick={() => resolver(s, true)}>
                Cogerlo
              </button>
              {/* la decisión doble: el ejercicio no está en tu listado, así que
                  puedes quedártelo ahí sin meterlo en el día */}
              {s.kind === 'alta' && !s.enTuListado && (
                <button
                  className="btn ghost sm"
                  disabled={ocupado === s.id}
                  onClick={async () => {
                    setOcupado(s.id);
                    try {
                      await gymApi.soloAlListado(s.id);
                      setAviso(`«${s.name}» guardado en tu listado de ejercicios, sin tocar tu día.`);
                      await cargar();
                    } finally {
                      setOcupado(null);
                    }
                  }}
                >
                  Solo al listado
                </button>
              )}
              <button className="btn ghost sm" disabled={ocupado === s.id} onClick={() => resolver(s, false)}>
                Paso
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function verbo(k: Sugerencia['kind']): string {
  return k === 'alta' ? 'ha añadido' : 'ha quitado';
}

/**
 * Con quién compartes la rutina.
 *
 * Se comparte por una key que se pasa por fuera del portal, igual que las
 * invitaciones: así nadie necesita ver la lista de cuentas y se mantiene que
 * una cuenta no sepa que las otras existen.
 */
export function Compartir({ onCambio }: { onCambio: () => void }) {
  const [lista, setLista] = useState<Compartido[]>([]);
  const [key, setKey] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [creando, setCreando] = useState(false);
  const [canjeando, setCanjeando] = useState(false);
  const [entrada, setEntrada] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState('');
  const [hecho, setHecho] = useState('');

  const cargar = useCallback(async () => {
    try {
      setLista(await gymApi.compartido());
    } catch {
      /* no bloquea la pantalla */
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function generar() {
    setError('');
    setCreando(true);
    try {
      const r = await gymApi.crearKey();
      setKey(r.code);
      setCopiado(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreando(false);
    }
  }

  async function canjear() {
    setError('');
    setHecho('');
    setCanjeando(true);
    try {
      const r = await gymApi.canjearKey(entrada.trim().toUpperCase());
      setHecho(`Listo: tienes ${r.dias} ${r.dias === 1 ? 'sesión' : 'sesiones'} de ${r.con}, con ${r.ejercicios} ejercicios.`);
      setEntrada('');
      await cargar();
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCanjeando(false);
    }
  }

  return (
    <section className="section">
      <button className="cp-head" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
        <h2>Compartir la rutina</h2>
        <span className="cp-resumen">
          {lista.length ? `con ${lista.map((c) => c.con).join(', ')}` : 'con nadie'} · {abierto ? 'cerrar' : 'abrir'}
        </span>
      </button>

      {abierto && (
        <div className="cp-cuerpo">
          <p className="muted cp-nota">
            Quien canjee tu key se lleva una <b>copia</b> de tus sesiones. Desde ese momento cada uno edita la suya y,
            cuando uno cambia algo, al otro le llega como sugerencia. <b>No viajan los kilos ni tus notas.</b>
          </p>

          {lista.length > 0 && (
            <div className="cp-lista">
              {lista.map((c) => (
                <div key={c.pairId} className="cp-item">
                  <div className="cp-item-txt">
                    <span className="cp-item-t">
                      <b>{c.con}</b>
                    </span>
                    <span className="cp-item-s">
                      {c.sesiones.length
                        ? `Compartís: ${c.sesiones.map((s) => s.name).join(' · ')}`
                        : 'Ya no compartís ninguna sesión'}
                    </span>
                  </div>
                  <button
                    className="btn ghost sm"
                    onClick={async () => {
                      if (!confirm(`¿Dejar de compartir con ${c.con}? Cada uno se queda su rutina tal cual; solo dejan de llegar avisos.`))
                        return;
                      await gymApi.dejarDeCompartir(c.pairId);
                      await cargar();
                    }}
                  >
                    Dejar de compartir
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="cp-bloques">
            <div className="cp-bloque">
              <h3>Darle mi rutina a alguien</h3>
              {key ? (
                <>
                  <code className="cp-key">{key}</code>
                  <div className="cp-key-btns">
                    <button
                      className="btn sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(key);
                          setCopiado(true);
                        } catch {
                          setCopiado(false);
                        }
                      }}
                    >
                      {copiado ? 'Copiada ✓' : 'Copiar'}
                    </button>
                    <button className="btn ghost sm" onClick={() => setKey('')}>
                      Ocultar
                    </button>
                  </div>
                  <p className="cp-pista">
                    Pásasela y que la meta abajo. Vale <b>una vez</b> y caduca en 7 días. No se puede volver a ver:
                    cópiala ahora.
                  </p>
                </>
              ) : (
                <button className="btn sm" disabled={creando} onClick={generar}>
                  {creando ? 'Generando…' : 'Generar una key'}
                </button>
              )}
            </div>

            <div className="cp-bloque">
              <h3>Tengo la key de alguien</h3>
              <input
                value={entrada}
                onChange={(e) => setEntrada(e.target.value.toUpperCase())}
                placeholder="XXXXX-XXXXX-XXXXX-X"
                style={{ width: '100%', letterSpacing: 1 }}
                aria-label="Key de la otra persona"
              />
              <p className="cp-pista">Te llevarás una copia de su rutina, además de la tuya.</p>
              <button className="btn sm" disabled={canjeando || entrada.trim().length < 4} onClick={canjear}>
                {canjeando ? 'Trayendo su rutina…' : 'Traer su rutina'}
              </button>
            </div>
          </div>

          {error && <div className="error-msg" style={{ marginTop: 12 }}>{error}</div>}
          {hecho && <div className="cp-aviso" style={{ marginTop: 12 }}>{hecho}</div>}
        </div>
      )}
    </section>
  );
}
