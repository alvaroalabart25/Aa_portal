import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { gymApi, type Rutina } from './api';
import { Objetivo } from './GimnasioPage';
import Analiticas from './Analiticas';

type Vista = 'objetivo' | 'analiticas';

/**
 * Salud › Objetivo & Analíticas, en dos pestañas.
 *
 * La separación es a propósito y es suya: **Objetivo** es a dónde vas —tus
 * metas, el pesaje que apuntas a mano, la cobertura de la rutina y tus
 * condicionantes— y **Analíticas** es qué está pasando, o sea la evolución.
 * Así la primera no se llena de gráficas y sigue leyéndose de un vistazo.
 *
 * La pestaña va en la dirección (?tab=analiticas), como en el resto del
 * portal: así se puede volver a donde estabas. La ruta sigue siendo
 * /salud/objetivos.
 */
export default function ObjetivosPage() {
  const [params, setParams] = useSearchParams();
  const vista: Vista = params.get('tab') === 'analiticas' ? 'analiticas' : 'objetivo';
  const [rutina, setRutina] = useState<Rutina | null>(null);

  useEffect(() => {
    gymApi.rutina().then(setRutina).catch(() => {});
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1>Objetivo & Analíticas</h1>
        <div className="head-acciones">
          <div className="seg" role="tablist">
            {([['objetivo', 'Objetivo'], ['analiticas', 'Analíticas']] as [Vista, string][]).map(([v, etiqueta]) => (
              <button
                key={v}
                role="tab"
                aria-selected={vista === v}
                className={vista === v ? 'active' : ''}
                onClick={() => setParams(v === 'objetivo' ? {} : { tab: v }, { replace: true })}
              >
                {etiqueta}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="page-sub">
        {vista === 'objetivo'
          ? 'A dónde vas con tu salud: tus metas, el pesaje y la cobertura de tu rutina.'
          : 'Cómo van tus entrenamientos de verdad, con lo que ya has cerrado.'}
      </p>

      {vista === 'analiticas' ? (
        <Analiticas />
      ) : !rutina ? (
        <p className="muted">Cargando…</p>
      ) : (
        <Objetivo rutina={rutina} />
      )}
    </div>
  );
}
