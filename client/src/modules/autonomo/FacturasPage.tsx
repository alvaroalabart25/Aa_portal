import { useState } from 'react';
import FacturasTab from './FacturasTab';
import EmpresasTab from './EmpresasTab';

// Página Facturas: emisión y listado + empresas a las que facturas.
export default function FacturasPage() {
  const [tab, setTab] = useState<'emitidas' | 'empresas'>('emitidas');

  return (
    <div>
      <div className="page-head">
        <h1>Facturas</h1>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'emitidas'} className={tab === 'emitidas' ? 'active' : ''} onClick={() => setTab('emitidas')}>
            Emitidas
          </button>
          <button role="tab" aria-selected={tab === 'empresas'} className={tab === 'empresas' ? 'active' : ''} onClick={() => setTab('empresas')}>
            Empresas
          </button>
        </div>
      </div>

      {tab === 'emitidas' ? <FacturasTab /> : <EmpresasTab />}
    </div>
  );
}
