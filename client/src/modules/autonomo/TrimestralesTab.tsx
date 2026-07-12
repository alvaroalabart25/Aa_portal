import { useEffect, useMemo, useState } from 'react';
import { autonomoApi } from './api';
import { fmtDate, fmtEur, type Invoice, type QuarterSummary } from './types';

function MiniList({ title, color, rows }: { title: string; color: string; rows: Invoice[] }) {
  return (
    <div>
      <h4 className="prio-sub" style={{ color, margin: '2px 0 4px' }}>
        {title} · {rows.length}
      </h4>
      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, margin: '8px 0' }}>
          Nada en este trimestre.
        </p>
      ) : (
        <table className="mini-table">
          <thead>
            <tr>
              <th>Origen</th>
              <th>Fecha</th>
              <th>Nº</th>
              <th>Base</th>
              <th>IVA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td style={{ fontWeight: 500 }}>{i.origin}</td>
                <td>{fmtDate(i.issueDate)}</td>
                <td className="muted">{i.number}</td>
                <td>{fmtEur(Number(i.base))}</td>
                <td>{fmtEur(Number(i.vatAmount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Subtab Trimestrales: valores a presentar por trimestre, con desglose
// acordeón (oculto por defecto): ingresos y gastos enfrentados.
export default function TrimestralesTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarters, setQuarters] = useState<QuarterSummary[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    setOpen(null);
    autonomoApi.summary(year).then((r) => setQuarters(r.quarters));
    autonomoApi.invoices({ year }).then(setInvoices);
  }, [year]);

  const byQuarter = useMemo(() => {
    return [0, 1, 2, 3].map((q) => {
      const rows = invoices.filter((i) => Math.floor((Number(i.issueDate.slice(5, 7)) - 1) / 3) === q);
      return {
        income: rows.filter((i) => i.kind === 'income'),
        expense: rows.filter((i) => i.kind === 'expense'),
      };
    });
  }, [invoices]);

  if (!quarters) return <p className="muted" style={{ marginTop: 18 }}>Calculando…</p>;

  const currentQ = Math.floor(new Date().getMonth() / 3);
  const isCurrentYear = year === new Date().getFullYear();

  const total = quarters.reduce(
    (a, q) => ({
      incomeBase: a.incomeBase + q.incomeBase,
      incomeVat: a.incomeVat + q.incomeVat,
      incomeIrpf: a.incomeIrpf + q.incomeIrpf,
      expenseBase: a.expenseBase + q.expenseBase,
      expenseVat: a.expenseVat + q.expenseVat,
      vatResult: a.vatResult + q.vatResult,
    }),
    { incomeBase: 0, incomeVat: 0, incomeIrpf: 0, expenseBase: 0, expenseVat: 0, vatResult: 0 },
  );

  return (
    <div>
      <div style={{ marginTop: 18 }}>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Año">
          {[year + 1, year, year - 1, year - 2]
            .filter((v, i, arr) => arr.indexOf(v) === i)
            .sort((a, b) => b - a)
            .map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
        </select>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th style={{ width: '13%' }}>Trimestre</th>
              <th>Base ingresos</th>
              <th>IVA repercutido</th>
              <th>Base gastos</th>
              <th>IVA soportado</th>
              <th>IVA a pagar (303)</th>
              <th>IRPF retenido</th>
            </tr>
          </thead>
          <tbody>
            {quarters.map((q, i) => {
              const hasData = byQuarter[i].income.length + byQuarter[i].expense.length > 0;
              const isOpen = open === i;
              return [
                <tr
                  key={`q${i}`}
                  className={hasData ? 'row' : undefined}
                  onClick={() => hasData && setOpen(isOpen ? null : i)}
                  title={hasData ? 'Clic para ver el desglose' : undefined}
                >
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    <span className="muted" style={{ display: 'inline-block', width: 14 }}>
                      {hasData ? (isOpen ? '▾' : '▸') : ''}
                    </span>
                    T{i + 1}
                    {isCurrentYear && i === currentQ && (
                      <span className="badge" style={{ marginLeft: 8, fontSize: 11 }}>
                        actual
                      </span>
                    )}
                  </td>
                  <td>{fmtEur(q.incomeBase)}</td>
                  <td>{fmtEur(q.incomeVat)}</td>
                  <td>{fmtEur(q.expenseBase)}</td>
                  <td>{fmtEur(q.expenseVat)}</td>
                  <td style={{ fontWeight: 600, color: q.vatResult > 0 ? '#c92a2a' : q.vatResult < 0 ? '#2f9e44' : undefined }}>
                    {fmtEur(q.vatResult)}
                  </td>
                  <td>{fmtEur(q.incomeIrpf)}</td>
                </tr>,
                isOpen ? (
                  <tr key={`d${i}`} className="q-detail">
                    <td colSpan={7}>
                      <div className="q-breakdown">
                        <MiniList title="Ingresos" color="#2f9e44" rows={byQuarter[i].income} />
                        <MiniList title="Gastos" color="#c92a2a" rows={byQuarter[i].expense} />
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
            <tr style={{ fontWeight: 700 }}>
              <td style={{ paddingLeft: 24 }}>Total {year}</td>
              <td>{fmtEur(total.incomeBase)}</td>
              <td>{fmtEur(total.incomeVat)}</td>
              <td>{fmtEur(total.expenseBase)}</td>
              <td>{fmtEur(total.expenseVat)}</td>
              <td style={{ color: total.vatResult > 0 ? '#c92a2a' : total.vatResult < 0 ? '#2f9e44' : undefined }}>
                {fmtEur(total.vatResult)}
              </td>
              <td>{fmtEur(total.incomeIrpf)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 12.5, marginTop: 14, lineHeight: 1.6 }}>
        Clic en un trimestre para ver su desglose. <strong>IVA a pagar</strong> = repercutido (tus facturas) − soportado (tus
        gastos). El <strong>IRPF retenido</strong> es el que tus clientes ingresan a Hacienda por ti (a cuenta de tu renta).
        Valores informativos calculados de tus facturas — revisa con tu gestor antes de presentar.
      </p>
    </div>
  );
}
