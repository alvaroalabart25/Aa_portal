import { useSearchParams } from 'react-router-dom';
import MesDeVerdad from './MesDeVerdad';
import ObjetivosTab from './ObjetivosTab';
import { OjoPrivacidad } from './dinero';

/**
 * El resumen: cuánto tienes hoy y hacia dónde va.
 *
 *   Hoy        patrimonio, cómo va el ciclo y dónde está tu dinero
 *   Objetivos  el colchón y la deuda, con su recorrido
 *
 * Lo que se DEDUCE del banco —analíticas y el reparto del ciclo— vive en
 * Bancos, junto a los movimientos de los que sale. Aquí solo la foto.
 *
 * La primera pestaña se llama «Hoy» y no «Resumen» a propósito: la pantalla ya
 * se llama así, y «Resumen › Resumen» no dice nada.
 */

const PESTANAS = [
  { id: 'resumen', titulo: 'Hoy', lema: 'Lo que tienes y cómo va el ciclo, sin contar el dinero que solo cambia de bolsillo.' },
  { id: 'objetivos', titulo: 'Objetivos', lema: 'Hacia dónde va el dinero que no te gastas.' },
];

export default function ResumenPage() {
  const [params, setParams] = useSearchParams();
  const pestana = PESTANAS.find((p) => p.id === params.get('tab')) ?? PESTANAS[0];

  return (
    <div>
      <div className="page-head">
        <h1>Resumen</h1>
        <div className="page-acciones">
          <div className="seg" role="tablist">
            {PESTANAS.map((p) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={p.id === pestana.id}
                className={p.id === pestana.id ? 'active' : ''}
                onClick={() => setParams(p.id === 'resumen' ? {} : { tab: p.id }, { replace: true })}
              >
                {p.titulo}
              </button>
            ))}
          </div>
          <OjoPrivacidad />
        </div>
      </div>
      <p className="page-sub">{pestana.lema}</p>

      {pestana.id === 'resumen' && <MesDeVerdad refrescar={0} />}
      {pestana.id === 'objetivos' && <ObjetivosTab />}
    </div>
  );
}
