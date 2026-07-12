import { useCallback, useEffect, useMemo, useState } from 'react';
import { autonomoApi } from './api';
import NuevoGastoModal from './NuevoGastoModal';
import { fmtDate, fmtEur, fmtPct, monthName, type Invoice } from './types';

// Subtab Cuentas: libro de ingresos (facturas emitidas, automático) y gastos
// (añadidos a mano). Una fila por factura, con totales del año.
export default function CuentasTab() {
  const [all, setAll] = useState<Invoice[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => setAll(await autonomoApi.invoices()), []);
  useEffect(() => {
    load();
  }, [load]);

  const years = useMemo(() => {
    const ys = new Set(all.map((i) => Number(i.issueDate.slice(0, 4))));
    ys.add(new Date().getFullYear());
    return [...ys].sort((a, b) => b - a);
  }, [all]);

  const rows = useMemo(
    () => all.filter((i) => i.issueDate.startsWith(String(year))),
    [all, year],
  );

  const totals = useMemo(() => {
    const t = { total: 0, base: 0, vat: 0, irpf: 0 };
    for (const i of rows) {
      const sign = i.kind === 'income' ? 1 : -1;
      void sign; // los totales se muestran por columna, sin compensar signos
      t.total += Number(i.total);
      t.base += Number(i.base);
      t.vat += Number(i.vatAmount);
      t.irpf += Number(i.irpfAmount);
    }
    return t;
  }, [rows]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, gap: 10, flexWrap: 'wrap' }}>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Año">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => setAdding(true)}>
          + Añadir gasto
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th>Origen</th>
              <th>Fecha emisión</th>
              <th>Mes</th>
              <th>Nº factura</th>
              <th>Importe total</th>
              <th>Base imponible</th>
              <th>% IVA</th>
              <th>Cuota IVA</th>
              <th>% IRPF</th>
              <th>Cuota IRPF</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td style={{ fontWeight: 500 }}>
                  <span
                    className="dot"
                    style={{ background: i.kind === 'income' ? '#2f9e44' : '#c92a2a', display: 'inline-block', marginRight: 8 }}
                    title={i.kind === 'income' ? 'Ingreso' : 'Gasto'}
                  />
                  {i.origin}
                </td>
                <td>{fmtDate(i.issueDate)}</td>
                <td>{monthName(i.issueDate)}</td>
                <td>{i.number}</td>
                <td style={{ fontWeight: 600 }}>{fmtEur(Number(i.total))}</td>
                <td>{fmtEur(Number(i.base))}</td>
                <td>{fmtPct(i.vatPct)}</td>
                <td>{fmtEur(Number(i.vatAmount))}</td>
                <td>{fmtPct(i.irpfPct)}</td>
                <td>{fmtEur(Number(i.irpfAmount))}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={4} style={{ textTransform: 'uppercase', fontSize: 12, letterSpacing: '0.04em' }}>
                  Totales {year}
                </td>
                <td>{fmtEur(totals.total)}</td>
                <td>{fmtEur(totals.base)}</td>
                <td></td>
                <td>{fmtEur(totals.vat)}</td>
                <td></td>
                <td>{fmtEur(totals.irpf)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.length === 0 && <div className="empty">Sin movimientos en {year}.</div>}
      <p className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
        ● verde = ingreso (se alimenta solo de tus facturas emitidas) · ● rojo = gasto (añadido a mano)
      </p>

      {adding && <NuevoGastoModal onClose={() => setAdding(false)} onCreated={load} />}
    </div>
  );
}
