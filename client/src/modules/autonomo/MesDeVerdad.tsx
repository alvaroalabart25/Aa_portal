import { useEffect, useState } from 'react';
import { bancoApi, type ResumenMes } from './api';

/**
 * El resumen del dinero: cuánto tienes y cómo va el ciclo.
 *
 * Dos ideas gobiernan lo que se enseña. La primera: **el patrimonio es solo lo
 * tuyo**; el IVA que guardas en el pocket se debe, y sumarlo sería mentir. La
 * segunda: **el 42% de los movimientos no son ni ingresos ni gastos**, son
 * traspasos entre cuentas propias, y sin descontarlos el ciclo se hincha por
 * miles de euros.
 *
 * Y el periodo NO es el mes del calendario: cobra del 24 al 30, así que un día
 * 21 el mes natural enseñaba tres semanas de gasto y ningún ingreso —agosto
 * salía en −859 € cuando el ciclo cerrado estaba en +342—.
 */

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const eur = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const nombreMes = (mes: string) => {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${a}`;
};

const diaMes = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${CORTOS[d.getUTCMonth()]}`;
};

const mover = (mes: string, pasos: number) => {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + pasos, 1)).toISOString().slice(0, 7);
};

const RECUERDA_CICLO = 'aa_banco_ciclo';

export default function MesDeVerdad({ refrescar }: { refrescar: number }) {
  const [mes, setMes] = useState<string | null>(null);
  const [ciclo, setCiclo] = useState(() => localStorage.getItem(RECUERDA_CICLO) !== 'no');
  const [r, setR] = useState<ResumenMes | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    bancoApi
      .resumen(mes ?? undefined, ciclo)
      .then((x) => vivo && setR(x))
      .catch(() => vivo && setR(null))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [mes, ciclo, refrescar]);

  function cambiarModo(aCiclo: boolean) {
    localStorage.setItem(RECUERDA_CICLO, aCiclo ? 'si' : 'no');
    setMes(null);
    setCiclo(aCiclo);
  }

  if (!r && cargando) return <section className="section mc-bloque"><p className="muted">Calculando…</p></section>;
  if (!r) return null;

  const tope = Math.max(...r.semanas.flatMap((s) => [s.entra, s.sale]), 1);
  const rotulo = r.ciclo ? `${diaMes(r.desde)} → ${diaMes(r.hasta)}` : nombreMes(r.mes);

  return (
    <>
      {/* El número que contesta «¿cuánto tengo?». Va en negro porque es EL dato */}
      <section className="section mc-bloque oscuro">
        <span className="wg-etiqueta">Tu patrimonio</span>
        <b className="wg-grande">{eur(r.saldo.total)} €</b>
        <span className="wg-pie">
          en {r.saldo.propias} {r.saldo.propias === 1 ? 'cuenta' : 'cuentas'}
          {r.saldo.ajeno > 0 && ` · ${eur(r.saldo.ajeno)} € más guardados para Hacienda, que no son tuyos`}
        </span>
      </section>

      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>El ciclo</h2>
          <div className="mv-nav">
            <button className="mv-flecha" disabled={r.mes <= r.primerMes} aria-label="Anterior" onClick={() => setMes(mover(r.mes, -1))}>
              ‹
            </button>
            <span className="mv-mes">{rotulo}</span>
            <button className="mv-flecha" disabled={r.mes >= r.vigente} aria-label="Siguiente" onClick={() => setMes(mover(r.mes, 1))}>
              ›
            </button>
          </div>
        </div>

        {r.movimientos === 0 ? (
          <p className="muted mc-vacio">Ningún movimiento en este periodo.</p>
        ) : (
          <>
            <div className="mv-cifras">
              <div>
                <span>Entra</span>
                <b>{eur(r.entra)} €</b>
              </div>
              <div>
                <span>Sale</span>
                <b>{eur(r.sale)} €</b>
              </div>
              <div className={r.queda >= 0 ? '' : 'mv-mal'}>
                <span>Diferencia</span>
                <b>
                  {r.queda < 0 && '−'}
                  {eur(Math.abs(r.queda))} €
                </b>
              </div>
            </div>

            <div className="mv-semanas">
              {r.semanas.map((s) => (
                <div key={s.etiqueta} className="mv-semana">
                  <span className="mv-dias">{s.etiqueta}</span>
                  <div className="mv-barras">
                    {s.entra > 0 && <div className="mv-barra entra" style={{ width: `${(100 * s.entra) / tope}%` }} />}
                    {s.sale > 0 && <div className="mv-barra sale" style={{ width: `${(100 * s.sale) / tope}%` }} />}
                  </div>
                  <span className="mv-cifra-semana">
                    {s.entra > 0 && <em className="entra">+{eur(s.entra)}</em>}
                    {s.sale > 0 && <em className="sale">−{eur(s.sale)}</em>}
                  </span>
                </div>
              ))}
            </div>

            {r.traspasos.n > 0 && (
              <p className="wg-nota">
                {r.traspasos.n} traspasos entre tus cuentas descontados ({eur(r.traspasos.importe)} €).
              </p>
            )}
          </>
        )}

        <button className="mv-modo" onClick={() => cambiarModo(!r.ciclo)}>
          {r.ciclo ? 'ver el mes natural' : 'ver tu ciclo de cobro'}
        </button>
      </section>

      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>Tus espacios</h2>
        </div>
        <div className="wg-espacios">
          {r.saldo.cuentas.map((c) => (
            <div key={c.id} className="wg-espacio">
              <span className="wg-espacio-n">
                {c.nombre || c.banco}
                {c.iban && <em> ···{c.iban}</em>}
              </span>
              <span className={`wg-espacio-s${c.ajena ? ' ajena' : ''}`}>
                {c.saldo != null ? `${eur(c.saldo)} €` : '—'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
