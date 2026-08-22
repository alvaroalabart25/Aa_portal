import { useEffect, useState } from 'react';

/**
 * Esconder los importes de un toque.
 *
 * Para cuando enseñas la pantalla a alguien. No es seguridad —quien tenga el
 * móvil desbloqueado puede volver a mostrarlos— sino discreción, que es lo que
 * hace falta cuando le enseñas una pantalla a un amigo y de paso ve tu nómina.
 *
 * Vive fuera de React a propósito: lo consultan formateadores sueltos que no
 * son componentes, y así una sola verdad la comparten todas las pantallas.
 */

const LLAVE = 'aa_oculta_importes';
const oyentes = new Set<() => void>();

let oculto = typeof localStorage !== 'undefined' && localStorage.getItem(LLAVE) === 'si';

export function importesOcultos(): boolean {
  return oculto;
}

export function ocultarImportes(valor: boolean): void {
  oculto = valor;
  localStorage.setItem(LLAVE, valor ? 'si' : 'no');
  oyentes.forEach((f) => f());
}

/** El formateador de euros de todo Finanzas, ya con la máscara aplicada. */
export function useDinero() {
  const [, redibuja] = useState(0);
  useEffect(() => {
    const f = () => redibuja((n) => n + 1);
    oyentes.add(f);
    return () => {
      oyentes.delete(f);
    };
  }, []);

  return {
    oculto,
    eur: (n: number) =>
      oculto ? '***' : n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    /** para ejes y etiquetas, donde los decimales sobran */
    corto: (n: number) => (oculto ? '***' : `${Math.round(n)} €`),
  };
}

/** El botón, para la cabecera de cada pantalla de Finanzas. */
export function OjoPrivacidad() {
  const { oculto } = useDinero();
  return (
    <button
      className="ojo"
      aria-label={oculto ? 'Mostrar los importes' : 'Ocultar los importes'}
      title={oculto ? 'Mostrar los importes' : 'Ocultar los importes'}
      onClick={() => ocultarImportes(!oculto)}
    >
      {oculto ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8" />
          <path d="M9.4 5.2A9.5 9.5 0 0112 5c5 0 9 4.5 9 7 0 .9-.6 2.1-1.6 3.3M6.3 6.9C4 8.4 3 10.4 3 12c0 2.5 4 7 9 7 1.4 0 2.7-.3 3.8-.9" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" />
          <circle cx="12" cy="12" r="2.6" />
        </svg>
      )}
    </button>
  );
}
