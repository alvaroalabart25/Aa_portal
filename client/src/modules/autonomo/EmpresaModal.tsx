import { useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import { autonomoApi } from './api';
import type { InvoiceClient } from './types';

export default function EmpresaModal({
  client,
  onClose,
  onSaved,
}: {
  client: InvoiceClient | null; // null = crear nueva
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(client?.name ?? '');
  const [taxId, setTaxId] = useState(client?.taxId ?? '');
  const [email, setEmail] = useState(client?.email ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  const [addressLine, setAddressLine] = useState(client?.addressLine ?? '');
  const [cityLine, setCityLine] = useState(client?.cityLine ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSaving(true);
    setError('');
    const data = {
      name: name.trim(),
      taxId: taxId.trim() || null,
      email: email.trim(),
      phone: phone.trim() || null,
      addressLine: addressLine.trim() || null,
      cityLine: cityLine.trim() || null,
    };
    try {
      if (client) await autonomoApi.updateClient(client.id, data);
      else await autonomoApi.createClient(data);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={client ? 'Editar empresa' : 'Añadir empresa'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="form-grid">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="e-name">Razón social</label>
            <input id="e-name" autoFocus style={{ width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="P. ej. CSO Digital S.L." />
          </div>
          <div className="field">
            <label htmlFor="e-cif">CIF/NIF</label>
            <input id="e-cif" value={taxId} onChange={(e) => setTaxId(e.target.value)} style={{ width: 140 }} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="e-email">Email de envío de facturas *</label>
          <input id="e-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jose@csodigital.tech" />
        </div>
        <div className="form-grid">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="e-addr">Dirección</label>
            <input id="e-addr" style={{ width: '100%' }} value={addressLine} onChange={(e) => setAddressLine(e.target.value)} placeholder="Calle y número" />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="e-city">Ciudad y CP</label>
            <input id="e-city" style={{ width: '100%' }} value={cityLine} onChange={(e) => setCityLine(e.target.value)} placeholder="Las Rozas de Madrid, 28290" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="e-phone">Teléfono</label>
          <input id="e-phone" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: 200 }} />
        </div>
        {error && <div className="error-msg">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={saving || !name.trim() || !email.trim()}>
            {client ? 'Guardar' : 'Añadir empresa'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
