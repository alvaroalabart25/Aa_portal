import { nombreMusculo, type DiaRutina, type Parte } from './api';

/**
 * Cobertura de una sesión, del 1 al 10.
 *
 * Mide UNA sola cosa: si lo que planificas en la sesión cubre las partes de lo
 * que esa sesión quiere entrenar. El objetivo se deriva de las partes
 * PRINCIPALES de sus ejercicios (el bíceps que trabaja de rebote en un jalón
 * no convierte el día en día de bíceps); para darse por cubierta, a una parte
 * le vale cualquier trabajo, principal o colateral.
 *
 * Fuera quedaron, a petición suya, los criterios de reparto entre bloques (su
 * pierna de 2 ejercicios diarios es un diseño, no un adorno, y un día de solo
 * pecho es legítimo) y el de fichas completas (eso es higiene del dato, no
 * cobertura): el score tiene que valer para cualquier forma de montar días.
 */
export interface BloqueNota {
  id: string;
  label: string;
  /** partes de este bloque cubiertas (por trabajo principal o colateral) */
  cubiertas: number;
  posibles: number;
  /** las que faltan, con ideas del catálogo de partes para cubrirlas */
  faltan: { label: string; ideas: string[] }[];
}

export interface Nota {
  total: number; // 1-10
  cubiertas: number;
  posibles: number;
  bloques: BloqueNota[];
  /** ejercicios que no declaran músculos: no pueden contar, y se dice */
  sinMusculos: string[];
}

const lista = (v: string | null | undefined) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

export function notaDelDia(dia: DiaRutina, partes: Parte[]): Nota | null {
  if (dia.exercises.length === 0) return null;

  const principales = new Set<string>();
  const tocadas = new Set<string>();
  const sinMusculos: string[] = [];
  for (const e of dia.exercises) {
    const suyas = lista(e.parts);
    if (suyas.length === 0) sinMusculos.push(e.name);
    for (const p of suyas) {
      principales.add(p);
      tocadas.add(p);
    }
    for (const p of lista(e.partsSecondary)) tocadas.add(p);
  }

  // El objetivo de la sesión: los bloques a los que pertenecen las principales
  const parteDe = new Map(partes.map((p) => [p.id, p]));
  const bloquesObjetivo = [...new Set([...principales].map((p) => parteDe.get(p)?.muscle).filter(Boolean))] as string[];
  if (bloquesObjetivo.length === 0) return null;

  let cubiertas = 0;
  let posibles = 0;
  const bloques: BloqueNota[] = bloquesObjetivo.map((bloque) => {
    const suyas = partes.filter((p) => p.muscle === bloque);
    const bien = suyas.filter((p) => tocadas.has(p.id));
    const faltan = suyas.filter((p) => !tocadas.has(p.id));
    cubiertas += bien.length;
    posibles += suyas.length;
    return {
      id: bloque,
      label: nombreMusculo(bloque),
      cubiertas: bien.length,
      posibles: suyas.length,
      faltan: faltan.map((p) => ({ label: p.label, ideas: p.ideas.slice(0, 2) })),
    };
  });

  const total = Math.max(1, Math.round((cubiertas / posibles) * 10 * 10) / 10);
  return { total, cubiertas, posibles, bloques, sinMusculos };
}
