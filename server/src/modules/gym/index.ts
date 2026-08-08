import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { gymDays, gymExercises, gymGoals, gymSessions, gymSets, healthEntries } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';

/**
 * Gimnasio: la rutina y lo que de verdad se levanta.
 *
 * Dos cosas y no una: la rutina es lo que TOCA hacer (días, ejercicios,
 * objetivos) y la sesión es lo que SE HIZO (serie a serie, con su peso y sus
 * repeticiones). Guardar las dos por separado es lo que permite comparar, que
 * es de lo que va entrenar.
 *
 * Se guarda serie a serie y con hora, no un resumen por ejercicio: un número
 * medio esconde que la cuarta serie se cae siempre, y sin las horas no hay
 * forma de sacar después cuánto duró ni cómo evolucionó.
 */
export const gymModule = Router();

/** Lista cerrada. Con texto libre se puede pintar la etiqueta, pero no contar
 *  qué bloque muscular se está quedando sin trabajar. */
export const MUSCULOS = [
  'pecho',
  'espalda',
  'hombro',
  'trapecio',
  'biceps',
  'triceps',
  'antebrazo',
  'core',
  'cuadriceps',
  'isquios',
  'gluteo',
  'aductores',
  'gemelo',
] as const;

function hoyMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', dateStyle: 'short' }).format(new Date());
}

const limpiarMusculos = (v: string) =>
  [...new Set(v.split(',').map((m) => m.trim().toLowerCase()).filter((m) => (MUSCULOS as readonly string[]).includes(m)))].join(',');

// ---------- La rutina ----------

/**
 * GET /rutina — los días con sus ejercicios y, por día, cuándo se hizo la
 * última vez. Con eso el cliente sabe qué toca sin preguntar otra vez.
 */
gymModule.get('/rutina', ah(async (req: AuthedRequest, res) => {
  const dias = await db
    .select({
      id: gymDays.id,
      name: gymDays.name,
      notes: gymDays.notes,
      sortOrder: gymDays.sortOrder,
      // ojo: la columna de fuera va escrita a mano, no interpolada — Drizzle la
      // generaría sin cualificar y la capturaría la tabla de dentro
      lastDone: sql<string | null>`(
        select max(s.session_date) from gym_sessions s
        where s.day_id = gym_days.id and s.ended_at is not null
      )`,
      sessions: sql<number>`(select count(*) from gym_sessions s where s.day_id = gym_days.id and s.ended_at is not null)`,
    })
    .from(gymDays)
    .where(and(eq(gymDays.userId, req.userId!), isNull(gymDays.archivedAt)))
    .orderBy(asc(gymDays.sortOrder), asc(gymDays.id));

  const ids = dias.map((d) => d.id);
  const ejercicios = ids.length
    ? await db
        .select()
        .from(gymExercises)
        .where(and(eq(gymExercises.userId, req.userId!), isNull(gymExercises.archivedAt), inArray(gymExercises.dayId, ids)))
        .orderBy(asc(gymExercises.sortOrder), asc(gymExercises.id))
    : [];

  res.json({
    today: hoyMadrid(),
    days: dias.map((d) => ({
      ...d,
      exercises: ejercicios.filter((e) => e.dayId === d.id),
    })),
  });
}));

const diaInput = z.object({ name: z.string().trim().min(1).max(120), notes: z.string().max(4000).nullish() });

gymModule.post('/dias', ah(async (req: AuthedRequest, res) => {
  const parsed = diaInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(gymDays)
    .where(and(eq(gymDays.userId, req.userId!), isNull(gymDays.archivedAt)));
  const [r] = await db.insert(gymDays).values({ ...parsed.data, userId: req.userId!, sortOrder: Number(n) });
  const [row] = await db.select().from(gymDays).where(eq(gymDays.id, r.insertId));
  res.status(201).json(row);
}));

gymModule.patch('/dias/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const parsed = diaInput.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [r] = await db
    .update(gymDays)
    .set(parsed.data)
    .where(and(eq(gymDays.id, Number(req.params.id)), eq(gymDays.userId, req.userId!)));
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Día no encontrado' });
  const [row] = await db.select().from(gymDays).where(eq(gymDays.id, Number(req.params.id)));
  res.json(row);
}));

gymModule.delete('/dias/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const [r] = await db
    .update(gymDays)
    .set({ archivedAt: new Date() })
    .where(and(eq(gymDays.id, Number(req.params.id)), eq(gymDays.userId, req.userId!)));
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Día no encontrado' });
  res.json({ archived: true });
}));

const ejercicioInput = z.object({
  dayId: z.number().int().positive(),
  name: z.string().trim().min(1).max(160),
  muscles: z.string().max(240).default(''),
  kind: z.enum(['repes', 'tiempo']).default('repes'),
  targetSets: z.number().int().min(1).max(20).default(4),
  targetReps: z.string().trim().max(20).default('8-10'),
  targetWeight: z.number().nullish(),
  restSeconds: z.number().int().min(0).max(900).nullish(),
  notes: z.string().max(4000).nullish(),
});

gymModule.post('/ejercicios', ah(async (req: AuthedRequest, res) => {
  const parsed = ejercicioInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [dia] = await db
    .select({ id: gymDays.id })
    .from(gymDays)
    .where(and(eq(gymDays.id, parsed.data.dayId), eq(gymDays.userId, req.userId!)));
  if (!dia) return res.status(400).json({ error: 'Ese día no existe' });

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(gymExercises)
    .where(and(eq(gymExercises.dayId, parsed.data.dayId), isNull(gymExercises.archivedAt)));

  const { targetWeight, ...resto } = parsed.data;
  const [r] = await db.insert(gymExercises).values({
    ...resto,
    muscles: limpiarMusculos(resto.muscles),
    targetWeight: targetWeight == null ? null : String(targetWeight),
    userId: req.userId!,
    sortOrder: Number(n),
  });
  const [row] = await db.select().from(gymExercises).where(eq(gymExercises.id, r.insertId));
  res.status(201).json(row);
}));

gymModule.patch('/ejercicios/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const parsed = ejercicioInput.omit({ dayId: true }).partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { targetWeight, muscles, ...resto } = parsed.data;
  const datos: Record<string, unknown> = { ...resto };
  if (targetWeight !== undefined) datos.targetWeight = targetWeight == null ? null : String(targetWeight);
  if (muscles !== undefined) datos.muscles = limpiarMusculos(muscles);
  const [r] = await db
    .update(gymExercises)
    .set(datos)
    .where(and(eq(gymExercises.id, Number(req.params.id)), eq(gymExercises.userId, req.userId!)));
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Ejercicio no encontrado' });
  const [row] = await db.select().from(gymExercises).where(eq(gymExercises.id, Number(req.params.id)));
  res.json(row);
}));

gymModule.delete('/ejercicios/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const [r] = await db
    .update(gymExercises)
    .set({ archivedAt: new Date() })
    .where(and(eq(gymExercises.id, Number(req.params.id)), eq(gymExercises.userId, req.userId!)));
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Ejercicio no encontrado' });
  res.json({ archived: true });
}));

/** Reordenar dentro de un día (o los días entre sí, según `que`). */
gymModule.post('/orden', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ que: z.enum(['dias', 'ejercicios']), ids: z.array(z.number().int().positive()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const tabla = parsed.data.que === 'dias' ? gymDays : gymExercises;
  for (let i = 0; i < parsed.data.ids.length; i += 1) {
    await db
      .update(tabla)
      .set({ sortOrder: i })
      .where(and(eq(tabla.id, parsed.data.ids[i]), eq(tabla.userId, req.userId!)));
  }
  res.json({ ok: true });
}));

// ---------- Entrenar ----------

/**
 * GET /sesion/abierta — la sesión sin terminar, si la hay. Entrar al gimnasio
 * y que el móvil se haya reiniciado no puede costarte el entrenamiento.
 */
gymModule.get('/sesion/abierta', ah(async (req: AuthedRequest, res) => {
  const [row] = await db
    .select()
    .from(gymSessions)
    .where(and(eq(gymSessions.userId, req.userId!), isNull(gymSessions.endedAt)))
    .orderBy(desc(gymSessions.startedAt))
    .limit(1);
  res.json(row ?? null);
}));

gymModule.post('/sesiones', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ dayId: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [dia] = await db
    .select({ id: gymDays.id })
    .from(gymDays)
    .where(and(eq(gymDays.id, parsed.data.dayId), eq(gymDays.userId, req.userId!)));
  if (!dia) return res.status(400).json({ error: 'Ese día no existe' });

  // Una sesión abierta a la vez: si quedó una a medias, se sigue esa
  const [abierta] = await db
    .select()
    .from(gymSessions)
    .where(and(eq(gymSessions.userId, req.userId!), isNull(gymSessions.endedAt)));
  if (abierta) return res.json(abierta);

  const [r] = await db
    .insert(gymSessions)
    .values({ userId: req.userId!, dayId: parsed.data.dayId, sessionDate: hoyMadrid() });
  const [row] = await db.select().from(gymSessions).where(eq(gymSessions.id, r.insertId));
  res.status(201).json(row);
}));

/**
 * GET /sesiones/:id — la sesión con sus ejercicios, lo ya hecho hoy y lo que
 * se hizo la última vez en cada uno. Eso último es lo que dice si hoy subes.
 */
gymModule.get('/sesiones/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [sesion] = await db
    .select()
    .from(gymSessions)
    .where(and(eq(gymSessions.id, id), eq(gymSessions.userId, req.userId!)));
  if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' });

  const [dia] = await db.select().from(gymDays).where(eq(gymDays.id, sesion.dayId));
  const ejercicios = await db
    .select()
    .from(gymExercises)
    .where(and(eq(gymExercises.dayId, sesion.dayId), isNull(gymExercises.archivedAt)))
    .orderBy(asc(gymExercises.sortOrder), asc(gymExercises.id));

  const hechas = await db
    .select()
    .from(gymSets)
    .where(eq(gymSets.sessionId, id))
    .orderBy(asc(gymSets.exerciseId), asc(gymSets.setNumber));

  // La vez anterior de cada ejercicio, en una sola consulta
  const ids = ejercicios.map((e) => e.id);
  const anteriores = ids.length
    ? await db
        .select({
          exerciseId: gymSets.exerciseId,
          setNumber: gymSets.setNumber,
          reps: gymSets.reps,
          seconds: gymSets.seconds,
          weight: gymSets.weight,
          sessionDate: gymSessions.sessionDate,
        })
        .from(gymSets)
        .innerJoin(gymSessions, eq(gymSets.sessionId, gymSessions.id))
        .where(and(eq(gymSets.userId, req.userId!), inArray(gymSets.exerciseId, ids), sql`${gymSets.sessionId} <> ${id}`))
        .orderBy(desc(gymSessions.sessionDate), desc(gymSets.sessionId), asc(gymSets.setNumber))
    : [];

  // solo la sesión más reciente de cada ejercicio
  const previa = new Map<number, typeof anteriores>();
  const fechaDe = new Map<number, string>();
  for (const s of anteriores) {
    if (!fechaDe.has(s.exerciseId)) fechaDe.set(s.exerciseId, s.sessionDate);
    if (fechaDe.get(s.exerciseId) !== s.sessionDate) continue;
    if (!previa.has(s.exerciseId)) previa.set(s.exerciseId, []);
    previa.get(s.exerciseId)!.push(s);
  }

  res.json({
    session: sesion,
    day: dia ?? null,
    exercises: ejercicios.map((e) => ({
      ...e,
      done: hechas.filter((h) => h.exerciseId === e.id),
      previous: { date: fechaDe.get(e.id) ?? null, sets: previa.get(e.id) ?? [] },
    })),
  });
}));

const serieInput = z.object({
  exerciseId: z.number().int().positive(),
  setNumber: z.number().int().min(1).max(30),
  reps: z.number().int().min(0).max(1000).nullish(),
  seconds: z.number().int().min(0).max(7200).nullish(),
  weight: z.number().min(0).max(999).nullish(),
});

gymModule.post('/sesiones/:id(\\d+)/series', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = serieInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const [sesion] = await db
    .select()
    .from(gymSessions)
    .where(and(eq(gymSessions.id, id), eq(gymSessions.userId, req.userId!)));
  if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' });
  const [ejercicio] = await db
    .select()
    .from(gymExercises)
    .where(and(eq(gymExercises.id, parsed.data.exerciseId), eq(gymExercises.userId, req.userId!)));
  if (!ejercicio) return res.status(400).json({ error: 'Ese ejercicio no existe' });

  // Repetir la misma serie la corrige, no la duplica
  await db
    .delete(gymSets)
    .where(
      and(
        eq(gymSets.sessionId, id),
        eq(gymSets.exerciseId, parsed.data.exerciseId),
        eq(gymSets.setNumber, parsed.data.setNumber),
      ),
    );

  const { weight, ...resto } = parsed.data;
  const [r] = await db.insert(gymSets).values({
    ...resto,
    weight: weight == null ? null : String(weight),
    // el nombre viaja con la serie: la rutina cambia y el histórico no puede
    // quedarse sin saber qué se levantó
    exerciseName: ejercicio.name,
    sessionId: id,
    userId: req.userId!,
  });
  const [row] = await db.select().from(gymSets).where(eq(gymSets.id, r.insertId));
  res.status(201).json(row);
}));

gymModule.delete('/sesiones/:id(\\d+)/series/:serie(\\d+)', ah(async (req: AuthedRequest, res) => {
  const [r] = await db
    .delete(gymSets)
    .where(and(eq(gymSets.id, Number(req.params.serie)), eq(gymSets.userId, req.userId!)));
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Serie no encontrada' });
  res.json({ deleted: true });
}));

gymModule.post('/sesiones/:id(\\d+)/cerrar', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ notes: z.string().max(4000).nullish() }).safeParse(req.body ?? {});
  const [r] = await db
    .update(gymSessions)
    .set({ endedAt: new Date(), ...(parsed.success && parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}) })
    .where(and(eq(gymSessions.id, id), eq(gymSessions.userId, req.userId!), isNull(gymSessions.endedAt)));
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Sesión no encontrada o ya cerrada' });
  const [row] = await db.select().from(gymSessions).where(eq(gymSessions.id, id));
  res.json(row);
}));

/** Tirar una sesión a la basura (se abrió por error y no se hizo nada). */
gymModule.delete('/sesiones/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [sesion] = await db
    .select()
    .from(gymSessions)
    .where(and(eq(gymSessions.id, id), eq(gymSessions.userId, req.userId!)));
  if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' });
  await db.delete(gymSets).where(and(eq(gymSets.sessionId, id), eq(gymSets.userId, req.userId!)));
  await db.delete(gymSessions).where(and(eq(gymSessions.id, id), eq(gymSessions.userId, req.userId!)));
  res.json({ deleted: true });
}));

/**
 * GET /historial — las últimas sesiones cerradas con su volumen y duración.
 * Es la materia prima de las gráficas de evolución: por eso van los números
 * crudos y no un texto ya montado.
 */
gymModule.get('/historial', ah(async (req: AuthedRequest, res) => {
  const limite = Math.min(Number(req.query.limit ?? 30) || 30, 200);
  const filas = await db
    .select({
      id: gymSessions.id,
      dayId: gymSessions.dayId,
      dayName: gymDays.name,
      sessionDate: gymSessions.sessionDate,
      startedAt: gymSessions.startedAt,
      endedAt: gymSessions.endedAt,
      notes: gymSessions.notes,
      sets: sql<number>`(select count(*) from gym_sets gs where gs.session_id = gym_sessions.id)`,
      // volumen = suma de peso × repeticiones; sin peso (dominadas) no suma
      volume: sql<string | null>`(
        select sum(gs.weight * gs.reps) from gym_sets gs
        where gs.session_id = gym_sessions.id and gs.weight is not null and gs.reps is not null
      )`,
    })
    .from(gymSessions)
    .innerJoin(gymDays, eq(gymSessions.dayId, gymDays.id))
    .where(and(eq(gymSessions.userId, req.userId!), sql`${gymSessions.endedAt} is not null`))
    .orderBy(desc(gymSessions.sessionDate), desc(gymSessions.id))
    .limit(limite);
  res.json(filas);
}));

// ---------- Objetivos ----------

const metaInput = z.object({
  kind: z.enum(['fase', 'peso', 'ejercicio', 'libre']).default('libre'),
  title: z.string().trim().min(1).max(160),
  exerciseId: z.number().int().positive().nullish(),
  startValue: z.number().nullish(),
  targetValue: z.number().nullish(),
  unit: z.string().max(10).nullish(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  notes: z.string().max(4000).nullish(),
  status: z.enum(['activo', 'logrado', 'aparcado']).optional(),
});

const aDecimal = (v: number | null | undefined) => (v == null ? null : String(v));

/**
 * GET /objetivos — con el valor de HOY calculado, cada uno de donde toca:
 * el peso corporal de Salud · Diario, y el de un ejercicio, del máximo que has
 * levantado en él. Nada de pedirte el mismo número dos veces.
 */
gymModule.get('/objetivos', ah(async (req: AuthedRequest, res) => {
  const metas = await db
    .select()
    .from(gymGoals)
    .where(eq(gymGoals.userId, req.userId!))
    .orderBy(asc(gymGoals.sortOrder), asc(gymGoals.id));

  const [peso] = await db
    .select({ value: healthEntries.value, entryDate: healthEntries.entryDate })
    .from(healthEntries)
    .where(and(eq(healthEntries.userId, req.userId!), eq(healthEntries.kind, 'peso')))
    .orderBy(desc(healthEntries.entryDate), desc(healthEntries.id))
    .limit(1);

  const idsEj = metas.filter((m) => m.kind === 'ejercicio' && m.exerciseId).map((m) => m.exerciseId!);
  const topes = idsEj.length
    ? await db
        .select({ exerciseId: gymSets.exerciseId, top: sql<string | null>`max(${gymSets.weight})` })
        .from(gymSets)
        .where(and(eq(gymSets.userId, req.userId!), inArray(gymSets.exerciseId, idsEj)))
        .groupBy(gymSets.exerciseId)
    : [];

  res.json(
    metas.map((m) => ({
      ...m,
      current:
        m.kind === 'peso'
          ? (peso?.value ?? null)
          : m.kind === 'ejercicio'
            ? Number(topes.find((t) => t.exerciseId === m.exerciseId)?.top ?? 0) || null
            : null,
      currentDate: m.kind === 'peso' ? (peso?.entryDate ?? null) : null,
    })),
  );
}));

gymModule.post('/objetivos', ah(async (req: AuthedRequest, res) => {
  const parsed = metaInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(gymGoals).where(eq(gymGoals.userId, req.userId!));
  const { startValue, targetValue, ...resto } = parsed.data;

  // Sin punto de salida el avance no significa nada: ir de 79 a 80 kg saldría
  // como un 99 % hecho. Si no se indica, la salida es donde estás hoy.
  let salida = startValue ?? null;
  if (salida == null && resto.kind === 'peso') {
    const [hoy] = await db
      .select({ value: healthEntries.value })
      .from(healthEntries)
      .where(and(eq(healthEntries.userId, req.userId!), eq(healthEntries.kind, 'peso')))
      .orderBy(desc(healthEntries.entryDate), desc(healthEntries.id))
      .limit(1);
    salida = hoy?.value ?? null;
  }
  if (salida == null && resto.kind === 'ejercicio' && resto.exerciseId) {
    const [top] = await db
      .select({ top: sql<string | null>`max(${gymSets.weight})` })
      .from(gymSets)
      .where(and(eq(gymSets.userId, req.userId!), eq(gymSets.exerciseId, resto.exerciseId)));
    salida = top?.top == null ? null : Number(top.top);
  }

  const [r] = await db.insert(gymGoals).values({
    ...resto,
    startValue: aDecimal(salida),
    targetValue: aDecimal(targetValue),
    userId: req.userId!,
    sortOrder: Number(n),
  });
  const [row] = await db.select().from(gymGoals).where(eq(gymGoals.id, r.insertId));
  res.status(201).json(row);
}));

gymModule.patch('/objetivos/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const parsed = metaInput.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { startValue, targetValue, ...resto } = parsed.data;
  const datos: Record<string, unknown> = { ...resto };
  if (startValue !== undefined) datos.startValue = aDecimal(startValue);
  if (targetValue !== undefined) datos.targetValue = aDecimal(targetValue);
  if (parsed.data.status === 'logrado') datos.achievedAt = hoyMadrid();
  if (parsed.data.status === 'activo') datos.achievedAt = null;
  const [r] = await db
    .update(gymGoals)
    .set(datos)
    .where(and(eq(gymGoals.id, Number(req.params.id)), eq(gymGoals.userId, req.userId!)));
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Objetivo no encontrado' });
  const [row] = await db.select().from(gymGoals).where(eq(gymGoals.id, Number(req.params.id)));
  res.json(row);
}));

gymModule.delete('/objetivos/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const [r] = await db
    .delete(gymGoals)
    .where(and(eq(gymGoals.id, Number(req.params.id)), eq(gymGoals.userId, req.userId!)));
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Objetivo no encontrado' });
  res.json({ deleted: true });
}));
