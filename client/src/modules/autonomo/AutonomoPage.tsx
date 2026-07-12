import { useState } from 'react';
import FacturasTab from './FacturasTab';
import CuentasTab from './CuentasTab';
import TrimestralesTab from './TrimestralesTab';

type Tab = 'facturas' | 'cuentas' | 'trimestrales';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'facturas', label: 'Facturas' },
  { id: 'cuentas', label: 'Cuentas' },
  { id: 'trimestrales', label: 'Trimestrales' },
];

export default function AutonomoPage() {
  const [tab, setTab] = useState<Tab>('facturas');

  return (
    <div>
      <div className="page-head">
        <h1>Autónomo</h1>
        <div className="seg" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'facturas' && <FacturasTab />}
      {tab === 'cuentas' && <CuentasTab />}
      {tab === 'trimestrales' && <TrimestralesTab />}
    </div>
  );
}
