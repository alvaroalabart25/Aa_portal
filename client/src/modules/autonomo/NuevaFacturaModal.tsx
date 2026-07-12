import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import { autonomoApi } from './api';
import { fmtEur, monthName, type InvoiceClient } from './types';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function NuevaFacturaModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [clients, setClients] = useState<InvoiceClient[]>([]);
  const [clientId, setClientId] = useState<number | ''>('');
  const [issueDate, setIssueDate] = useState(today());
  const [concept, setConcept] = useState(`Mes ${monthName(today())} (Base Imponible)`);
  const [base, setBase] = useState('');
  const [vatPct, setVatPct] = useState('21');
  const [irpfPct, setIrpfPct] = useState('15');
  const [nextNumber, setNextNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    autonomoApi.clients().then((cs) => {
      setClients(cs);
      if (cs.length > 0) setClientId(cs[0].id);
    });
    autonomoApi.profile().then((p) => {
      if (p) {
        setVatPct(String(Number(p.defaultVatPct)));
        setIrpfPct(String(Number(p.defaultIrpfPct)));
      }
    });
  }, []);

  useEffect(() => {
    const year = Number(issueDate.slice(0, 4));
    if (year) autonomoApi.nextNumber(year).then((r) => setNextNumber(r.number));
  }, [issueDate]);

  const preview = useMemo(() => {
    const b = Math.round((Number(base) || 0) * 100);
    const vat = Math.round((b * (Number(vatPct) || 0)) / 100);
    const irpf = Math.round((b * (Number(irpfPct) || 0)) / 100);
    return { vat: vat / 100, irpf: irpf / 100, total: (b + vat - irpf) / 100 };
  }, [base, vatPct, irpfPct]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!clientId || !Number(base)) return;
    setSaving(true);
    setError('');
    try {
      await autonomoApi.createInvoice({
        kind: 'income',
        clientId: Number(clientId),
        issueDate,
        concept: concept.trim(),
        base: Number(base),
        vatPct: Number(vatPct),
        irpfPct: Number(irpfPct),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear la factura');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Nueva factura" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label htmlFor="f-client">Cliente</label>
          <select id="f-client" value={clientId} onChange={(e) => setClientId(Number(e.target.value))}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="f-date">Fecha de emisión</label>
            <input id="f-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="f-concept">Concepto</label>
            <input id="f-concept" style={{ width: '100%' }} value={concept} onChange={(e) => setConcept(e.target.value)} />
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="f-base">Base imponible (€)</label>
            <input id="f-base" type="number" step="0.01" min="0" value={base} onChange={(e) => setBase(e.target.value)} placeholder="1800,00" />
          </div>
          <div className="field">
            <label htmlFor="f-vat">IVA %</label>
            <input id="f-vat" type="number" step="0.01" min="0" max="99" value={vatPct} onChange={(e) => setVatPct(e.target.value)} style={{ width: 90 }} />
          </div>
          <div className="field">
            <label htmlFor="f-irpf">IRPF %</label>
            <input id="f-irpf" type="number" step="0.01" min="0" max="99" value={irpfPct} onChange={(e) => setIrpfPct(e.target.value)} style={{ width: 90 }} />
          </div>
        </div>

        {Number(base) > 0 && (
          <div className="invoice-preview">
            <span>IVA: <strong>+{fmtEur(preview.vat)}</strong></span>
            <span>IRPF: <strong>−{fmtEur(preview.irpf)}</strong></span>
            <span>Total: <strong>{fmtEur(preview.total)}</strong></span>
          </div>
        )}
        {nextNumber && (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Se emitirá como <strong>Factura N.º {nextNumber}</strong> (numeración automática correlativa).
          </p>
        )}
        {error && <div className="error-msg">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={saving || !clientId || !Number(base)}>
            {saving ? 'Creando…' : 'Crear factura'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
