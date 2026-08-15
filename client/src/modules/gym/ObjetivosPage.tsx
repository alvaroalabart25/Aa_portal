import { useEffect, useState } from 'react';
import { gymApi, type Rutina } from './api';
import { Objetivo } from './GimnasioPage';

/**
 * Salud › Objetivo & Analíticas: a dónde vas (fase, metas medibles), el
 * seguimiento del pesaje contra tu meta de peso, la cobertura muscular de la
 * rutina y tus condicionantes.
 *
 * Vivía como cuarta pestaña del gimnasio, pero ni cabía (cuatro pestañas no
 * entran en línea con el título en un móvil) ni era su sitio: el peso corporal
 * sale del Diario y los condicionantes son de salud, no solo de entrenar.
 * La ruta sigue siendo /salud/objetivos: solo cambia lo visible.
 */
export default function ObjetivosPage() {
  const [rutina, setRutina] = useState<Rutina | null>(null);
  useEffect(() => {
    gymApi.rutina().then(setRutina).catch(() => {});
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1>Objetivo & Analíticas</h1>
      </div>
      {!rutina ? <p className="muted">Cargando…</p> : <Objetivo rutina={rutina} />}
    </div>
  );
}
