import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Reordenar arrastrando, con ratón o con el dedo.
 *
 * No se usa la API de arrastre de HTML porque en táctil no existe, y el portal
 * se usa sobre todo desde el iPhone. En su lugar se sigue el puntero y se mira
 * qué elemento hay debajo (`elementFromPoint`).
 *
 * Los movimientos se escuchan EN LA VENTANA mientras hay un arrastre activo,
 * no sobre el asa con el puntero capturado: iOS decide enseguida que un dedo
 * que se mueve es un scroll y cancela el puntero capturado, con lo que el
 * arrastre funcionaba con ratón y estaba muerto en el móvil. Para que el dedo
 * ni siquiera inicie el scroll, el asa DEBE llevar `touch-action: none` en su
 * CSS — sin eso no hay ventana que valga.
 *
 * El elemento arrastrable debe llevar `data-rid` con su id y el asa debe
 * recibir los manejadores que devuelve este hook.
 */
export function useArrastre<T extends { id: number }>(
  lista: T[],
  setLista: (l: T[]) => void,
  guardar: (ids: number[]) => Promise<unknown>,
) {
  const [activo, setActivo] = useState<number | null>(null);

  // los manejadores de ventana viven fuera del ciclo de render: leen siempre
  // el último estado por aquí
  const ref = useRef({ lista, setLista, guardar });
  ref.current = { lista, setLista, guardar };

  useEffect(() => {
    if (activo == null) return;

    // ANTES se miraba qué fila había justo bajo el dedo (`elementFromPoint`):
    // en los huecos entre tarjetas no hay ninguna y el arrastre se quedaba
    // pillado, y al cruzar filas de alturas distintas la fila objetivo cambiaba
    // de sitio bajo el dedo y temblaba. AHORA la posición se calcula contando
    // cuántas filas de ESTA lista tienen su punto medio por encima del dedo:
    // no hay zonas muertas y solo se recoloca al cruzar un punto medio.
    function move(e: globalThis.PointerEvent) {
      const l = ref.current.lista;
      const desde = l.findIndex((x) => x.id === activo);
      if (desde < 0) return;
      // solo las filas de la lista que se está arrastrando: en una pantalla
      // puede haber varias listas ordenables (un día por lista en Rutina)
      const ids = new Set(l.map((x) => x.id));
      const filas = [...document.querySelectorAll<HTMLElement>('[data-rid]')].filter(
        (f) => ids.has(Number(f.dataset.rid)) && Number(f.dataset.rid) !== activo,
      );
      if (filas.length === 0) return;
      const hasta = filas.filter((f) => {
        const r = f.getBoundingClientRect();
        return (r.top + r.bottom) / 2 < e.clientY;
      }).length;
      if (hasta === desde) return;
      const copia = l.slice();
      copia.splice(hasta, 0, ...copia.splice(desde, 1));
      ref.current.setLista(copia);
    }

    function up() {
      setActivo(null);
      // optimista: la lista ya está en su sitio; si falla el guardado se recarga
      ref.current.guardar(ref.current.lista.map((x) => x.id)).catch(() => {});
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    // si la app pierde el foco a mitad de arrastre (llamada, cambio de app),
    // el puntero no vuelve: se suelta donde estaba para no quedar pillado
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
    };
  }, [activo]);

  function onPointerDown(e: ReactPointerEvent, id: number) {
    e.preventDefault();
    setActivo(id);
  }

  // Se mantienen por compatibilidad con las asas que ya los pasan: el trabajo
  // real lo hacen los manejadores de ventana de arriba.
  function onPointerMove() {}
  function onPointerUp() {}

  return { activo, onPointerDown, onPointerMove, onPointerUp };
}
