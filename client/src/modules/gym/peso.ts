import { numTxt } from './api';

/**
 * Lo que de verdad se ha levantado, a partir de lo que se apunta.
 *
 * Dos preguntas distintas, y por eso son dos campos:
 *
 *  - `perSide`: ¿lo que apuntas es UN LADO? En barra sí —cargar 40 en un peso
 *    muerto significa 40 en cada extremo—, así que se apunta lo que se ve y la
 *    suma la hace el portal. Hacer la cuenta de cabeza en medio de la serie es
 *    justo cuando peor se hace.
 *  - `barKg`: cuánto pesa la parte fija. La barra, o el carro de una máquina.
 *
 * Iban pegadas en un solo campo hasta que apareció la máquina de hip thrust:
 * su carro pesa 22,70 kg pero los discos van a un solo lado, así que lo
 * apuntado es el total y aun así hay que sumar el carro.
 */
export interface ConPeso {
  barKg?: string | number | null;
  /** 1 / true: lo apuntado es un lado */
  perSide?: number | boolean | null;
}

export const laBarra = (ej: ConPeso | null | undefined): number | null => {
  const v = ej?.barKg;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ¿Lo apuntado es un lado? */
export const esPorLado = (ej: ConPeso | null | undefined): boolean => Boolean(ej?.perSide);

/** Lo que de verdad se ha levantado. Es lo que cuenta para el volumen y el PR. */
export function pesoReal(peso: string | number | null | undefined, ej: ConPeso | null | undefined): number {
  const w = peso == null || peso === '' ? 0 : Number(peso);
  if (!Number.isFinite(w) || w === 0) return 0;
  const fijo = laBarra(ej) ?? 0;
  return (esPorLado(ej) ? w * 2 : w) + fijo;
}

/** ¿Hay que enseñar la cuenta, o lo apuntado ya es el total? */
const hayCuenta = (ej: ConPeso | null | undefined) => esPorLado(ej) || laBarra(ej) !== null;

/**
 * Cómo se escribe un peso en pantalla: el total, que es el dato que importa, y
 * entre paréntesis lo que hay que cargar, que es lo que se hace. Cuando el
 * peso va por lado se dice; cuando solo hay una parte fija que sumar, se
 * enseña el disco a secas, que es lo que se pone en la máquina.
 */
export function txtPeso(peso: string | number | null | undefined, ej: ConPeso | null | undefined): string {
  if (peso == null || peso === '') return '';
  if (!hayCuenta(ej)) return numTxt(peso);
  const puesto = esPorLado(ej) ? `${numTxt(peso)}/lado` : `${numTxt(peso)} en discos`;
  return `${numTxt(pesoReal(peso, ej))} (${puesto})`;
}

/** Igual, pero con la unidad donde corresponde: «105 kg (45/lado)». */
export function txtPesoKg(peso: string | number | null | undefined, ej: ConPeso | null | undefined): string {
  if (peso == null || peso === '') return '';
  if (!hayCuenta(ej)) return `${numTxt(peso)} kg`;
  const puesto = esPorLado(ej) ? `${numTxt(peso)}/lado` : `${numTxt(peso)} en discos`;
  return `${numTxt(pesoReal(peso, ej))} kg (${puesto})`;
}
