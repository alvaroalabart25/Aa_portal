import { useCallback, useEffect, useState } from 'react';
import { autonomoApi } from './api';
import NuevoGastoModal from './NuevoGastoModal';
import { FotosDeFactura } from './FotosDeFactura';
import { fmtDate, fmtEur, type Invoice } from './types';

/**
 * Facturas recibidas: lo que te facturan a ti.
 *
 * Son el otro lado de la misma moneda que las emitidas —el IVA de un trimestre
 * es lo repercutido menos lo soportado— y hasta ahora vivían escondidas en
 * Cuentas, junto a los movimientos. Aquí están donde uno las busca.
 *
 * Cada una puede llevar su escaneo: la foto del ticket o de la factura hecha
 * con el móvil. El portal no lee la foto —los datos los pones tú— pero la
 * guarda, que es lo que le va a pedir el gestor.
 */
export default function RecibidasTab() {
  const [facturas, setFacturas] = useState<Invoice[]>([]);
  const [anadiendo, setAnadiendo] = useState(false);

  const cargar = useCallback(async () => setFacturas(await autonomoApi.invoices({ kind: 'expense' })), []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button className="btn" onClick={() => setAnadiendo(true)}>
          + Nueva factura
        </button>
      </div>

      {facturas.length === 0 ? (
        <p className="empty">
          Ninguna factura recibida todavía. Añade las de tus gastos: son las que descuentan IVA en el trimestre.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '11%' }}>Fecha</th>
              <th style={{ width: '22%' }}>Proveedor</th>
              <th style={{ width: '11%' }}>Nº</th>
              <th>Concepto</th>
              <th style={{ width: '10%' }}>Base</th>
              <th style={{ width: '9%' }}>IVA</th>
              <th style={{ width: '11%' }}>Total</th>
              <th style={{ width: '16%' }}>Escaneo</th>
            </tr>
          </thead>
          <tbody>
            {facturas.map((f) => (
              <tr key={f.id} className="row">
                <td>{fmtDate(f.issueDate)}</td>
                <td style={{ fontWeight: 500 }}>{f.origin}</td>
                <td>{f.number}</td>
                <td>{f.concept ?? '—'}</td>
                <td>{fmtEur(Number(f.base))}</td>
                <td>{fmtEur(Number(f.vatAmount))}</td>
                <td style={{ fontWeight: 600 }}>{fmtEur(Number(f.total))}</td>
                <td>
                  <FotosDeFactura facturaId={f.id} fotos={f.fotos ?? []} onCambio={cargar} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {anadiendo && <NuevoGastoModal onClose={() => setAnadiendo(false)} onCreated={cargar} />}
    </div>
  );
}
