import { useEffect, useState } from 'react';
import { obligacionesApi, type Obligaciones } from './api';

/**
 * Obligaciones: ¿voy al día y tengo apartado lo que debo?
 *
 * No es una lista de gastos, es una lista de COMPROMISOS: dinero que va a salir
 * tanto si apetece como si no, cada uno con su fecha y con la comprobación de si
 * hay con qué pagarlo. Y esa comprobación se hace contra **dinero real leído del
 * banco**, no contra un plan: una hoja de cálculo sabe lo que deberías tener
 * apartado; esto sabe lo que tienes.
 *
 * La línea que más vale es la más tonta: «sale el 31 y en esa cuenta hay 2,13 €».
 * Hoy esa información vive en dos sitios que nadie junta.
 */

const eur = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

export default function ObligacionesPage() {
  const [o, setO] = useState<Obligaciones | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    obligacionesApi
      .ver()
      .then(setO)
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="error-msg">{error}</div>;
  if (!o) return <p className="muted">Calculando lo que debes…</p>;

  const pagados = o.fijos.filter((f) => f.pagado).length;

  return (
    <div>
      <div className="page-head">
        <h1>Obligaciones</h1>
      </div>
      <p className="page-sub">Lo que debes, cuándo se paga y si tienes con qué.</p>

      {/* ------------------------------------------------------------- IVA */}
      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>IVA · {o.iva.trimestre}</h2>
          <span className="ob-cuando">
            se presenta el {fecha(o.iva.presenta)}
            {o.iva.faltanDias >= 0 && ` · en ${o.iva.faltanDias} días`}
          </span>
        </div>

        <div className="ob-cuenta">
          <div>
            <span>{o.iva.cerrado ? 'A pagar' : 'Generado hasta hoy'}</span>
            <b>{eur(o.iva.aPagar)} €</b>
          </div>
          <div>
            <span>Apartado</span>
            <b>{eur(o.iva.apartado)} €</b>
          </div>
          <div className={o.iva.faltan > 0 ? 'ob-falta' : ''}>
            <span>{o.iva.faltan > 0 ? 'Faltan' : 'Cubierto'}</span>
            <b>{o.iva.faltan > 0 ? `${eur(o.iva.faltan)} €` : '✓'}</b>
          </div>
        </div>

        <p className="ob-nota">
          {o.iva.donde.filter(Boolean).length > 0 && `Lo apartado está en ${o.iva.donde.filter(Boolean).join(' y ')}. `}
          El cargo cae el {fecha(o.iva.cobra)}, pero el importe queda fijado el {fecha(o.iva.presenta)}.
        </p>

        {!o.iva.cerrado && (
          <p className="ob-nota">
            El trimestre sigue abierto: a esto le faltan las facturas que emitas hasta el {fecha(o.iva.hasta)}.
          </p>
        )}

        {o.iva.faltanFacturas && (
          <p className="ob-nota ob-aviso">
            Hay cobros en el banco sin factura registrada en el portal, así que esta cifra es una estimación
            deducida de los importes. Registra las facturas y será exacta.
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------- deudas */}
      {o.deudas.map((d) => (
        <section key={d.id} className="section mc-bloque">
          <div className="mc-head">
            <h2>Deuda · {d.nombre}</h2>
            {d.termina && (
              <span className="ob-cuando">
                termina en{' '}
                {new Date(`${d.termina}-01`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
              </span>
            )}
          </div>

          <div className="ob-deuda">
            <b>{eur(d.queda)} €</b>
            <span>pendientes de {eur(d.total)} €</span>
          </div>

          <div className="ob-barra" aria-hidden>
            <div style={{ width: `${d.porcentaje}%` }} />
          </div>
          <p className="ob-nota">
            Pagado {eur(d.pagado)} € · el {d.porcentaje}%. A {eur(d.mensual)} €/mes desde{' '}
            {new Date(d.desde).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}.
          </p>
          <p className="ob-nota">
            {d.esteCiclo.pagado
              ? `Este ciclo ya has pagado ${eur(d.esteCiclo.importe)} €.`
              : 'Este ciclo todavía no has pagado.'}
          </p>
        </section>
      ))}

      {/* ----------------------------------------------------------- fijos */}
      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>Fijos del ciclo</h2>
          <span className="ob-cuando">
            {pagados} de {o.fijos.length} pagados
          </span>
        </div>

        {o.fijos.length === 0 ? (
          <p className="muted mc-vacio">Todavía no hay gastos que se repitan lo suficiente para reconocerlos.</p>
        ) : (
          <div className="ob-fijos">
            {o.fijos.map((f) => {
              const corto = !f.pagado && f.saldoCuenta != null && f.saldoCuenta < f.importe;
              return (
                <div key={f.nombre} className="ob-fijo">
                  <span className="ob-fijo-mark">{f.pagado ? '✓' : '·'}</span>
                  <span className="ob-fijo-t">
                    <b>{f.nombre}</b>
                    <span className="ob-fijo-c">
                      {f.dormido
                        ? `sin cargo desde el ${fecha(f.ultimo)}`
                        : f.pagado
                          ? `pagado el ${fecha(f.fecha)}`
                          : `sale el ${fecha(f.fecha)}${f.cuenta ? ` · en ${f.cuenta} hay ${eur(f.saldoCuenta ?? 0)} €` : ''}`}
                    </span>
                  </span>
                  <span className={`ob-fijo-i${corto ? ' ob-falta' : ''}`}>{eur(f.importe)}</span>
                </div>
              );
            })}
          </div>
        )}

        {o.fijos.some((f) => f.dormido) && (
          <p className="ob-nota">
            Los marcados como sin cargo llevan demasiado sin aparecer: probablemente ya no existan.
          </p>
        )}
      </section>
    </div>
  );
}
