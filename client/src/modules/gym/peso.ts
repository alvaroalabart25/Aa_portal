import { numTxt } from './api';

/**
 * En barra se apunta UN LADO.
 *
 * Cargar 40 kg en un peso muerto significa 40 en cada extremo: el peso real son
 * 95 con una barra de 15. Apuntar el total obliga a hacer la cuenta de cabeza
 * en medio de la serie, que es justo cuando peor se hace, así que se apunta lo
 * que se ve —los discos de un lado— y la suma la hace el portal.
 *
 * `barKg` con valor dice dos cosas a la vez: que el peso es por lado y cuánto
 * pesa la barra. Sin valor, el peso es el total y aquí no pasa nada: una
 * mancuerna de 20 son 20.
 */

export const laBarra = (barKg: string | number | null | undefined): number | null => {
  if (barKg == null || barKg === '') return null;
  const n = Number(barKg);
  return Number.isFinite(n) ? n : null;
};

/** Lo que de verdad se ha levantado. Es lo que cuenta para el volumen y el PR. */
export function pesoReal(peso: string | number | null | undefined, barKg: string | number | null): number {
  const w = peso == null || peso === '' ? 0 : Number(peso);
  if (!Number.isFinite(w) || w === 0) return 0;
  const barra = laBarra(barKg);
  return barra === null ? w : w * 2 + barra;
}

/**
 * Cómo se escribe un peso en pantalla: el total, que es el dato que importa, y
 * entre paréntesis lo que hay que poner en cada lado, que es lo que se hace.
 */
export function txtPeso(peso: string | number | null | undefined, barKg: string | number | null): string {
  if (peso == null || peso === '') return '';
  if (laBarra(barKg) === null) return numTxt(peso);
  return `${numTxt(pesoReal(peso, barKg))} (${numTxt(peso)}/lado)`;
}

/** Igual, pero con la unidad donde corresponde: «105 kg (45/lado)». */
export function txtPesoKg(peso: string | number | null | undefined, barKg: string | number | null): string {
  if (peso == null || peso === '') return '';
  if (laBarra(barKg) === null) return `${numTxt(peso)} kg`;
  return `${numTxt(pesoReal(peso, barKg))} kg (${numTxt(peso)}/lado)`;
}
