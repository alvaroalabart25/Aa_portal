/**
 * Las partes de cada bloque muscular.
 *
 * «Pecho: 31 series» no contesta a la pregunta de verdad, que es si estás
 * tocando todo el bloque o repitiendo siempre la misma zona. Por eso el
 * ejercicio se etiqueta por PARTE y el bloque se calcula a partir de ahí: así
 * no hay dos sitios donde decir lo mismo y poder contradecirse.
 *
 * La lista es corta y de manual, no exhaustiva de anatomía: sirve para ver
 * huecos, no para dar clase.
 */
export const PARTES = [
  { id: 'pecho_superior', label: 'Pecho superior', muscle: 'pecho', ideas: ['Press inclinado (barra o mancuernas)', 'Cruce de poleas de abajo a arriba'] },
  { id: 'pecho_medio', label: 'Pecho medio', muscle: 'pecho', ideas: ['Press banca plano', 'Máquina de aperturas'] },
  { id: 'pecho_inferior', label: 'Pecho inferior', muscle: 'pecho', ideas: ['Fondos en paralelas', 'Cruce de poleas de arriba a abajo'] },

  { id: 'dorsal', label: 'Dorsal (tirón vertical)', muscle: 'espalda', ideas: ['Dominadas', 'Jalón al pecho'] },
  { id: 'espalda_media', label: 'Espalda media (tirón horizontal)', muscle: 'espalda', ideas: ['Remo con barra', 'Remo en polea baja'] },
  { id: 'lumbar', label: 'Lumbar', muscle: 'espalda', ideas: ['Peso muerto', 'Hiperextensiones', 'Buenos días'] },

  { id: 'hombro_anterior', label: 'Hombro anterior', muscle: 'hombro', ideas: ['Press militar', 'Press Arnold', 'Elevaciones frontales'] },
  { id: 'hombro_lateral', label: 'Hombro lateral', muscle: 'hombro', ideas: ['Elevaciones laterales', 'Elevaciones en polea'] },
  { id: 'hombro_posterior', label: 'Hombro posterior', muscle: 'hombro', ideas: ['Pájaros con mancuernas', 'Face pull', 'Aperturas inversas en máquina'] },

  { id: 'trapecio', label: 'Trapecio', muscle: 'trapecio', ideas: ['Encogimientos de hombros', 'Remo al mentón'] },

  { id: 'biceps', label: 'Bíceps', muscle: 'biceps', ideas: ['Curl con barra', 'Curl en polea', 'Curl concentrado'] },
  { id: 'braquial', label: 'Braquial y supinador', muscle: 'biceps', ideas: ['Curl martillo', 'Curl inverso'] },

  { id: 'triceps_largo', label: 'Tríceps · cabeza larga', muscle: 'triceps', ideas: ['Extensión sobre la cabeza', 'Press francés'] },
  { id: 'triceps_lateral', label: 'Tríceps · lateral', muscle: 'triceps', ideas: ['Jalón en polea', 'Fondos en banco'] },

  { id: 'antebrazo', label: 'Antebrazo y agarre', muscle: 'antebrazo', ideas: ['Curl de muñeca', 'Paseo del granjero'] },

  { id: 'abdomen', label: 'Abdomen', muscle: 'core', ideas: ['Plancha', 'Elevaciones de piernas', 'Crunch en polea'] },
  { id: 'oblicuos', label: 'Oblicuos', muscle: 'core', ideas: ['Plancha lateral', 'Leñador en polea', 'Giros rusos'] },

  { id: 'cuadriceps', label: 'Cuádriceps', muscle: 'cuadriceps', ideas: ['Sentadilla', 'Prensa', 'Extensión de cuádriceps'] },

  { id: 'isquios_cadera', label: 'Isquios · desde la cadera', muscle: 'isquios', ideas: ['Peso muerto rumano', 'Buenos días'] },
  { id: 'isquios_rodilla', label: 'Isquios · desde la rodilla', muscle: 'isquios', ideas: ['Curl femoral tumbado', 'Curl femoral sentado'] },

  { id: 'gluteo_mayor', label: 'Glúteo mayor', muscle: 'gluteo', ideas: ['Hip thrust', 'Zancadas', 'Sentadilla profunda'] },
  { id: 'gluteo_medio', label: 'Glúteo medio', muscle: 'gluteo', ideas: ['Abductor en máquina', 'Patada lateral con banda'] },

  { id: 'aductores', label: 'Aductores', muscle: 'aductores', ideas: ['Aductor en máquina', 'Sentadilla sumo'] },

  { id: 'gemelo_gastrocnemio', label: 'Gemelo · de pie', muscle: 'gemelo', ideas: ['Elevación de talones de pie'] },
  { id: 'gemelo_soleo', label: 'Sóleo · sentado', muscle: 'gemelo', ideas: ['Elevación de talones sentado'] },
] as const;

export type ParteId = (typeof PARTES)[number]['id'];

const PARTE_POR_ID = new Map(PARTES.map((p) => [p.id as string, p]));

/** Deja solo partes que existen, sin repetir y en el orden del catálogo. */
export function limpiarPartes(v: string): string {
  const pedidas = new Set(v.split(',').map((x) => x.trim().toLowerCase()));
  return PARTES.filter((p) => pedidas.has(p.id)).map((p) => p.id).join(',');
}

/**
 * Los GRUPOS grandes con los que se declara el objetivo de una sesión.
 *
 * El objetivo es intención («aquí quiero entrenar pierna y espalda») y se
 * declara al crear la sesión; las categorías siguen siendo realidad derivada
 * de los ejercicios. La cobertura compara las dos. Seis opciones, no trece:
 * a ese nivel se piensa un día de gimnasio.
 */
export const GRUPOS = [
  { id: 'pecho', label: 'Pecho', muscles: ['pecho'] },
  { id: 'espalda', label: 'Espalda', muscles: ['espalda'] },
  { id: 'hombros', label: 'Hombros', muscles: ['hombro', 'trapecio'] },
  { id: 'brazos', label: 'Brazos', muscles: ['biceps', 'triceps', 'antebrazo'] },
  { id: 'pierna', label: 'Pierna', muscles: ['cuadriceps', 'isquios', 'gluteo', 'aductores', 'gemelo'] },
  { id: 'core', label: 'Core', muscles: ['core'] },
] as const;

export type GrupoId = (typeof GRUPOS)[number]['id'];

/** Deja solo grupos que existen, sin repetir y en el orden del catálogo. */
export function limpiarGrupos(v: string[]): string {
  const pedidos = new Set(v.map((x) => x.trim().toLowerCase()));
  return GRUPOS.filter((g) => pedidos.has(g.id)).map((g) => g.id).join(',');
}

/** El bloque se calcula de las partes: nunca se escribe a mano. */
export function musculosDePartes(partes: string): string {
  const bloques = new Set<string>();
  for (const id of partes.split(',')) {
    const p = PARTE_POR_ID.get(id.trim());
    if (p) bloques.add(p.muscle);
  }
  return [...bloques].join(',');
}
