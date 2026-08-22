import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { bancoApi, type ConexionBanco } from './api';
import MesDeVerdad from './MesDeVerdad';
import MovimientosTab from './MovimientosTab';

/**
 * Banco, en dos mitades.
 *
 * **Resumen** es lo que se mira a diario: cuánto tienes y cómo va el ciclo.
 * **Cuentas** es lo de debajo: qué bancos hay conectados, con qué saldo, y el
 * libro entero de movimientos con sus filtros.
 *
 * La fontanería (autorizar, sincronizar, desconectar) vive en Cuentas porque se
 * toca una vez al mes; el resumen no debería tener botones que dan miedo.
 */

/** Tapa el número de tarjeta que Santander mete dentro del concepto. */
function enEspera(c: ConexionBanco): boolean {
  return Boolean(c.reintentarDesde && new Date(c.reintentarDesde) > new Date());
}

export default function BancoPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [estado, setEstado] = useState<{ configurado: boolean; conexiones: ConexionBanco[] } | null>(null);
  const [bancos, setBancos] = useState<{ nombre: string; logo: string | null }[] | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [busy, setBusy] = useState('');
  const [refrescar, setRefrescar] = useState(0);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');

  const tab = params.get('tab') === 'cuentas' ? 'cuentas' : 'resumen';
  const irA = (t: string) => setParams(t === 'resumen' ? {} : { tab: t }, { replace: true });

  const cargar = useCallback(async () => {
    const e = await bancoApi.estado();
    setEstado(e);
    setRefrescar((n) => n + 1);
  }, []);

  useEffect(() => {
    void cargar().catch((e) => setError((e as Error).message));
  }, [cargar]);

  // La vuelta del banco aterriza aquí con ?code&state: se canjea y se limpia la
  // dirección, que si no queda un código de un solo uso en el historial.
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
        setParams({ tab: 'cuentas' }, { replace: true });
      });
  }, [params, setParams, cargar]);

  async function elegirBanco() {
    setError('');
    setEligiendo(true);
    if (bancos) return;
    try {
      setBancos(await bancoApi.bancos('ES'));
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
      window.location.href = r.url; // la autorización se hace en la web del banco
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
      await cargar();
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Banco</h1>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'resumen'} className={tab === 'resumen' ? 'active' : ''} onClick={() => irA('resumen')}>
            Resumen
          </button>
          <button role="tab" aria-selected={tab === 'cuentas'} className={tab === 'cuentas' ? 'active' : ''} onClick={() => irA('cuentas')}>
            Cuentas
          </button>
        </div>
      </div>
      <p className="page-sub">
        {tab === 'resumen'
          ? 'Lo que tienes y cómo va el ciclo, sin contar el dinero que solo cambia de bolsillo.'
          : 'Tus bancos y el libro entero de movimientos. Solo lectura — el portal no puede mover dinero.'}
      </p>

      {error && <div className="error-msg">{error}</div>}
      {aviso && <p className="bk-aviso">{aviso}</p>}
      {busy === 'vuelta' && <p className="muted">Terminando la conexión con tu banco…</p>}

      {estado && !estado.configurado && (
        <section className="section mc-bloque">
          <h2>Sin configurar todavía</h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
            Falta dar de alta la aplicación en Enable Banking y poner sus credenciales en el servidor.
          </p>
        </section>
      )}

      {tab === 'resumen' ? (
        <>
          {estado?.conexiones.length ? <MesDeVerdad refrescar={refrescar} /> : null}

          <section className="section mc-bloque">
            <div className="mc-head">
              <h2>Inversiones</h2>
              <span className="ob-cuando">sin conectar</span>
            </div>
            <p className="wg-nota">
              Coinbase entra por su API. Revolut Invest no lo da PSD2: habrá que declararlo.
            </p>
          </section>
        </>
      ) : (
        <>
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
                        {a.ajena && <span className="bk-iban"> · no es tuyo</span>}
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

          <section className="section mc-bloque">
            <div className="mc-head">
              <h2>Movimientos</h2>
            </div>
            <MovimientosTab />
          </section>
        </>
      )}

      <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => navigate('/autonomo/obligaciones')}>
        ← Obligaciones
      </button>
    </div>
  );
}
