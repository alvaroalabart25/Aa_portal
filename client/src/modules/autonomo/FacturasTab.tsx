import { useCallback, useEffect, useState } from 'react';
import { autonomoApi } from './api';
import NuevaFacturaModal from './NuevaFacturaModal';
import { fmtDate, fmtEur, type Invoice } from './types';

// Subtab Facturas: listado de emitidas + creación con numeración automática.
export default function FacturasTab() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [adding, setAdding] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<number | null>(null);

  const load = useCallback(async () => setInvoices(await autonomoApi.invoices({ kind: 'income' })), []);
  useEffect(() => {
    load();
  }, [load]);

  async function openPdf(id: number) {
    setPdfBusy(id);
    try {
      await autonomoApi.openPdf(id);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error generando el PDF');
    } finally {
      setPdfBusy(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button className="btn" onClick={() => setAdding(true)}>
          + Nueva factura
        </button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th style={{ width: '10%' }}>Nº</th>
            <th style={{ width: '11%' }}>Fecha</th>
            <th style={{ width: '22%' }}>Cliente</th>
            <th>Concepto</th>
            <th style={{ width: '12%' }}>Base</th>
            <th style={{ width: '12%' }}>Total</th>
            <th style={{ width: '9%' }}></th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="row" onClick={() => openPdf(inv.id)}>
              <td style={{ fontWeight: 600 }}>{inv.number}</td>
              <td>{fmtDate(inv.issueDate)}</td>
              <td>{inv.origin}</td>
              <td className="muted">{inv.concept}</td>
              <td>{fmtEur(Number(inv.base))}</td>
              <td style={{ fontWeight: 600 }}>{fmtEur(Number(inv.total))}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <button className="btn ghost sm" disabled={pdfBusy === inv.id} onClick={() => openPdf(inv.id)}>
                  {pdfBusy === inv.id ? '…' : 'PDF'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {invoices.length === 0 && <div className="empty">Aún no hay facturas emitidas.</div>}

      {adding && <NuevaFacturaModal onClose={() => setAdding(false)} onCreated={load} />}
    </div>
  );
}
