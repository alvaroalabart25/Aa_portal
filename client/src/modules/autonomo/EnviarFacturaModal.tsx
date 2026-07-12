import { useEffect, useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import { autonomoApi } from './api';
import { fmtEur, type Invoice } from './types';

// Paso 3 del flujo: enviar la factura por email con el PDF adjunto.
export default function EnviarFacturaModal({
  invoice,
  onClose,
  onSent,
}: {
  invoice: Invoice;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(`Factura ${invoice.number} — Álvaro Alabart`);
  const [message, setMessage] = useState(
    `Hola,\n\nTe adjunto la factura ${invoice.number} (${fmtEur(Number(invoice.total))}).\n\nUn saludo,\nÁlvaro`,
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    autonomoApi.clients().then((cs) => {
      const client = cs.find((c) => c.id === invoice.clientId);
      if (client?.email) setTo(client.email);
    });
    autonomoApi.profile().then((p) => {
      if (p) setSubject(`Factura ${invoice.number} — ${p.fullName}`);
    });
  }, [invoice]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!to.trim()) return;
    setSending(true);
    setError('');
    try {
      await autonomoApi.sendInvoice(invoice.id, { to: to.trim(), subject: subject.trim(), message: message.trim() });
      onSent();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al enviar');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title={`Enviar factura ${invoice.number}`} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label htmlFor="s-to">Para</label>
          <input id="s-to" type="email" required value={to} onChange={(e) => setTo(e.target.value)} placeholder="jose@csodigital.tech" />
        </div>
        <div className="field">
          <label htmlFor="s-subject">Asunto</label>
          <input id="s-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="s-message">Mensaje</label>
          <textarea id="s-message" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Se adjuntará <strong>Factura-{invoice.number}.pdf</strong> y quedará una copia en tu buzón.
        </p>
        {error && <div className="error-msg">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={sending || !to.trim()}>
            {sending ? 'Enviando…' : '📤 Enviar factura'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
