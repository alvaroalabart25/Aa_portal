import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { bancoApi, type ConexionBanco } from './api';
import MovimientosTab from './MovimientosTab';
import AnaliticasTab from './AnaliticasTab';
import PlanTab from './PlanTab';
import { OjoPrivacidad, useDinero } from './dinero';

/**
 * Bancos: la fontanería y el libro.
 *
 * Qué bancos hay conectados, con qué saldo, autorizar y sincronizar, y el libro
 * entero de movimientos con sus filtros. Se toca una vez al mes.
 *
 * Y con ellos, lo que se DEDUCE de sus datos: las analíticas y el reparto del
 * ciclo. Viven aquí, junto a los movimientos de los que salen, y no en Resumen,
 * que es solo la foto de hoy.
 *
 * La dirección NO se cambia: `/autonomo/banco/vuelta` es el redirect registrado
 * en Enable Banking y tocarlo rompería la autorización de los tres bancos.
 */

/** Tapa el número de tarjeta que Santander mete dentro del concepto. */
function enEspera(c: ConexionBanco): boolean {
  return Boolean(c.reintentarDesde && new Date(c.reintentarDesde) > new Date());
}

export default function BancoPage() {
  const { eur } = useDinero();
  const [params, setParams] = useSearchParams();
  const [estado, setEstado] = useState<{ configurado: boolean; conexiones: ConexionBanco[] } | null>(null);
  const [bancos, setBancos] = useState<{ nombre: string; logo: string | null }[] | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [busy, setBusy] = useState('');
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');

  const pedida = params.get('tab');
  const tab = (['movimientos', 'analiticas', 'plan'] as const).find((t) => t === pedida) ?? 'cuentas';

  const cargar = useCallback(async () => {
    const e = await bancoApi.estado();
    setEstado(e);
  }, []);

  useEffect(() => {
    void cargar().catch((e) => setError((e as Error).message));
  }, [cargar]);

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

  async function sincronizar(id: number, buscarCuentas = false) {
    setBusy(buscarCuentas ? `buscar-${id}` : `sync-${id}`);
    setError('');
    setAviso('');
    try {
      const r = await bancoApi.sincronizar(id, undefined, buscarCuentas);
      const traspasos = r.traspasos > 0 ? ` · ${r.traspasos} traspasos entre tus cuentas` : '';
      // Lo primero que se quiere saber al buscar cuentas es si apareció alguna
      const cuentas = buscarCuentas
        ? r.cuentasNuevas > 0
          ? `${r.cuentasNuevas} ${r.cuentasNuevas === 1 ? 'cuenta nueva' : 'cuentas nuevas'} · `
          : 'Ninguna cuenta nueva en este permiso · '
        : '';
      setAviso(
        cuentas + (r.nuevos > 0 ? `${r.nuevos} movimientos nuevos` : 'Ya estabas al día: nada nuevo') + traspasos + '.',
      );
      // Si alguna cuenta se ha quedado fuera, se dice cuál y por qué: el resto
      // ha entrado igual, y saber cuál falla es lo que permite arreglarlo.
      if (r.fallidas?.length) setError(`No pudo entrar: ${r.fallidas.join(' · ')}`);
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
        <h1>Bancos</h1>
        <div className="page-acciones">
          <div className="seg" role="tablist">
            {(['cuentas', 'movimientos', 'analiticas', 'plan'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'active' : ''}
                onClick={() => setParams(t === 'cuentas' ? {} : { tab: t }, { replace: true })}
              >
                {t === 'cuentas'
                  ? 'Cuentas'
                  : t === 'movimientos'
                    ? 'Movimientos'
                    : t === 'analiticas'
                      ? 'Analíticas'
                      : 'Plan'}
              </button>
            ))}
          </div>
          <OjoPrivacidad />
        </div>
      </div>
      <p className="page-sub">
        {tab === 'cuentas'
          ? 'Tus bancos conectados y sus saldos. Solo lectura — el portal no puede mover dinero ni ve tus claves.'
          : tab === 'movimientos'
            ? 'El libro entero, con búsqueda y filtros.'
            : tab === 'analiticas'
              ? '¿Crece tu patrimonio? ¿De dónde entra el dinero y en qué se va?'
              : 'A dónde va cada euro de lo que entra este ciclo.'}
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

      {tab === 'cuentas' && (
        <>
          {estado?.conexiones.map((c) => (
            <section key={c.id} className="section mc-bloque">
              <div className="mc-head">
                <h2>{c.banco}</h2>
                {enEspera(c) ? (
                  <span className="bk-espera">
                    {/* El cupo del banco se repone por días, así que la espera
                        casi siempre es «mañana»: decir una hora de madrugada
                        sonaba a que se podía intentar esta noche. */}
                    {new Date(c.reintentarDesde!).toDateString() === new Date().toDateString()
                      ? `en espera hasta las ${new Date(c.reintentarDesde!).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
                      : 'cupo del día gastado · mañana vuelve'}
                  </span>
                ) : (
                  <span className="bk-acciones">
                    {/* Buscar cuentas nuevas es una llamada MÁS al banco, y los
                        bancos cuentan las llamadas por días. Por eso va aparte
                        y no en cada sincronización: se usa el día que vinculas
                        una cuenta, no todos los días. */}
                    <button
                      className="btn ghost sm"
                      disabled={busy === `buscar-${c.id}`}
                      title="Vuelve a preguntar al banco qué cuentas incluye este permiso"
                      onClick={() => sincronizar(c.id, true)}
                    >
                      {busy === `buscar-${c.id}` ? 'Buscando…' : 'Buscar cuentas'}
                    </button>
                    <button className="btn ghost sm" disabled={busy === `sync-${c.id}`} onClick={() => sincronizar(c.id)}>
                      {busy === `sync-${c.id}` ? 'Sincronizando…' : 'Sincronizar'}
                    </button>
                  </span>
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
                          ? `${eur(Number(a.saldo))} ${a.moneda}`
                          : '—'}
                      </span>
                      {/* Quitar UNA cuenta. Una autorización trae todas las que
                          el banco enseña, y a veces se cuela alguna que no
                          pinta nada aquí; desconectar el banco entero para
                          librarse de una era demasiado. */}
                      <button
                        className="bk-quitar"
                        title="Quitar esta cuenta del portal"
                        aria-label={`Quitar ${a.nombre || 'la cuenta'} del portal`}
                        onClick={async () => {
                          const aviso =
                            `¿Quitar «${a.nombre || 'esta cuenta'}» del portal?\n\n` +
                            'Se borran también sus movimientos ya leídos. Si vuelves a ' +
                            'autorizarla, entra de nuevo.';
                          if (!confirm(aviso)) return;
                          const r = await bancoApi.quitarCuenta(a.id);
                          setAviso(`Cuenta quitada · ${r.movimientos} movimientos borrados`);
                          await cargar();
                        }}
                      >
                        ✕
                      </button>
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

        </>
      )}

      {tab === 'movimientos' && (
        <section className="section mc-bloque">
          <MovimientosTab />
        </section>
      )}

      {tab === 'analiticas' && <AnaliticasTab />}
      {tab === 'plan' && <PlanTab />}

    </div>
  );
}
