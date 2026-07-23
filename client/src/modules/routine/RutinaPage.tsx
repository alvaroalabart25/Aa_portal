import { useState } from 'react';
import MiDiaTab from './MiDiaTab';
import RutinaEventosTab from './RutinaEventosTab';

// Página Rutina (Organización): "Mi día" (evolución + checks + plantilla
// semanal) y "Eventos" (catálogo).
export default function RutinaPage() {
  const [sub, setSub] = useState<'dia' | 'eventos'>('dia');

  return (
    <div>
      <div className="page-head">
        <h1>Rutina</h1>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={sub === 'dia'} className={sub === 'dia' ? 'active' : ''} onClick={() => setSub('dia')}>
            Mi día
          </button>
          <button role="tab" aria-selected={sub === 'eventos'} className={sub === 'eventos' ? 'active' : ''} onClick={() => setSub('eventos')}>
            Eventos
          </button>
        </div>
      </div>

      {sub === 'dia' ? <MiDiaTab /> : <RutinaEventosTab />}
    </div>
  );
}
