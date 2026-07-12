import { useMemo, useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import { autonomoApi } from './api';
import { fmtEur } from './types';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function NuevoGastoModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [origin, setOrigin] = useState('');
  const [number, setNumber] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [concept, setConcept] = useState('');
  const [base, setBase] = useState('');
  const [vatPct, setVatPct] = useState('21');
  const [irpfPct, setIrpfPct] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const preview = useMemo(() => {
    const b = Math.round((Number(base) || 0) * 100);
    const vat = Math.round((b * (Number(vatPct) || 0)) / 100);
    const irpf = Math.round((b * (Number(irpfPct) || 0)) / 100);
    return { vat: vat / 100, total: (b + vat - irpf) / 100 };
  }, [base, vatPct, irpfPct]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!origin.trim() || !number.trim() || !Number(base)) return;
    setSaving(true);
    setError('');
    try {
      await autonomoApi.createInvoice({
        kind: 'expense',
        origin: origin.trim(),
        number: number.trim(),
        issueDate,
        concept: concept.trim() || null,
        base: Number(base),
        vatPct: Number(vatPct),
        irpfPct: Number(irpfPct),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al añadir el gasto');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Añadir gasto" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label htmlFor="g-origin">Origen (proveedor)</label>
          <input id="g-origin" autoFocus value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="P. ej. Apple" />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="g-number">Nº de factura</label>
            <input id="g-number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="El del proveedor" />
          </div>
          <div className="field">
            <label htmlFor="g-date">Fecha de emisión</label>
            <input id="g-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="g-concept">Concepto (opcional)</label>
          <input id="g-concept" value={concept} onChange={(e) => setConcept(e.target.value)} />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="g-base">Base imponible (€)</label>
            <input id="g-base" type="number" step="0.01" min="0" value={base} onChange={(e) => setBase(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="g-vat">IVA %</label>
            <input id="g-vat" type="number" step="0.01" min="0" max="99" value={vatPct} onChange={(e) => setVatPct(e.target.value)} style={{ width: 90 }} />
          </div>
          <div className="field">
            <label htmlFor="g-irpf">IRPF %</label>
            <input id="g-irpf" type="number" step="0.01" min="0" max="99" value={irpfPct} onChange={(e) => setIrpfPct(e.target.value)} style={{ width: 90 }} />
          </div>
        </div>

        {Number(base) > 0 && (
          <div className="invoice-preview">
            <span>IVA soportado: <strong>{fmtEur(preview.vat)}</strong></span>
            <span>Total: <strong>{fmtEur(preview.total)}</strong></span>
          </div>
        )}
        {error && <div className="error-msg">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={saving || !origin.trim() || !number.trim() || !Number(base)}>
            Añadir gasto
          </button>
        </div>
      </form>
    </Modal>
  );
}
