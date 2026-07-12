import { useCallback, useEffect, useState } from 'react';
import { autonomoApi } from './api';
import NuevaFacturaModal from './NuevaFacturaModal';
import RevisarFacturaModal from './RevisarFacturaModal';
import EnviarFacturaModal from './EnviarFacturaModal';
import { fmtDate, fmtEur, INVOICE_STATUS, type Invoice } from './types';

// Subtab Facturas (emitidas). Flujo: 1) Crear -> 2) Revisar/aprobar -> 3) Enviar.
export default function FacturasTab() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState<Invoice | null>(null);
  const [sending, setSending] = useState<Invoice | null>(null);
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
            <th style={{ width: '15%' }}>Estado</th>
            <th style={{ width: '9%' }}>Nº</th>
            <th style={{ width: '10%' }}>Fecha</th>
            <th style={{ width: '19%' }}>Cliente</th>
            <th>Concepto</th>
            <th style={{ width: '11%' }}>Total</th>
            <th style={{ width: '17%' }}></th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const st = INVOICE_STATUS[inv.status];
            return (
              <tr key={inv.id} className="row" onClick={() => openPdf(inv.id)}>
                <td>
                  <span
                    className="badge"
                    style={{ color: st.color, fontWeight: 600 }}
                    title={inv.status === 'sent' && inv.emailedTo ? `Enviada a ${inv.emailedTo}` : undefined}
                  >
                    <span className="dot" style={{ background: st.color }} />
                    {st.label}
                  </span>
                </td>
                <td style={{ fontWeight: 600 }}>{inv.number}</td>
                <td>{fmtDate(inv.issueDate)}</td>
                <td>{inv.origin}</td>
                <td className="muted">{inv.concept}</td>
                <td style={{ fontWeight: 600 }}>{fmtEur(Number(inv.total))}</td>
                <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {inv.status === 'draft' && (
                    <button className="btn sm" onClick={() => setReviewing(inv)}>
                      Revisar
                    </button>
                  )}
                  {inv.status === 'reviewed' && (
                    <button className="btn sm" onClick={() => setSending(inv)}>
                      Enviar
                    </button>
                  )}{' '}
                  <button className="btn ghost sm" disabled={pdfBusy === inv.id} onClick={() => openPdf(inv.id)}>
                    {pdfBusy === inv.id ? 'Cargando…' : 'PDF'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {invoices.length === 0 && <div className="empty">Aún no hay facturas emitidas.</div>}

      {adding && <NuevaFacturaModal onClose={() => setAdding(false)} onCreated={load} />}
      {reviewing && <RevisarFacturaModal invoice={reviewing} onClose={() => setReviewing(null)} onChanged={load} />}
      {sending && <EnviarFacturaModal invoice={sending} onClose={() => setSending(null)} onSent={load} />}
    </div>
  );
}
