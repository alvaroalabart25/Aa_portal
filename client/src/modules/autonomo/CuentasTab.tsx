import { useCallback, useEffect, useMemo, useState } from 'react';
import { autonomoApi } from './api';
import NuevoGastoModal from './NuevoGastoModal';
import { fmtDate, fmtEur, fmtPct, monthName, type Invoice } from './types';

const QUARTER_LABEL = ['T1 · ene-mar', 'T2 · abr-jun', 'T3 · jul-sep', 'T4 · oct-dic'];

function sumRows(rows: Invoice[]) {
  const t = { total: 0, base: 0, vat: 0, irpf: 0 };
  for (const i of rows) {
    t.total += Number(i.total);
    t.base += Number(i.base);
    t.vat += Number(i.vatAmount);
    t.irpf += Number(i.irpfAmount);
  }
  return t;
}

function GroupTable({ label, color, rows }: { label: string; color: string; rows: Invoice[] }) {
  if (rows.length === 0) return null;
  const totals = sumRows(rows);
  return (
    <>
      <h3 className="prio-sub" style={{ color }}>
        {label} · {rows.length}
      </h3>
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
                <td style={{ fontWeight: 500 }}>{i.origin}</td>
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
          <tfoot>
            <tr style={{ fontWeight: 700 }}>
              <td colSpan={4} style={{ textTransform: 'uppercase', fontSize: 12, letterSpacing: '0.04em' }}>
                Total {label.toLowerCase()}
              </td>
              <td>{fmtEur(totals.total)}</td>
              <td>{fmtEur(totals.base)}</td>
              <td></td>
              <td>{fmtEur(totals.vat)}</td>
              <td></td>
              <td>{fmtEur(totals.irpf)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

// Subtab Cuentas: movimientos agrupados por trimestre, con Ingresos y Gastos
// separados, totales por grupo y resultado (ingresos - gastos).
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

  const rows = useMemo(() => all.filter((i) => i.issueDate.startsWith(String(year))), [all, year]);

  const now = new Date();
  const currentQ = Math.floor(now.getMonth() / 3);
  const isCurrentYear = year === now.getFullYear();

  const quarters = useMemo(() => {
    return [0, 1, 2, 3].map((q) => {
      const qRows = rows.filter((i) => Math.floor((Number(i.issueDate.slice(5, 7)) - 1) / 3) === q);
      const income = qRows.filter((i) => i.kind === 'income');
      const expense = qRows.filter((i) => i.kind === 'expense');
      return { q, income, expense, has: qRows.length > 0 };
    });
  }, [rows]);

  const yearIncome = sumRows(rows.filter((i) => i.kind === 'income'));
  const yearExpense = sumRows(rows.filter((i) => i.kind === 'expense'));

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

      {quarters
        .filter((qt) => qt.has || (isCurrentYear && qt.q === currentQ))
        .map((qt) => {
          const inc = sumRows(qt.income);
          const exp = sumRows(qt.expense);
          return (
            <section key={qt.q} className="section">
              <h2>
                {QUARTER_LABEL[qt.q]}
                {isCurrentYear && qt.q === currentQ && (
                  <span className="badge" style={{ marginLeft: 10, fontSize: 11, verticalAlign: 'middle' }}>
                    trimestre actual
                  </span>
                )}
              </h2>

              {!qt.has && <div className="empty">Sin movimientos todavía en este trimestre.</div>}
              <GroupTable label="Ingresos" color="#2f9e44" rows={qt.income} />
              <GroupTable label="Gastos" color="#c92a2a" rows={qt.expense} />

              {qt.has && (
                <p className="quarter-result">
                  Resultado {QUARTER_LABEL[qt.q].slice(0, 2)} (base imponible): {fmtEur(inc.base)} ingresos − {fmtEur(exp.base)} gastos ={' '}
                  <strong>{fmtEur(inc.base - exp.base)}</strong>
                </p>
              )}
            </section>
          );
        })}

      {rows.length > 0 && (
        <section className="section">
          <h2>Resultado {year}</h2>
          <p className="quarter-result" style={{ fontSize: 15 }}>
            {fmtEur(yearIncome.base)} ingresos − {fmtEur(yearExpense.base)} gastos ={' '}
            <strong>{fmtEur(yearIncome.base - yearExpense.base)}</strong>{' '}
            <span className="muted">(base imponible)</span>
          </p>
        </section>
      )}
      {rows.length === 0 && <div className="empty">Sin movimientos en {year}.</div>}

      {adding && <NuevoGastoModal onClose={() => setAdding(false)} onCreated={load} />}
    </div>
  );
}
