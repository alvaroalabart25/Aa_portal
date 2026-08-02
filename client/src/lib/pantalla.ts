import { useEffect, useState } from 'react';

// El corte del móvil, el mismo que usan los estilos
const MOVIL = '(max-width: 720px)';

/**
 * ¿Estamos en pantalla de móvil?
 *
 * Para lo que se puede resolver con CSS, se resuelve con CSS. Esto es para
 * cuando el cambio no es de presentación sino de contenido: en el móvil la
 * Agenda muestra solo los eventos de la semana, y eso hay que decidirlo antes
 * de pintar, no esconderlo después.
 */
export function useEsMovil(): boolean {
  const [esMovil, setEsMovil] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOVIL).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(MOVIL);
    const alCambiar = (e: MediaQueryListEvent) => setEsMovil(e.matches);
    mq.addEventListener('change', alCambiar);
    setEsMovil(mq.matches);
    return () => mq.removeEventListener('change', alCambiar);
  }, []);

  return esMovil;
}
