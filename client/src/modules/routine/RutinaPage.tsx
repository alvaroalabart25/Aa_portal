import { useState } from 'react';
import MiDiaTab from './MiDiaTab';
import RealidadTab from './RealidadTab';
import RutinaEventosTab from './RutinaEventosTab';

// Página Rutina (Salud): "Mi día" (evolución + checks + plantilla semanal),
// "Realidad" (la semana según los checks) y "Eventos" (catálogo compartido
// entre el plan y la realidad).
export default function RutinaPage() {
  const [sub, setSub] = useState<'dia' | 'realidad' | 'eventos'>('dia');

  return (
    <div>
      <div className="page-head">
        <h1>Rutina</h1>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={sub === 'dia'} className={sub === 'dia' ? 'active' : ''} onClick={() => setSub('dia')}>
            Mi día
          </button>
          <button role="tab" aria-selected={sub === 'realidad'} className={sub === 'realidad' ? 'active' : ''} onClick={() => setSub('realidad')}>
            Realidad
          </button>
          <button role="tab" aria-selected={sub === 'eventos'} className={sub === 'eventos' ? 'active' : ''} onClick={() => setSub('eventos')}>
            Eventos
          </button>
        </div>
      </div>

      {sub === 'dia' ? <MiDiaTab /> : sub === 'realidad' ? <RealidadTab /> : <RutinaEventosTab />}
    </div>
  );
}
