import { useEffect, useState } from 'react';
import { bancoApi, type ResumenMes } from './api';

/**
 * El mes de verdad: lo que entra, lo que sale y lo que queda.
 *
 * Su única razón de ser es una que solo se vio midiendo: **el 42% de los
 * movimientos no son ni ingresos ni gastos**. Son traspasos entre cuentas
 * propias —de Santander a Revolut, o entre los bolsillos de Revolut— y sumarlos
 * hincha el mes por miles de euros. Aquí se descuentan, pero se dicen: el
 * número de traspasos y su importe se enseñan debajo para que se pueda
 * comprobar, en vez de tener que fiarse.
 *
 * Lo que NO hay: categorías de gasto. La categoría de comercio viene vacía en
 * los tres bancos, así que etiquetar «cena» o «gasolina» sería trabajo a mano.
 */

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const eur = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const nombreMes = (mes: string) => {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${a}`;
};

/** Mover de mes sin liarse con los finales de año. */
const mover = (mes: string, pasos: number) => {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + pasos, 1)).toISOString().slice(0, 7);
};

const HOY = new Date().toISOString().slice(0, 7);

export default function MesDeVerdad({ refrescar }: { refrescar: number }) {
  const [mes, setMes] = useState(HOY);
  const [r, setR] = useState<ResumenMes | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    bancoApi
      .resumen(mes)
      .then((x) => vivo && setR(x))
      .catch(() => vivo && setR(null))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [mes, refrescar]);

  if (!r && cargando) return <section className="section mc-bloque"><p className="muted">Calculando el mes…</p></section>;
  if (!r) return null;

  // La escala de las barras: el mayor movimiento de cualquier semana manda.
  const tope = Math.max(...r.semanas.flatMap((s) => [s.entra, s.sale]), 1);
  const tipos = r.tipos.filter((t) => t.tipo !== 'traspaso');
  const sinClasificar = tipos.find((t) => t.tipo === 'otro');

  return (
    <section className="section mc-bloque">
      <div className="mv-head">
        <h2>El mes de verdad</h2>
        <div className="mv-nav">
          <button
            className="mv-flecha"
            disabled={mes <= r.primerMes}
            aria-label="Mes anterior"
            onClick={() => setMes(mover(mes, -1))}
          >
            ‹
          </button>
          <span className="mv-mes">{nombreMes(mes)}</span>
          <button
            className="mv-flecha"
            disabled={mes >= HOY}
            aria-label="Mes siguiente"
            onClick={() => setMes(mover(mes, 1))}
          >
            ›
          </button>
        </div>
      </div>

      <div className="mv-total">
        <b>{eur(r.saldo.total)} €</b>
        <span>
          en {r.saldo.cuentas.length} {r.saldo.cuentas.length === 1 ? 'cuenta' : 'cuentas'}
          {r.saldo.at && ` · al día ${new Date(r.saldo.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
        </span>
      </div>

      {r.movimientos === 0 ? (
        <p className="muted mc-vacio">Ningún movimiento en {nombreMes(mes)}.</p>
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
            <div className={r.queda >= 0 ? 'mv-bien' : 'mv-mal'}>
              <span>Queda</span>
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
                  {/* a cero no se pinta nada: una barra de 1px parece un dato */}
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
            <p className="mv-nota">
              {r.traspasos.n} {r.traspasos.n === 1 ? 'movimiento descontado' : 'movimientos descontados'} por ser
              traspasos entre tus propias cuentas ({eur(r.traspasos.importe)} €). Ni ingreso ni gasto: el mismo dinero
              cambiando de bolsillo.
            </p>
          )}

          <div className="mv-tipos">
            {tipos.map((t) => (
              <div key={t.tipo} className="mv-tipo">
                <span className="mv-tipo-n">
                  {t.nombre}
                  <em>
                    {t.n} {t.n === 1 ? 'vez' : 'veces'}
                  </em>
                </span>
                <span className="mv-tipo-i">
                  {t.entra > 0 && <em className="entra">+{eur(t.entra)}</em>}
                  {t.sale > 0 && <em className="sale">−{eur(t.sale)}</em>}
                </span>
              </div>
            ))}
          </div>

          {sinClasificar && (
            <p className="mv-nota">
              {sinClasificar.n} sin clasificar: el portal no ha sabido de qué clase son. Se cuentan igual, no se
              esconden.
            </p>
          )}
        </>
      )}
    </section>
  );
}
