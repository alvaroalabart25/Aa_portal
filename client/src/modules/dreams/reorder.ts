import { useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Reordenar arrastrando, con ratón o con el dedo.
 *
 * No se usa la API de arrastre de HTML porque en táctil no existe, y el portal
 * se usa sobre todo desde el iPhone. En su lugar se sigue el puntero y se mira
 * qué elemento hay debajo (`elementFromPoint`), igual que en la radiografía del
 * Diario.
 *
 * El elemento arrastrable debe llevar `data-rid` con su id y el asa debe
 * recibir los tres manejadores que devuelve este hook.
 */
export function useArrastre<T extends { id: number }>(
  lista: T[],
  setLista: (l: T[]) => void,
  guardar: (ids: number[]) => Promise<unknown>,
) {
  const [activo, setActivo] = useState<number | null>(null);

  function onPointerDown(e: ReactPointerEvent, id: number) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setActivo(id);
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (activo == null) return;
    const bajo = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-rid]') as HTMLElement | null;
    const sobre = bajo ? Number(bajo.dataset.rid) : null;
    if (sobre == null || sobre === activo) return;
    const desde = lista.findIndex((x) => x.id === activo);
    const hasta = lista.findIndex((x) => x.id === sobre);
    if (desde < 0 || hasta < 0) return;
    const copia = lista.slice();
    copia.splice(hasta, 0, ...copia.splice(desde, 1));
    setLista(copia);
  }

  function onPointerUp() {
    if (activo == null) return;
    setActivo(null);
    // optimista: la lista ya está en su sitio, si falla el guardado se recarga
    guardar(lista.map((x) => x.id)).catch(() => {});
  }

  return { activo, onPointerDown, onPointerMove, onPointerUp };
}
