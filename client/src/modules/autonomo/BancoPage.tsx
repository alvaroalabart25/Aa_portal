import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { bancoApi, type ConexionBanco, type MovimientoBanco } from './api';
import MesDeVerdad from './MesDeVerdad';

/**
 * Banco: el mes de verdad arriba, la fontanería debajo.
 *
 * Nació como banco de pruebas para contestar una pregunta antes de diseñar
 * nada: ¿qué datos da de verdad cada banco? Ya está contestada con Santander,
 * Ibercaja y Revolut delante, y de ahí salió la primera pantalla (`MesDeVerdad`)
 * y el tipo automático de cada movimiento.
 *
 * Lo de debajo —conexiones, cuentas y últimos movimientos— sigue siendo lo que
 * era: se autoriza en la web del propio banco, el portal nunca ve las claves y
 * solo puede leer.
 */
/**
 * Tapa lo que el banco no debería estar mandando.
 *
 * Santander mete el número COMPLETO de la tarjeta dentro del concepto de
 * algunas compras («…, TARJETA 5163…»). Es cosa suya, pero pintarlo en
 * pantalla lo convierte en cosa nuestra: se deja solo la cola, como con el
 * IBAN. No se toca lo guardado, solo lo que se ve.
 */
/**
 * ¿Tiene sentido enseñar el botón de sincronizar?
 *
 * Cuando el banco dice que ya no acepta más consultas hoy, un botón que se sabe
 * que va a fallar solo sirve para que lo pulses y te lleves el mismo aviso. Se
 * esconde hasta la hora que dijo el servidor, y vuelve solo.
 */
function enEspera(c: ConexionBanco): boolean {
  return Boolean(c.reintentarDesde && new Date(c.reintentarDesde) > new Date());
}

function sinNumerosLargos(texto: string): string {
  return texto.replace(/\d{8,}/g, (n) => `···${n.slice(-4)}`);
}

export default function BancoPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [estado, setEstado] = useState<{ configurado: boolean; conexiones: ConexionBanco[] } | null>(null);
  const [movimientos, setMovimientos] = useState<MovimientoBanco[]>([]);
  const [bancos, setBancos] = useState<{ nombre: string; logo: string | null }[] | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [busy, setBusy] = useState('');
  // sube cada vez que llegan datos nuevos: es la señal para que el mes se
  // vuelva a calcular sin tener que pasarle el resumen desde aquí
  const [refrescar, setRefrescar] = useState(0);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    const [e, m] = await Promise.all([bancoApi.estado(), bancoApi.movimientos().catch(() => [])]);
    setEstado(e);
    setMovimientos(m);
    setRefrescar((n) => n + 1);
  }, []);

  useEffect(() => {
    void cargar().catch((e) => setError((e as Error).message));
  }, [cargar]);

  // La vuelta del banco aterriza aquí con ?code&state: se canjea y se limpia
  // la dirección, que si no queda un código de un solo uso en el historial.
  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) return;
    setBusy('vuelta');
    bancoApi
      .vuelta(code, state)
      .then(async (r) => {
        setAviso(`Banco conectado · ${r.cuentas} ${r.cuentas === 1 ? 'cuenta' : 'cuentas'}. Ya puedes sincronizar.`);
        await cargar();
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => {
        setBusy('');
        setParams({}, { replace: true });
      });
  }, [params, setParams, cargar]);

  async function elegirBanco() {
    setError('');
    setEligiendo(true);
    if (bancos) return;
    try {
      const lista = await bancoApi.bancos('ES');
      setBancos(lista);
    } catch (e) {
      setError((e as Error).message);
      setEligiendo(false);
    }
  }

  async function conectar(nombre: string) {
    setBusy(nombre);
    setError('');
    try {
      const r = await bancoApi.conectar(nombre);
      // se sale del portal: la autorización se hace en la web del banco
      window.location.href = r.url;
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  }

  async function sincronizar(id: number) {
    setBusy(`sync-${id}`);
    setError('');
    setAviso('');
    try {
      const r = await bancoApi.sincronizar(id);
      const traspasos = r.traspasos > 0 ? ` · ${r.traspasos} traspasos entre tus cuentas` : '';
      setAviso((r.nuevos > 0 ? `${r.nuevos} movimientos nuevos` : 'Ya estabas al día: nada nuevo') + traspasos + '.');
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Banco</h1>
      </div>
      <p className="page-sub">
        Lo que entra y sale de verdad, sin contar el dinero que solo cambia de bolsillo. Solo lectura — el portal no
        puede mover dinero ni ve tus claves.
      </p>

      {error && <div className="error-msg">{error}</div>}
      {aviso && <p className="bk-aviso">{aviso}</p>}
      {busy === 'vuelta' && <p className="muted">Terminando la conexión con tu banco…</p>}

      {estado?.conexiones.length ? <MesDeVerdad refrescar={refrescar} /> : null}

      {estado && !estado.configurado && (
        <section className="section mc-bloque">
          <h2>Sin configurar todavía</h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
            Falta dar de alta la aplicación en Enable Banking y poner sus credenciales en el servidor. Hasta
            entonces esta pantalla no puede conectarse con ningún banco.
          </p>
        </section>
      )}

      {estado?.conexiones.map((c) => (
        <section key={c.id} className="section mc-bloque">
          <div className="mc-head">
            <h2>{c.banco}</h2>
            {enEspera(c) ? (
              <span className="bk-espera">
                en espera hasta las{' '}
                {new Date(c.reintentarDesde!).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : (
              <button className="btn ghost sm" disabled={busy === `sync-${c.id}`} onClick={() => sincronizar(c.id)}>
                {busy === `sync-${c.id}` ? 'Sincronizando…' : 'Sincronizar'}
              </button>
            )}
          </div>

          <p className="bk-meta">
            {c.estado === 'activa' ? 'Conectado' : c.estado}
            {c.ultimaSync && ` · última vez ${new Date(c.ultimaSync).toLocaleString('es-ES')}`}
            {c.validoHasta && ` · permiso hasta ${new Date(c.validoHasta).toLocaleDateString('es-ES')}`}
          </p>
          {c.error && <p className="bk-error">{c.error}</p>}

          {c.cuentas.length === 0 ? (
            <p className="muted mc-vacio">Sin cuentas todavía. Sincroniza para traerlas.</p>
          ) : (
            <div className="bk-cuentas">
              {c.cuentas.map((a) => (
                <div key={a.id} className="bk-cuenta">
                  <span className="bk-cuenta-n">
                    {a.nombre || 'Cuenta'}
                    {a.iban && <span className="bk-iban"> ···{a.iban}</span>}
                  </span>
                  <span className="bk-saldo">
                    {a.saldo != null
                      ? `${Number(a.saldo).toLocaleString('es-ES', { minimumFractionDigits: 2 })} ${a.moneda}`
                      : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button
            className="gy-quitar-dia"
            onClick={async () => {
              if (!confirm(`¿Desconectar ${c.banco}? Los movimientos ya leídos se quedan en el portal.`)) return;
              await bancoApi.desconectar(c.id);
              await cargar();
            }}
          >
            Desconectar este banco
          </button>
        </section>
      ))}

      {estado?.configurado && (
        <section className="section mc-bloque">
          {!eligiendo ? (
            <button className="btn" onClick={elegirBanco}>
              + Conectar un banco
            </button>
          ) : !bancos ? (
            <p className="muted">Cargando la lista de bancos…</p>
          ) : (
            <>
              <div className="mc-head">
                <h2>¿Cuál es tu banco?</h2>
                <button className="btn ghost sm" onClick={() => setEligiendo(false)}>
                  Cancelar
                </button>
              </div>
              <p className="muted" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
                Te llevará a la web de tu banco para que autorices la lectura. Vuelves aquí solo.
              </p>
              <div className="bk-lista">
                {bancos.map((b) => (
                  <button key={b.nombre} className="bk-banco" disabled={!!busy} onClick={() => conectar(b.nombre)}>
                    {b.nombre}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {movimientos.length > 0 && (
        <section className="section mc-bloque">
          <h2>Últimos movimientos</h2>
          <div className="bk-movs">
            {movimientos.map((m) => (
              <div key={m.id} className="bk-mov">
                <span className="bk-mov-f">{m.fecha ? m.fecha.slice(8, 10) + '/' + m.fecha.slice(5, 7) : '—'}</span>
                <span className="bk-mov-t">
                  <b>{sinNumerosLargos(m.contraparte || m.concepto || 'Movimiento')}</b>
                  <span className="bk-mov-c">
                    {m.tipoNombre && <em className="bk-mov-tipo">{m.tipoNombre}</em>}
                    {m.contraparte && m.concepto ? sinNumerosLargos(m.concepto) : ''}
                  </span>
                </span>
                <span className={`bk-mov-i ${m.direccion === 'CRDT' ? 'entra' : 'sale'}`}>
                  {m.direccion === 'CRDT' ? '+' : '−'}
                  {Number(m.importe).toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => navigate('/autonomo/cuentas')}>
        ← Cuentas
      </button>
    </div>
  );
}
