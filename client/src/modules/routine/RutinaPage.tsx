import { useState } from 'react';
import EnDesarrollo from '../../components/EnDesarrollo';
import MiDiaTab from './MiDiaTab';
import RutinaEventosTab from './RutinaEventosTab';

// Página Rutina (Salud): el PLAN — "Mi día" (evolución + checks + plantilla
// semanal) y "Eventos" (catálogo, compartido con el Diario). La realidad vive
// en Salud · Diario; la tab Realidad (RealidadTab) queda dormida hasta que
// toque enfrentar plan y realidad.
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

      <EnDesarrollo>
        Pendiente de darle una vuelta: la plantilla semanal es demasiado trabajo para lo que devuelve. La idea es que
        el plan salga en buena parte de lo que el Diario ya registra, en vez de tener que escribirlo a mano.
      </EnDesarrollo>

      {sub === 'dia' ? <MiDiaTab /> : <RutinaEventosTab />}
    </div>
  );
}
