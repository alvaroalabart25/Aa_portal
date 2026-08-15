import { GRUPOS, listaMusculos, nombreMusculo, type DiaRutina, type Parte } from './api';

/**
 * Cobertura de una sesión, del 1 al 10.
 *
 * Mide UNA sola cosa: si lo que planificas cubre el OBJETIVO de la sesión.
 *
 * Con objetivo DECLARADO (goalMain/goalSide), se mide contra él sin adivinar:
 *  - lo principal se exige un nivel por debajo de lo declarado — un bloque
 *    concreto (Pecho) exige sus partes; un grupo ancho (Pierna, Brazos) exige
 *    sus bloques;
 *  - lo secundario («mi pierna diaria») solo exige PRESENCIA: al menos un
 *    ejercicio que lo entrene de verdad (el trabajo de rebote no vale como
 *    intención). Si acumula lo suficiente se ve en la cobertura global, no
 *    aquí.
 *
 * Sin objetivo declarado (días antiguos), se deriva de los músculos
 * principales de sus ejercicios, como antes: nada se rompe por no declarar.
 *
 * Fuera quedaron, a petición suya, los criterios de reparto entre bloques y el
 * de fichas completas: el score tiene que valer para cualquier forma de montar
 * días, no solo la suya.
 */
export interface FilaNota {
  id: string;
  label: string;
  /** objetivo secundario: solo presencia, no completitud */
  secundario?: boolean;
  cubiertas: number;
  posibles: number;
  faltan: { label: string; ideas: string[] }[];
}

export interface Nota {
  total: number; // 1-10
  cubiertas: number;
  posibles: number;
  /** true si mide contra un objetivo declarado; false si lo deriva */
  declarado: boolean;
  filas: FilaNota[];
  /** ejercicios que no declaran músculos: no pueden contar, y se dice */
  sinMusculos: string[];
}

export function notaDelDia(dia: DiaRutina, partes: Parte[]): Nota | null {
  if (dia.exercises.length === 0) return null;

  const principales = new Set<string>();
  const tocadas = new Set<string>();
  const sinMusculos: string[] = [];
  for (const e of dia.exercises) {
    const suyas = listaMusculos(e.parts);
    if (suyas.length === 0) sinMusculos.push(e.name);
    for (const p of suyas) {
      principales.add(p);
      tocadas.add(p);
    }
    for (const p of listaMusculos(e.partsSecondary)) tocadas.add(p);
  }

  const parteDe = new Map(partes.map((p) => [p.id, p]));
  const bloquesTocados = new Set([...tocadas].map((p) => parteDe.get(p)?.muscle).filter(Boolean));
  const bloquesPrincipales = new Set([...principales].map((p) => parteDe.get(p)?.muscle).filter(Boolean));

  const goalMain = listaMusculos(dia.goalMain ?? '');
  const goalSide = listaMusculos(dia.goalSide ?? '');
  const declarado = goalMain.length > 0 || goalSide.length > 0;

  const filas: FilaNota[] = [];

  if (declarado) {
    for (const gid of goalMain) {
      const grupo = GRUPOS.find((g) => g.id === gid);
      if (!grupo) continue;
      if (grupo.muscles.length === 1) {
        // bloque concreto: se exigen sus PARTES
        const suyas = partes.filter((p) => p.muscle === grupo.muscles[0]);
        const faltan = suyas.filter((p) => !tocadas.has(p.id));
        filas.push({
          id: gid,
          label: grupo.label,
          cubiertas: suyas.length - faltan.length,
          posibles: suyas.length,
          faltan: faltan.map((p) => ({ label: p.label, ideas: p.ideas.slice(0, 2) })),
        });
      } else {
        // grupo ancho: se exigen sus BLOQUES
        const faltan = grupo.muscles.filter((m) => !bloquesTocados.has(m));
        filas.push({
          id: gid,
          label: grupo.label,
          cubiertas: grupo.muscles.length - faltan.length,
          posibles: grupo.muscles.length,
          faltan: faltan.map((m) => {
            const primera = partes.find((p) => p.muscle === m);
            return { label: nombreMusculo(m), ideas: primera?.ideas.slice(0, 2) ?? [] };
          }),
        });
      }
    }
    for (const gid of goalSide) {
      const grupo = GRUPOS.find((g) => g.id === gid);
      if (!grupo) continue;
      const presente = grupo.muscles.some((m) => bloquesPrincipales.has(m));
      filas.push({
        id: `side-${gid}`,
        label: grupo.label,
        secundario: true,
        cubiertas: presente ? 1 : 0,
        posibles: 1,
        faltan: [],
      });
    }
  } else {
    // sin declarar: el objetivo se deriva de lo que la sesión ya entrena
    for (const bloque of [...bloquesPrincipales] as string[]) {
      const suyas = partes.filter((p) => p.muscle === bloque);
      const faltan = suyas.filter((p) => !tocadas.has(p.id));
      filas.push({
        id: bloque,
        label: nombreMusculo(bloque),
        cubiertas: suyas.length - faltan.length,
        posibles: suyas.length,
        faltan: faltan.map((p) => ({ label: p.label, ideas: p.ideas.slice(0, 2) })),
      });
    }
  }

  const cubiertas = filas.reduce((n, f) => n + f.cubiertas, 0);
  const posibles = filas.reduce((n, f) => n + f.posibles, 0);
  if (posibles === 0) return null;

  const total = Math.max(1, Math.round((cubiertas / posibles) * 10 * 10) / 10);
  return { total, cubiertas, posibles, declarado, filas, sinMusculos };
}
