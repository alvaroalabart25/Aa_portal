import { useCallback, useEffect, useState } from 'react';
import { autonomoApi } from './api';
import EmpresaModal from './EmpresaModal';
import type { InvoiceClient } from './types';

// Subtab Empresas: a quién facturas. El email es el destino del envío
// automático de la factura (fase de email).
export default function EmpresasTab() {
  const [clients, setClients] = useState<InvoiceClient[]>([]);
  const [editing, setEditing] = useState<InvoiceClient | 'new' | null>(null);

  const load = useCallback(async () => setClients(await autonomoApi.clients()), []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button className="btn" onClick={() => setEditing('new')}>
          + Añadir empresa
        </button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Empresa</th>
            <th style={{ width: '14%' }}>CIF</th>
            <th style={{ width: '24%' }}>Email de envío</th>
            <th style={{ width: '16%' }}>Teléfono</th>
            <th style={{ width: '24%' }}>Dirección</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} className="row" onClick={() => setEditing(c)}>
              <td style={{ fontWeight: 600 }}>{c.name}</td>
              <td>{c.taxId ?? '—'}</td>
              <td>{c.email ?? <span className="overdue">falta email</span>}</td>
              <td>{c.phone ?? '—'}</td>
              <td className="muted">{[c.addressLine, c.cityLine].filter(Boolean).join(' · ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {clients.length === 0 && <div className="empty">Añade tu primera empresa.</div>}
      <p className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
        El email es la dirección a la que se enviará la factura automáticamente. Haz clic en una empresa para editarla.
      </p>

      {editing && (
        <EmpresaModal
          client={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
