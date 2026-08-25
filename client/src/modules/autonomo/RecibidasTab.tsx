import { Fragment, useCallback, useEffect, useState } from 'react';
import { autonomoApi } from './api';
import NuevoGastoModal from './NuevoGastoModal';
import { FotosDeFactura } from './FotosDeFactura';
import { fmtDate, fmtEur, type Invoice } from './types';

/**
 * Facturas recibidas: lo que te facturan a ti.
 *
 * Son el otro lado de la misma moneda que las emitidas —el IVA de un trimestre
 * es lo repercutido menos lo soportado— y hasta ahora vivían escondidas en
 * Cuentas, junto a los movimientos. Aquí están donde uno las busca.
 *
 * Cada una puede llevar su escaneo: la foto del ticket o de la factura hecha
 * con el móvil. El portal no lee la foto —los datos los pones tú— pero la
 * guarda, que es lo que le va a pedir el gestor.
 */
/** El trimestre natural de una fecha: «2026-T3». Es el de Hacienda. */
function trimestreDe(iso: string): string {
  const [anio, mes] = iso.split('-').map(Number);
  return `${anio}-T${Math.floor((mes - 1) / 3) + 1}`;
}

const mesDe = (iso: string) => iso.slice(0, 7);

/** «2026-07» → «Julio de 2026» */
function nombreMes(ym: string): string {
  const [a, m] = ym.split('-').map(Number);
  const t = new Date(a, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** «2026-T3» → «T3 2026» */
const nombreTrimestre = (t: string) => `${t.slice(5)} ${t.slice(0, 4)}`;

interface Mes {
  mes: string;
  facturas: Invoice[];
  total: number;
}

/** Las facturas repartidas por mes, de la más reciente a la más antigua. */
function porMeses(facturas: Invoice[]): Mes[] {
  const caja = new Map<string, Invoice[]>();
  for (const f of facturas) {
    const k = mesDe(f.issueDate);
    (caja.get(k) ?? caja.set(k, []).get(k)!).push(f);
  }
  return [...caja]
    .sort((a, z) => (a[0] < z[0] ? 1 : -1))
    .map(([mes, lista]) => ({ mes, facturas: lista, total: lista.reduce((n, f) => n + Number(f.total), 0) }));
}

export default function RecibidasTab() {
  const [facturas, setFacturas] = useState<Invoice[]>([]);
  const [anadiendo, setAnadiendo] = useState(false);
  const [verViejas, setVerViejas] = useState(false);

  const cargar = useCallback(async () => setFacturas(await autonomoApi.invoices({ kind: 'expense' })), []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  // El trimestre en curso es el que importa: es el que se declara. Lo anterior
  // ya está presentado y solo estorba, así que se guarda pero no se enseña.
  const hoy = new Date();
  const actual = trimestreDe(
    `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`,
  );
  const deEste = facturas.filter((f) => trimestreDe(f.issueDate) === actual);
  const viejas = facturas.filter((f) => trimestreDe(f.issueDate) !== actual);

  const mesesActual = porMeses(deEste);
  const mesesViejos = porMeses(viejas);
  const totalViejas = viejas.reduce((n, f) => n + Number(f.total), 0);

  return (
    <div>
      <div className="fx-cab">
        <span className="fx-trim">
          Trimestre en curso · {nombreTrimestre(actual)}
          {deEste.length > 0 && (
            <em>
              {deEste.length} {deEste.length === 1 ? 'factura' : 'facturas'} ·{' '}
              {fmtEur(deEste.reduce((n, f) => n + Number(f.total), 0))}
            </em>
          )}
        </span>
        <button className="btn" onClick={() => setAnadiendo(true)}>
          + Nueva factura
        </button>
      </div>

      {deEste.length === 0 ? (
        <p className="empty">
          Ninguna factura recibida en este trimestre. Añade las de tus gastos: son las que descuentan IVA.
        </p>
      ) : (
        <Tabla meses={mesesActual} onCambio={cargar} />
      )}

      {viejas.length > 0 && (
        <div className="fx-viejas">
          <button className="fx-viejas-t" onClick={() => setVerViejas(!verViejas)} aria-expanded={verViejas}>
            <span className={`chev${verViejas ? ' open' : ''}`}>›</span>
            Trimestres anteriores
            <em>
              {viejas.length} {viejas.length === 1 ? 'factura' : 'facturas'} · {fmtEur(totalViejas)}
            </em>
          </button>
          {verViejas && <Tabla meses={mesesViejos} onCambio={cargar} conTrimestre />}
        </div>
      )}

      {anadiendo && <NuevoGastoModal onClose={() => setAnadiendo(false)} onCreated={cargar} />}
    </div>
  );
}

/**
 * La tabla, con una línea de mes separando los bloques.
 *
 * Una sola tabla y no una por mes: así las columnas siguen alineadas de arriba
 * abajo y la cabecera no se repite cinco veces.
 */
function Tabla({ meses, onCambio, conTrimestre = false }: { meses: Mes[]; onCambio: () => void; conTrimestre?: boolean }) {
  return (
    <table className="table fx-tabla">
      <thead>
        <tr>
          <th style={{ width: '11%' }}>Fecha</th>
          <th style={{ width: '22%' }}>Proveedor</th>
          <th style={{ width: '11%' }}>Nº</th>
          <th>Concepto</th>
          <th style={{ width: '10%' }}>Base</th>
          <th style={{ width: '9%' }}>IVA</th>
          <th style={{ width: '11%' }}>Total</th>
          <th style={{ width: '16%' }}>Escaneo</th>
        </tr>
      </thead>
      <tbody>
        {meses.map((m) => (
          <Fragment key={m.mes}>
            <tr className="fx-mes">
              <td colSpan={8}>
                <b>{nombreMes(m.mes)}</b>
                {conTrimestre && <i>{nombreTrimestre(trimestreDe(`${m.mes}-01`))}</i>}
                <span>
                  {m.facturas.length} {m.facturas.length === 1 ? 'factura' : 'facturas'} · {fmtEur(m.total)}
                </span>
              </td>
            </tr>
            {m.facturas.map((f) => (
              <tr key={f.id} className="row">
                <td>{fmtDate(f.issueDate)}</td>
                <td style={{ fontWeight: 500 }}>{f.origin}</td>
                <td>{f.number}</td>
                <td>{f.concept ?? '—'}</td>
                <td>{fmtEur(Number(f.base))}</td>
                <td>{fmtEur(Number(f.vatAmount))}</td>
                <td style={{ fontWeight: 600 }}>{fmtEur(Number(f.total))}</td>
                <td>
                  <FotosDeFactura facturaId={f.id} fotos={f.fotos ?? []} onCambio={onCambio} />
                </td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
