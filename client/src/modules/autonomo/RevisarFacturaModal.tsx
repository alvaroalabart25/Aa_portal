import { useMemo, useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import { autonomoApi } from './api';
import { fmtEur, type Invoice } from './types';

// Paso 2 del flujo: revisar el borrador. Permite corregir datos, ver el PDF
// y aprobarla (queda "lista para enviar").
export default function RevisarFacturaModal({
  invoice,
  onClose,
  onChanged,
}: {
  invoice: Invoice;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [issueDate, setIssueDate] = useState(invoice.issueDate);
  const [concept, setConcept] = useState(invoice.concept ?? '');
  const [base, setBase] = useState(String(Number(invoice.base)));
  const [vatPct, setVatPct] = useState(String(Number(invoice.vatPct)));
  const [irpfPct, setIrpfPct] = useState(String(Number(invoice.irpfPct)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const dirty =
    issueDate !== invoice.issueDate ||
    concept !== (invoice.concept ?? '') ||
    Number(base) !== Number(invoice.base) ||
    Number(vatPct) !== Number(invoice.vatPct) ||
    Number(irpfPct) !== Number(invoice.irpfPct);

  const preview = useMemo(() => {
    const b = Math.round((Number(base) || 0) * 100);
    const vat = Math.round((b * (Number(vatPct) || 0)) / 100);
    const irpf = Math.round((b * (Number(irpfPct) || 0)) / 100);
    return { vat: vat / 100, irpf: irpf / 100, total: (b + vat - irpf) / 100 };
  }, [base, vatPct, irpfPct]);

  async function saveIfDirty() {
    if (!dirty) return;
    await autonomoApi.updateInvoice(invoice.id, {
      issueDate,
      concept: concept.trim(),
      base: Number(base),
      vatPct: Number(vatPct),
      irpfPct: Number(irpfPct),
    });
  }

  async function saveAndPdf(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await saveIfDirty();
      await autonomoApi.openPdf(invoice.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    setError('');
    try {
      await saveIfDirty();
      await autonomoApi.approveInvoice(invoice.id);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Revisar factura ${invoice.number}`} onClose={onClose}>
      <form onSubmit={saveAndPdf} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {invoice.origin} · corrige lo que haga falta, comprueba el PDF y aprueba.
        </p>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="r-date">Fecha de emisión</label>
            <input id="r-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="r-concept">Concepto</label>
            <input id="r-concept" style={{ width: '100%' }} value={concept} onChange={(e) => setConcept(e.target.value)} />
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="r-base">Base imponible (€)</label>
            <input id="r-base" type="number" step="0.01" min="0" value={base} onChange={(e) => setBase(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="r-vat">IVA %</label>
            <input id="r-vat" type="number" step="0.01" min="0" max="99" value={vatPct} onChange={(e) => setVatPct(e.target.value)} style={{ width: 90 }} />
          </div>
          <div className="field">
            <label htmlFor="r-irpf">IRPF %</label>
            <input id="r-irpf" type="number" step="0.01" min="0" max="99" value={irpfPct} onChange={(e) => setIrpfPct(e.target.value)} style={{ width: 90 }} />
          </div>
        </div>

        <div className="invoice-preview">
          <span>IVA: <strong>+{fmtEur(preview.vat)}</strong></span>
          <span>IRPF: <strong>−{fmtEur(preview.irpf)}</strong></span>
          <span>Total: <strong>{fmtEur(preview.total)}</strong></span>
        </div>
        {error && <div className="error-msg">{error}</div>}

        <div className="modal-actions">
          <button className="btn ghost" disabled={busy}>
            {dirty ? 'Guardar y ver PDF' : 'Ver PDF'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={approve}>
            ✓ Aprobar{dirty ? ' (guarda cambios)' : ''}
          </button>
        </div>
      </form>
    </Modal>
  );
}
