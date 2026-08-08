import type { DiaRutina, Parte } from './api';

/**
 * Nota del 1 al 10 de un día de rutina.
 *
 * IMPORTANTE: esto es una regla escrita a mano, no ciencia del deporte. Mide
 * cuatro cosas concretas y enseña el desglose siempre, para que se pueda estar
 * en desacuerdo con el número. Un 7 no significa «entrenas un 7»: significa que
 * de estos cuatro criterios cumples estos.
 *
 * No mide si el ejercicio es bueno, si la técnica es correcta ni si el peso es
 * el adecuado. Nada de eso se puede saber desde una tabla.
 */
export interface Criterio {
  id: string;
  label: string;
  puntos: number;
  tope: number;
  detalle: string;
}

export interface Nota {
  total: number;
  criterios: Criterio[];
}

export function notaDelDia(dia: DiaRutina, partes: Parte[]): Nota | null {
  if (dia.exercises.length === 0) return null;

  const parteDe = new Map(partes.map((p) => [p.id, p]));
  const lista = (v: string) => (v ? v.split(',').filter(Boolean) : []);

  // Series por parte y por bloque dentro de ESTE día
  const porParte = new Map<string, number>();
  const porBloque = new Map<string, number>();
  let sinEtiquetar = 0;
  let sinObjetivo = 0;

  for (const e of dia.exercises) {
    const suyas = lista(e.parts);
    if (suyas.length === 0) sinEtiquetar += 1;
    if (!e.targetReps?.trim()) sinObjetivo += 1;
    for (const id of suyas) {
      porParte.set(id, (porParte.get(id) ?? 0) + e.targetSets);
      const bloque = parteDe.get(id)?.muscle;
      if (bloque) porBloque.set(bloque, (porBloque.get(bloque) ?? 0) + e.targetSets);
    }
  }

  const bloques = [...porBloque.keys()];
  const seriesTotales = dia.exercises.reduce((n, e) => n + e.targetSets, 0);

  // 1. De los bloques que toca este día, ¿cubre sus partes o repite zona? (0-4)
  let cubiertas = 0;
  let posibles = 0;
  for (const b of bloques) {
    const suyas = partes.filter((p) => p.muscle === b);
    posibles += suyas.length;
    cubiertas += suyas.filter((p) => porParte.get(p.id)).length;
  }
  const ratio = posibles === 0 ? 0 : cubiertas / posibles;
  const c1: Criterio = {
    id: 'cobertura',
    label: 'Cubre las partes de lo que toca',
    puntos: Math.round(ratio * 4 * 10) / 10,
    tope: 4,
    detalle: `${cubiertas} de ${posibles} partes de los bloques que trabajas hoy`,
  };

  // 2. Volumen por bloque principal: ni testimonial ni todo a uno (0-3)
  const principales = bloques.filter((b) => (porBloque.get(b) ?? 0) >= 3);
  const excesivos = bloques.filter((b) => (porBloque.get(b) ?? 0) > 14);
  let p2 = 3;
  if (principales.length === 0) p2 = 0;
  else if (principales.length === 1) p2 = 1.5;
  if (excesivos.length > 0) p2 = Math.max(0, p2 - 1);
  const c2: Criterio = {
    id: 'volumen',
    label: 'Volumen con sentido',
    puntos: p2,
    tope: 3,
    detalle:
      principales.length === 0
        ? 'ningún bloque llega a 3 series: todo queda testimonial'
        : `${principales.length} ${principales.length === 1 ? 'bloque' : 'bloques'} con 3 series o más${
            excesivos.length ? `, y ${excesivos.join(', ')} por encima de 14` : ''
          }`,
  };

  // 3. Reparto: que un solo bloque no se lleve más de la mitad del día (0-2)
  const mayor = Math.max(0, ...[...porBloque.values()]);
  const cuota = seriesTotales === 0 ? 1 : mayor / seriesTotales;
  const p3 = cuota <= 0.45 ? 2 : cuota <= 0.6 ? 1 : 0;
  const c3: Criterio = {
    id: 'reparto',
    label: 'Reparto entre bloques',
    puntos: p3,
    tope: 2,
    detalle: `el bloque más cargado se lleva el ${Math.round(cuota * 100)} % de las series`,
  };

  // 4. La ficha completa: sin esto el resto del portal miente (0-1)
  const p4 = sinEtiquetar === 0 && sinObjetivo === 0 ? 1 : sinEtiquetar === 0 || sinObjetivo === 0 ? 0.5 : 0;
  const c4: Criterio = {
    id: 'ficha',
    label: 'Ejercicios bien fichados',
    puntos: p4,
    tope: 1,
    detalle:
      sinEtiquetar === 0 && sinObjetivo === 0
        ? 'todos con músculos y objetivo'
        : `${sinEtiquetar} sin músculos, ${sinObjetivo} sin objetivo de repes`,
  };

  const criterios = [c1, c2, c3, c4];
  const bruto = criterios.reduce((n, c) => n + c.puntos, 0);
  // de 1 a 10: un día con ejercicios nunca es un 0
  return { total: Math.max(1, Math.round(bruto * 10) / 10), criterios };
}
