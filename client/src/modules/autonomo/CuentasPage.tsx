import { useState } from 'react';
import CuentasTab from './CuentasTab';
import { EventsRadar } from '../events/components';
import TrimestralesTab from './TrimestralesTab';

// Página Cuentas: libro de movimientos por trimestre + resumen trimestral.
export default function CuentasPage() {
  const [tab, setTab] = useState<'cuentas' | 'trimestrales'>('cuentas');

  return (
    <div>
      <div className="page-head">
        <h1>Cuentas</h1>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'cuentas'} className={tab === 'cuentas' ? 'active' : ''} onClick={() => setTab('cuentas')}>
            Cuentas
          </button>
          <button role="tab" aria-selected={tab === 'trimestrales'} className={tab === 'trimestrales' ? 'active' : ''} onClick={() => setTab('trimestrales')}>
            Trimestrales
          </button>
        </div>
      </div>

      <EventsRadar scope="autonomo" />

      {tab === 'cuentas' ? <CuentasTab /> : <TrimestralesTab />}
    </div>
  );
}
