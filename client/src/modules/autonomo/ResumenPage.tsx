import { useSearchParams } from 'react-router-dom';
import MesDeVerdad from './MesDeVerdad';
import AnaliticasTab from './AnaliticasTab';
import ObjetivosTab from './ObjetivosTab';
import { OjoPrivacidad } from './dinero';

/**
 * Tu dinero en el tiempo, en tres pestañas.
 *
 *   Resumen     cuánto tienes y cómo va el ciclo
 *   Analíticas  si el patrimonio crece, de dónde entra y en qué se va
 *   Objetivos   hacia dónde va lo que no se gasta
 *
 * Las tres contestan a la misma familia de preguntas, por eso viven juntas. La
 * fontanería del banco —conectar, sincronizar, el libro de movimientos— está en
 * su propia pantalla: se toca una vez al mes y no debería compartir sitio con
 * esto.
 */

const PESTANAS = [
  { id: 'resumen', titulo: 'Resumen', lema: 'Lo que tienes y cómo va el ciclo, sin contar el dinero que solo cambia de bolsillo.' },
  { id: 'analiticas', titulo: 'Analíticas', lema: '¿Crece tu patrimonio? ¿De dónde entra el dinero y en qué se va?' },
  { id: 'objetivos', titulo: 'Objetivos', lema: 'Hacia dónde va el dinero que no te gastas.' },
];

export default function ResumenPage() {
  const [params, setParams] = useSearchParams();
  const pestana = PESTANAS.find((p) => p.id === params.get('tab')) ?? PESTANAS[0];

  return (
    <div>
      <div className="page-head">
        <h1>Resumen</h1>
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
      <p className="page-sub">{pestana.lema}</p>

      {pestana.id === 'resumen' && <MesDeVerdad refrescar={0} />}
      {pestana.id === 'analiticas' && <AnaliticasTab />}
      {pestana.id === 'objetivos' && <ObjetivosTab />}
    </div>
  );
}
