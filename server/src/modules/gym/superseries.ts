/**
 * Vincular y soltar superseries.
 *
 * Vive aparte porque lo necesitan dos sitios que no pueden importarse entre
 * ellos: la ruta del gimnasio (cuando TÚ montas la superserie) y el aceptar de
 * sugerencias (cuando coges la que montó la cuenta vinculada).
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { gymExercises } from '../../db/schema';

/**
 * Une dos ejercicios del mismo día en un grupo y recoloca a los miembros
 * adyacentes. Devuelve el id del grupo, o null si algo no cuadra.
 */
export async function vincularSuperserie(userId: number, aId: number, bId: number): Promise<number | null> {
  const filas = await db
    .select()
    .from(gymExercises)
    .where(and(inArray(gymExercises.id, [aId, bId]), eq(gymExercises.userId, userId), isNull(gymExercises.archivedAt)));
  const a = filas.find((x) => x.id === aId);
  const b = filas.find((x) => x.id === bId);
  if (!a || !b || a.dayId !== b.dayId || a.id === b.id) return null;

  const grupo = b.supersetId ?? a.supersetId ?? a.id;
  await db.update(gymExercises).set({ supersetId: grupo }).where(inArray(gymExercises.id, [a.id, b.id]));

  const todos = await db
    .select({ id: gymExercises.id, sortOrder: gymExercises.sortOrder, supersetId: gymExercises.supersetId })
    .from(gymExercises)
    .where(and(eq(gymExercises.dayId, a.dayId), isNull(gymExercises.archivedAt), isNull(gymExercises.proposedAt)))
    .orderBy(asc(gymExercises.sortOrder), asc(gymExercises.id));
  const delGrupo = todos.filter((e) => e.supersetId === grupo);
  const resto = todos.filter((e) => e.supersetId !== grupo);
  const primera = todos.findIndex((e) => e.supersetId === grupo);
  const orden = [...resto.slice(0, primera), ...delGrupo, ...resto.slice(primera)];
  for (let i = 0; i < orden.length; i += 1) {
    if (orden[i].sortOrder !== i) await db.update(gymExercises).set({ sortOrder: i }).where(eq(gymExercises.id, orden[i].id));
  }
  return grupo;
}

/**
 * Saca un ejercicio de su grupo. Si el grupo se queda con un solo miembro,
 * ese también se limpia: una superserie de uno no es nada.
 * Devuelve los ejercicios que formaban el grupo (para poder avisar con nombres).
 */
export async function soltarSuperserie(userId: number, exId: number) {
  const [ej] = await db
    .select()
    .from(gymExercises)
    .where(and(eq(gymExercises.id, exId), eq(gymExercises.userId, userId), isNull(gymExercises.archivedAt)));
  if (!ej || ej.supersetId == null) return null;

  const grupo = await db
    .select()
    .from(gymExercises)
    .where(and(eq(gymExercises.supersetId, ej.supersetId), isNull(gymExercises.archivedAt)));

  await db.update(gymExercises).set({ supersetId: null }).where(eq(gymExercises.id, exId));
  const resto = grupo.filter((x) => x.id !== exId);
  if (resto.length === 1) {
    await db.update(gymExercises).set({ supersetId: null }).where(eq(gymExercises.id, resto[0].id));
  }
  return grupo;
}
