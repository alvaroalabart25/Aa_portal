import { useEffect, useState } from 'react';
import { autonomoApi } from './api';
import { fmtEur, type QuarterSummary } from './types';

// Subtab Trimestrales: los valores a presentar, calculados en vivo desde las
// facturas de Cuentas. Informativo — la presentación la haces tú/tu gestor.
export default function TrimestralesTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarters, setQuarters] = useState<QuarterSummary[] | null>(null);

  useEffect(() => {
    autonomoApi.summary(year).then((r) => setQuarters(r.quarters));
  }, [year]);

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

  const rows = [...quarters.map((q, i) => ({ label: `T${i + 1}`, q, isCurrent: isCurrentYear && i === currentQ })), { label: `Total ${year}`, q: total, isCurrent: false }];

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
        <table className="table" style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ width: '12%' }}>Trimestre</th>
              <th>Base ingresos</th>
              <th>IVA repercutido</th>
              <th>Base gastos</th>
              <th>IVA soportado</th>
              <th>IVA a pagar (303)</th>
              <th>IRPF retenido</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} style={r.label.startsWith('Total') ? { fontWeight: 700 } : undefined}>
                <td style={{ fontWeight: 600 }}>
                  {r.label}
                  {r.isCurrent && (
                    <span className="badge" style={{ marginLeft: 8, fontSize: 11 }}>
                      actual
                    </span>
                  )}
                </td>
                <td>{fmtEur(r.q.incomeBase)}</td>
                <td>{fmtEur(r.q.incomeVat)}</td>
                <td>{fmtEur(r.q.expenseBase)}</td>
                <td>{fmtEur(r.q.expenseVat)}</td>
                <td style={{ fontWeight: 600, color: r.q.vatResult > 0 ? '#c92a2a' : r.q.vatResult < 0 ? '#2f9e44' : undefined }}>
                  {fmtEur(r.q.vatResult)}
                </td>
                <td>{fmtEur(r.q.incomeIrpf)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 12.5, marginTop: 14, lineHeight: 1.6 }}>
        <strong>IVA a pagar</strong> = repercutido (tus facturas) − soportado (tus gastos). El <strong>IRPF retenido</strong> es
        el que tus clientes ingresan a Hacienda por ti (a cuenta de tu renta). Valores informativos calculados de tus facturas —
        revisa con tu gestor antes de presentar.
      </p>
    </div>
  );
}
