/**
 * Las preguntas de Persona.
 *
 * No son un test ni un cuestionario: son una excusa para empezar a escribir el
 * día que no sabes por dónde. Por eso están escritas para poder ignorarse —la
 * caja siempre está en blanco y admite cualquier cosa—, y por eso son concretas:
 * «¿qué te ha dado energía esta semana?» se contesta; «¿quién eres?» no.
 *
 * De momento es una lista a mano. Cuando el módulo tenga forma sabremos si hay
 * que agruparlas por terreno o encadenarlas.
 */
export const PREGUNTAS: string[] = [
  '¿Qué te ha dado energía esta semana? ¿Y qué te la ha quitado?',
  '¿Qué has evitado hoy? ¿Por qué crees que lo evitaste?',
  '¿En qué momento de hoy has estado más tú?',
  '¿Qué te ha cabreado esta semana? ¿Qué dice eso de lo que te importa?',
  '¿Qué haces cuando nadie te lo pide?',
  'Algo que creías de ti hace cinco años y ya no.',
  '¿Con quién te sientes bien sin tener que hacer nada? ¿Por qué con esa persona?',
  '¿Qué se te da bien que a ti te parece normal?',
  'Una decisión que cambió tu vida. ¿La tomaste tú o te la tomaron?',
  '¿Qué te da miedo que no le contarías a nadie?',
  '¿Qué parte de tu día repetirías mañana igual?',
  '¿Qué esperas de ti que nadie más te está pidiendo?',
  '¿Cuándo fue la última vez que cambiaste de opinión sobre algo importante?',
  '¿Qué te aburre? ¿Y qué te aburre que crees que NO debería aburrirte?',
  'Si tuvieras un mes libre de verdad, ¿qué harías la primera semana?',
  '¿Qué envidias de otra persona? Sin juzgarte, solo apúntalo.',
  '¿Qué necesitas para dormir tranquilo?',
  '¿Qué te dices a ti mismo cuando algo sale mal?',
  '¿Qué has aprendido este mes que no sabías el anterior?',
  '¿De qué te arrepientes menos de lo que creías?',
  '¿Qué haces por costumbre y ya no sabes por qué lo haces?',
  '¿Qué te gustaría que dijeran de ti los que trabajan contigo?',
  'Un momento de tu vida al que volverías solo para mirarlo.',
  '¿Qué estás aguantando ahora mismo que no deberías aguantar?',
  '¿Qué te sale natural que a los demás les cuesta?',
  '¿Qué versión tuya echas de menos?',
  '¿Qué te has demostrado este año?',
  'Algo que hiciste hoy y que hace un año no habrías hecho.',
];

/**
 * La pregunta de un día. Sale de la fecha, no del azar: entrar dos veces el
 * mismo día tiene que enseñar la misma, o deja de ser una pregunta y pasa a ser
 * una máquina tragaperras.
 */
export function preguntaDe(fecha: string): string {
  const n = [...fecha].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 100000, 7);
  return PREGUNTAS[n % PREGUNTAS.length];
}
