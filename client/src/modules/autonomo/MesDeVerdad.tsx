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
 * Y el periodo NO es el mes del calendario, por una razón suya: cobra del 24 al
 * 30. Un día 21, el mes natural enseña tres semanas de gasto y ningún ingreso, y
 * parece un agujero de 859 € cuando el ciclo cerrado está en +349,97. Por eso se
 * mira del 24 al 23, con el mes natural a un toque para cuando haga falta (los
 * trimestres de Hacienda sí son naturales).
 *
 * Lo que NO hay: categorías de gasto. La categoría de comercio viene vacía en
 * los tres bancos, así que etiquetar «cena» o «gasolina» sería trabajo a mano.
 */

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «24 ago», para rotular el ciclo sin que haya que interpretarlo. */
const diaMes = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${CORTOS[d.getUTCMonth()]}`;
};

const RECUERDA_CICLO = 'aa_banco_ciclo';

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

export default function MesDeVerdad({ refrescar }: { refrescar: number }) {
  // null = el periodo en curso, que lo decide el servidor: al cambiar de modo
  // el periodo vigente no es el mismo y no se puede adivinar desde aquí
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

  if (!r && cargando) return <section className="section mc-bloque"><p className="muted">Calculando el mes…</p></section>;
  if (!r) return null;

  // La escala de las barras: el mayor movimiento de cualquier semana manda.
  const tope = Math.max(...r.semanas.flatMap((s) => [s.entra, s.sale]), 1);
  const tipos = r.tipos.filter((t) => t.tipo !== 'traspaso');
  const sinClasificar = tipos.find((t) => t.tipo === 'otro');
  // La liquidación es gasto de ESTE periodo pero compras del anterior: si no se
  // dice, el mes parece peor de lo que fue.
  const credito = tipos.find((t) => t.tipo === 'liquidacion');
  const rotulo = r.ciclo ? `${diaMes(r.desde)} → ${diaMes(r.hasta)}` : nombreMes(r.mes);

  return (
    <section className="section mc-bloque">
      <div className="mv-head">
        <h2>El mes de verdad</h2>
        <div className="mv-nav">
          <button
            className="mv-flecha"
            disabled={r.mes <= r.primerMes}
            aria-label="Periodo anterior"
            onClick={() => setMes(mover(r.mes, -1))}
          >
            ‹
          </button>
          <span className="mv-mes">{rotulo}</span>
          <button
            className="mv-flecha"
            disabled={r.mes >= r.vigente}
            aria-label="Periodo siguiente"
            onClick={() => setMes(mover(r.mes, 1))}
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

      <button className="mv-modo" onClick={() => cambiarModo(!r.ciclo)}>
        {r.ciclo ? 'Estás viendo tu ciclo de cobro · ver el mes natural' : 'Estás viendo el mes natural · ver tu ciclo de cobro'}
      </button>

      {r.movimientos === 0 ? (
        <p className="muted mc-vacio">Ningún movimiento entre {diaMes(r.desde)} y {diaMes(r.hasta)}.</p>
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

          {credito && credito.sale > 0 && (
            <p className="mv-nota">
              De lo que sale, {eur(credito.sale)} € es la liquidación de la tarjeta de crédito: son compras del
              periodo anterior, cobradas en este.
            </p>
          )}

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
