import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { gymConditions, gymDays, gymExercises, gymGoals, gymSessions, gymSets, healthEntries } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';
import { limpiarPartes, musculosDePartes, PARTES } from './partes';
import { compartirRouter, emitirCambio, romperVinculosDeDia } from './compartir';
import { asegurarIdentidad, catalogoRouter } from './catalogo';
import { soltarSuperserie, vincularSuperserie } from './superseries';

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

// Compartir la rutina con otra cuenta vive en su propio fichero: es la única
// parte del portal donde dos cuentas se tocan, y conviene poder leerla entera.
gymModule.use(compartirRouter);
gymModule.use(catalogoRouter);

/** Los bloques. Los ejercicios se etiquetan por PARTE (ver partes.ts) y el
 *  bloque sale de ahí; esta lista la usan los condicionantes, que sí van por
 *  zona entera («el hombro derecho»). */
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

/** GET /partes — el catálogo, para que el cliente no lo copie y se desincronice. */
gymModule.get('/partes', ah(async (_req, res) => {
  res.json(PARTES);
}));

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
      muscles: gymDays.muscles,
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
      // El plan y lo improvisado van separados: un ejercicio que metiste sobre
      // la marcha entrenando NO es parte de la rutina hasta que lo aceptas.
      exercises: ejercicios.filter((e) => e.dayId === d.id && !e.proposedAt),
      proposed: ejercicios.filter((e) => e.dayId === d.id && e.proposedAt),
    })),
  });
}));

const diaInput = z.object({
  name: z.string().trim().min(1).max(120),
  notes: z.string().max(4000).nullish(),
  // los bloques de la sesión: lista cerrada, lo que no exista se descarta
  muscles: z
    .array(z.string())
    .transform((v) => v.filter((m) => (MUSCULOS as readonly string[]).includes(m)).join(','))
    .optional(),
});

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
  // Su ejemplo: al borrar «Full body» esa sesión se desconecta y deja de llegar
  // nada de ella. Los demás vínculos siguen vivos.
  await romperVinculosDeDia(Number(req.params.id));
  res.json({ archived: true });
}));

const ejercicioInput = z.object({
  dayId: z.number().int().positive(),
  // Con catalogId el nombre y las partes vienen de la lista; sin él, el camino
  // manual sigue existiendo pero pasa igualmente por el catálogo (privado).
  catalogId: z.number().int().positive().nullish(),
  name: z.string().trim().min(1).max(160),
  parts: z.string().max(320).default(''),
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

  const { targetWeight, parts, catalogId, ...resto } = parsed.data;
  // Identidad SIEMPRE: venga de la lista o escrito a mano. Es lo que evita los
  // duplicados y lo que mantiene el histórico unido cuando la rutina cambia.
  const ident = await asegurarIdentidad(req.userId!, { catalogId, name: parsed.data.name, parts, kind: parsed.data.kind });
  const partes = catalogId ? ident.parts : limpiarPartes(parts);
  const [r] = await db.insert(gymExercises).values({
    ...resto,
    name: ident.name,
    kind: catalogId ? ident.kind : parsed.data.kind,
    catalogId: ident.id,
    parts: partes,
    // el bloque se deriva de las partes: un solo sitio donde decirlo
    muscles: musculosDePartes(partes),
    targetWeight: targetWeight == null ? null : String(targetWeight),
    userId: req.userId!,
    sortOrder: Number(n),
  });
  const [row] = await db.select().from(gymExercises).where(eq(gymExercises.id, r.insertId));
  await emitirCambio({
    userId: req.userId!,
    dayId: row.dayId,
    kind: 'alta',
    name: row.name,
    exerciseKind: row.kind,
    parts: row.parts,
  });
  res.status(201).json(row);
}));

gymModule.patch('/ejercicios/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const parsed = ejercicioInput.omit({ dayId: true }).partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { targetWeight, parts, ...resto } = parsed.data;
  const datos: Record<string, unknown> = { ...resto };
  if (targetWeight !== undefined) datos.targetWeight = targetWeight == null ? null : String(targetWeight);
  if (parts !== undefined) {
    const partes = limpiarPartes(parts);
    datos.parts = partes;
    datos.muscles = musculosDePartes(partes);
  }
  const [r] = await db
    .update(gymExercises)
    .set(datos)
    .where(and(eq(gymExercises.id, Number(req.params.id)), eq(gymExercises.userId, req.userId!)));
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Ejercicio no encontrado' });
  const [row] = await db.select().from(gymExercises).where(eq(gymExercises.id, Number(req.params.id)));
  // Editar un ejercicio NO avisa a nadie: el objetivo (series × repeticiones),
  // el peso y las notas son de cada uno. Solo viajan las altas y las bajas.
  res.json(row);
}));

gymModule.delete('/ejercicios/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const [antes] = await db
    .select()
    .from(gymExercises)
    .where(and(eq(gymExercises.id, Number(req.params.id)), eq(gymExercises.userId, req.userId!)));
  const [r] = await db
    .update(gymExercises)
    .set({ archivedAt: new Date() })
    .where(and(eq(gymExercises.id, Number(req.params.id)), eq(gymExercises.userId, req.userId!)));
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Ejercicio no encontrado' });
  if (antes && !antes.proposedAt) {
    await emitirCambio({
      userId: req.userId!,
      dayId: antes.dayId,
      kind: 'baja',
      name: antes.name,
      exerciseKind: antes.kind,
      parts: antes.parts,
      catalogId: antes.catalogId,
    });
  }
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
  if (!row) return res.json(null);

  // Una sesión de otro día sin una sola serie no es un entrenamiento a medias:
  // es un botón mal pulsado. Se tira sola, para no dejar la pantalla bloqueada
  // hasta que alguien se acuerde. Con series apuntadas NO se toca: eso es
  // trabajo hecho y solo él puede decidir qué hacer con ello.
  if (row.sessionDate < hoyMadrid()) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(gymSets).where(eq(gymSets.sessionId, row.id));
    if (Number(n) === 0) {
      await db.delete(gymSessions).where(eq(gymSessions.id, row.id));
      return res.json(null);
    }
  }
  res.json(row);
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
  // El plan del día MÁS lo improvisado en esta sesión. Lo improvisado en otra
  // sesión anterior no aparece: se propuso en su día y se resolvió allí.
  const ejercicios = await db
    .select()
    .from(gymExercises)
    .where(
      and(
        eq(gymExercises.dayId, sesion.dayId),
        eq(gymExercises.userId, req.userId!),
        isNull(gymExercises.archivedAt),
        or(isNull(gymExercises.proposedAt), eq(gymExercises.proposedFrom, id)),
      ),
    )
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

  // Lo que sueles descansar en cada ejercicio. Con esto el cliente puede
  // proponer un descanso que se parezca a tu realidad y no a un número redondo.
  const medias = ids.length
    ? await db
        .select({ exerciseId: gymSets.exerciseId, media: sql<string | null>`avg(${gymSets.restBefore})` })
        .from(gymSets)
        .where(and(eq(gymSets.userId, req.userId!), inArray(gymSets.exerciseId, ids), sql`${gymSets.restBefore} is not null`))
        .groupBy(gymSets.exerciseId)
    : [];

  res.json({
    session: sesion,
    day: dia ?? null,
    exercises: ejercicios.map((e) => ({
      ...e,
      done: hechas.filter((h) => h.exerciseId === e.id),
      previous: { date: fechaDe.get(e.id) ?? null, sets: previa.get(e.id) ?? [] },
      restAvg: Math.round(Number(medias.find((m) => m.exerciseId === e.id)?.media ?? 0)) || null,
    })),
  });
}));

const serieInput = z.object({
  exerciseId: z.number().int().positive(),
  setNumber: z.number().int().min(1).max(30),
  reps: z.number().int().min(0).max(1000).nullish(),
  plannedReps: z.number().int().min(0).max(1000).nullish(),
  seconds: z.number().int().min(0).max(7200).nullish(),
  weight: z.number().min(0).max(999).nullish(),
  // segundos descansados antes de la serie y lo que duró la serie
  restBefore: z.number().int().min(0).max(7200).nullish(),
  duration: z.number().int().min(0).max(7200).nullish(),
  punishment: z.boolean().optional(),
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

  const { weight, punishment, ...resto } = parsed.data;
  const [r] = await db.insert(gymSets).values({
    ...resto,
    punishment: punishment ? 1 : 0,
    weight: weight == null ? null : String(weight),
    // el nombre viaja con la serie: la rutina cambia y el histórico no puede
    // quedarse sin saber qué se levantó
    exerciseName: ejercicio.name,
    sessionId: id,
    userId: req.userId!,
  });
  // Apuntar una serie es la prueba de que sigues entrenando: se rearma el aviso
  // para que pueda volver a saltar si te paras de nuevo.
  await db.update(gymSessions).set({ nudgedAt: null }).where(eq(gymSessions.id, id));

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

/**
 * PATCH /sesiones/:id — cambiar de día una sesión que se abrió equivocada.
 *
 * Solo si no hay ninguna serie apuntada: con series ya hechas, cambiar el día
 * sería mover a otro sitio un trabajo que se hizo en este. Ahí toca cerrarla o
 * tirarla.
 */
gymModule.patch('/sesiones/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ dayId: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const [sesion] = await db
    .select()
    .from(gymSessions)
    .where(and(eq(gymSessions.id, id), eq(gymSessions.userId, req.userId!)));
  if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' });
  if (sesion.endedAt) return res.status(400).json({ error: 'La sesión ya está cerrada' });

  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(gymSets).where(eq(gymSets.sessionId, id));
  if (Number(n) > 0) {
    return res.status(400).json({ error: 'Ya hay series apuntadas: cierra la sesión o tírala antes de cambiar de día' });
  }

  const [dia] = await db
    .select({ id: gymDays.id })
    .from(gymDays)
    .where(and(eq(gymDays.id, parsed.data.dayId), eq(gymDays.userId, req.userId!)));
  if (!dia) return res.status(400).json({ error: 'Ese día no existe' });

  await db.update(gymSessions).set({ dayId: parsed.data.dayId }).where(eq(gymSessions.id, id));
  const [row] = await db.select().from(gymSessions).where(eq(gymSessions.id, id));
  res.json(row);
}));

gymModule.post('/sesiones/:id(\\d+)/cerrar', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z
    .object({
      notes: z.string().max(4000).nullish(),
      energy: z.number().int().min(1).max(5).nullish(),
      feeling: z.number().int().min(1).max(5).nullish(),
    })
    .safeParse(req.body ?? {});
  const encuesta: Record<string, unknown> = {};
  if (parsed.success) {
    if (parsed.data.notes !== undefined) encuesta.notes = parsed.data.notes;
    if (parsed.data.energy !== undefined) encuesta.energy = parsed.data.energy;
    if (parsed.data.feeling !== undefined) encuesta.feeling = parsed.data.feeling;
  }
  // El entrenamiento acabó en la ÚLTIMA SERIE, no cuando te acuerdas de cerrar.
  // Si cierras desde el coche dos horas después, esas dos horas no son
  // entrenamiento: la marca se queda donde dejaste de levantar.
  const [ultima] = await db
    .select({ cuando: sql<string | null>`max(${gymSets.createdAt})` })
    .from(gymSets)
    .where(eq(gymSets.sessionId, id));
  const fin = ultima?.cuando ? new Date(ultima.cuando) : new Date();

  const [r] = await db
    .update(gymSessions)
    .set({ endedAt: fin, ...encuesta })
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
  // Los ejercicios improvisados EN esta sesión se van con ella: descartar el
  // entrenamiento es decir «al final no lo hago», y dejar sus improvisaciones
  // proponiéndose en Rutina sería un fantasma de algo que no pasó.
  await db
    .update(gymExercises)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(gymExercises.userId, req.userId!),
        eq(gymExercises.proposedFrom, id),
        sql`${gymExercises.proposedAt} is not null`,
      ),
    );
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
      energy: gymSessions.energy,
      feeling: gymSessions.feeling,
      notes: gymSessions.notes,
      sets: sql<number>`(select count(*) from gym_sets gs where gs.session_id = gym_sessions.id)`,
      // La duración honesta va de la PRIMERA serie a la ÚLTIMA, no de abrir a
      // cerrar: irse del gimnasio sin cerrar la sesión no puede convertir hora
      // y media en tres horas.
      firstSet: sql<string | null>`(select min(gs.created_at) from gym_sets gs where gs.session_id = gym_sessions.id)`,
      lastSet: sql<string | null>`(select max(gs.created_at) from gym_sets gs where gs.session_id = gym_sessions.id)`,
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

// ---------- Condicionantes del cuerpo ----------

const condicionInput = z.object({
  title: z.string().trim().min(1).max(160),
  side: z.enum(['izquierdo', 'derecho', 'ambos', 'na']).default('na'),
  muscles: z.string().max(240).default(''),
  severity: z.enum(['cuidado', 'evitar']).default('cuidado'),
  advice: z.string().max(4000).nullish(),
  notes: z.string().max(4000).nullish(),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  status: z.enum(['activo', 'superado']).optional(),
});

const limpiarBloques = (v: string) =>
  [...new Set(v.split(',').map((m) => m.trim().toLowerCase()).filter((m) => (MUSCULOS as readonly string[]).includes(m)))].join(',');

/**
 * Lo que condiciona el entrenamiento: una lesión, una limitación, una zona
 * delicada. Va etiquetado por bloque para poder avisar en el propio ejercicio,
 * que es donde sirve de algo y no en una pantalla que no se abre nunca.
 */
gymModule.get('/condicionantes', ah(async (req: AuthedRequest, res) => {
  const filas = await db
    .select()
    .from(gymConditions)
    .where(eq(gymConditions.userId, req.userId!))
    .orderBy(asc(gymConditions.sortOrder), asc(gymConditions.id));
  res.json(filas);
}));

gymModule.post('/condicionantes', ah(async (req: AuthedRequest, res) => {
  const parsed = condicionInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(gymConditions)
    .where(eq(gymConditions.userId, req.userId!));
  const [r] = await db.insert(gymConditions).values({
    ...parsed.data,
    muscles: limpiarBloques(parsed.data.muscles),
    userId: req.userId!,
    sortOrder: Number(n),
  });
  const [row] = await db.select().from(gymConditions).where(eq(gymConditions.id, r.insertId));
  res.status(201).json(row);
}));

gymModule.patch('/condicionantes/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const parsed = condicionInput.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const datos: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.muscles !== undefined) datos.muscles = limpiarBloques(parsed.data.muscles);
  const [r] = await db
    .update(gymConditions)
    .set(datos)
    .where(and(eq(gymConditions.id, Number(req.params.id)), eq(gymConditions.userId, req.userId!)));
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Condicionante no encontrado' });
  const [row] = await db.select().from(gymConditions).where(eq(gymConditions.id, Number(req.params.id)));
  res.json(row);
}));

gymModule.delete('/condicionantes/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const [r] = await db
    .delete(gymConditions)
    .where(and(eq(gymConditions.id, Number(req.params.id)), eq(gymConditions.userId, req.userId!)));
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Condicionante no encontrado' });
  res.json({ deleted: true });
}));

// ---------- La sesión que se quedó abierta ----------

/** Minutos sin apuntar nada tras los que damos por hecho que ya no entrenas. */
export const MINUTOS_INACTIVO = 90;

/**
 * GET /sesion/olvidada — una sesión abierta, con series y sin actividad desde
 * hace rato. El cliente la usa para preguntar la encuesta al volver.
 *
 * No se cierra sola a propósito: cerrarla sería decidir por él cuándo acabó de
 * entrenar. Lo que sí es automático es la DURACIÓN, que va de la primera serie
 * a la última y por tanto no crece mientras el móvil está en el bolsillo.
 */
gymModule.get('/sesion/olvidada', ah(async (req: AuthedRequest, res) => {
  const [row] = await db
    .select({
      id: gymSessions.id,
      dayId: gymSessions.dayId,
      dayName: gymDays.name,
      sessionDate: gymSessions.sessionDate,
      startedAt: gymSessions.startedAt,
      sets: sql<number>`(select count(*) from gym_sets gs where gs.session_id = gym_sessions.id)`,
      lastSet: sql<string | null>`(select max(gs.created_at) from gym_sets gs where gs.session_id = gym_sessions.id)`,
    })
    .from(gymSessions)
    .innerJoin(gymDays, eq(gymSessions.dayId, gymDays.id))
    .where(and(eq(gymSessions.userId, req.userId!), isNull(gymSessions.endedAt)))
    .orderBy(desc(gymSessions.startedAt))
    .limit(1);

  if (!row || Number(row.sets) === 0 || !row.lastSet) return res.json(null);
  const minutos = (Date.now() - new Date(row.lastSet).getTime()) / 60000;
  res.json(minutos >= MINUTOS_INACTIVO ? { ...row, minutos: Math.round(minutos) } : null);
}));


// ---------- La semana ----------

/** Veces por semana a las que aspira. Si algún día cambia, se cambia aquí. */
export const OBJETIVO_SEMANAL = 3;

/** Lunes de la semana de `iso`, en formato ISO. La semana empieza en lunes. */
function lunesDe(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(d);
}

/**
 * GET /semana — cuántas veces has ido esta semana y con qué carga.
 *
 * Devuelve números, no frases: la recomendación se arma en el cliente para que
 * se vea de dónde sale. Un consejo cuyo motivo no se puede leer es un oráculo.
 */
gymModule.get('/semana', ah(async (req: AuthedRequest, res) => {
  const hoy = hoyMadrid();
  const lunes = lunesDe(hoy);

  const sesiones = await db
    .select({
      id: gymSessions.id,
      dayName: gymDays.name,
      sessionDate: gymSessions.sessionDate,
      energy: gymSessions.energy,
      sets: sql<number>`(select count(*) from gym_sets gs where gs.session_id = gym_sessions.id)`,
      volume: sql<string | null>`(
        select sum(gs.weight * gs.reps) from gym_sets gs
        where gs.session_id = gym_sessions.id and gs.weight is not null and gs.reps is not null
      )`,
    })
    .from(gymSessions)
    .innerJoin(gymDays, eq(gymSessions.dayId, gymDays.id))
    .where(and(eq(gymSessions.userId, req.userId!), sql`${gymSessions.endedAt} is not null`))
    .orderBy(desc(gymSessions.sessionDate))
    .limit(30);

  const semana = sesiones.filter((s) => s.sessionDate >= lunes && s.sessionDate <= hoy);
  const conVolumen = sesiones.filter((s) => s.volume != null).slice(0, 8);
  const media = conVolumen.length
    ? Math.round(conVolumen.reduce((n, s) => n + Number(s.volume), 0) / conVolumen.length)
    : null;

  res.json({
    today: hoy,
    weekStart: lunes,
    target: OBJETIVO_SEMANAL,
    week: semana.map((s) => ({ ...s, volume: s.volume == null ? null : Math.round(Number(s.volume)) })),
    last: sesiones[0]
      ? {
          ...sesiones[0],
          volume: sesiones[0].volume == null ? null : Math.round(Number(sesiones[0].volume)),
        }
      : null,
    avgVolume: media,
  });
}));

// ---------- Improvisar entrenando ----------
/**
 * Meter un ejercicio a mano en mitad del entrenamiento.
 *
 * Se escribe a mano a propósito (decisión suya): elegirlo de una lista sería
 * más «limpio» pero en el gimnasio, con el móvil en una mano, escribir cuatro
 * palabras es más rápido que navegar.
 *
 * NO entra en la rutina. Nace marcado como propuesto: sirve para apuntarle
 * series ahora y, al acabar, se ofrece en la pantalla Rutina. Que un
 * entrenamiento raro te reescriba el plan sin preguntar sería justo lo
 * contrario de tener un plan.
 */
gymModule.post('/sesiones/:id(\\d+)/improvisar', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z
    .object({
      catalogId: z.number().int().positive().nullish(),
      name: z.string().trim().min(1).max(160),
      parts: z.string().max(320).default(''),
      kind: z.enum(['repes', 'tiempo']).default('repes'),
      targetSets: z.number().int().min(1).max(20).default(3),
      targetReps: z.string().trim().max(20).default('10'),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const [sesion] = await db
    .select()
    .from(gymSessions)
    .where(and(eq(gymSessions.id, id), eq(gymSessions.userId, req.userId!)));
  if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' });
  if (sesion.endedAt) return res.status(400).json({ error: 'Esa sesión ya está cerrada' });

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(gymExercises)
    .where(and(eq(gymExercises.dayId, sesion.dayId), isNull(gymExercises.archivedAt)));

  const ident = await asegurarIdentidad(req.userId!, {
    catalogId: parsed.data.catalogId,
    name: parsed.data.name,
    parts: parsed.data.parts,
    kind: parsed.data.kind,
  });
  const partes = parsed.data.catalogId ? ident.parts : limpiarPartes(parsed.data.parts);
  const [r] = await db.insert(gymExercises).values({
    userId: req.userId!,
    dayId: sesion.dayId,
    name: ident.name,
    kind: parsed.data.catalogId ? ident.kind : parsed.data.kind,
    catalogId: ident.id,
    parts: partes,
    muscles: musculosDePartes(partes),
    targetSets: parsed.data.targetSets,
    targetReps: parsed.data.targetReps,
    sortOrder: Number(n),
    proposedAt: new Date(),
    proposedFrom: id,
  });
  const [row] = await db.select().from(gymExercises).where(eq(gymExercises.id, r.insertId));
  res.status(201).json(row);
}));

/** Aceptar un ejercicio improvisado: pasa a ser parte del plan y, si ese día
 *  está compartido, sale como sugerencia hacia el otro lado. */
gymModule.post('/propuestas/:id(\\d+)/aceptar', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [ej] = await db
    .select()
    .from(gymExercises)
    .where(and(eq(gymExercises.id, id), eq(gymExercises.userId, req.userId!), isNull(gymExercises.archivedAt)));
  if (!ej || !ej.proposedAt) return res.status(404).json({ error: 'Esa propuesta ya no está' });

  await db.update(gymExercises).set({ proposedAt: null, proposedFrom: null }).where(eq(gymExercises.id, id));
  await emitirCambio({
    userId: req.userId!,
    dayId: ej.dayId,
    kind: 'alta',
    name: ej.name,
    exerciseKind: ej.kind,
    parts: ej.parts,
  });
  res.json({ ok: true });
}));

/** Descartarla: el ejercicio se archiva, pero las series que hiciste con él
 *  siguen en el histórico (gym_sets guarda también el nombre). */
gymModule.post('/propuestas/:id(\\d+)/descartar', ah(async (req: AuthedRequest, res) => {
  const [r] = await db
    .update(gymExercises)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(gymExercises.id, Number(req.params.id)),
        eq(gymExercises.userId, req.userId!),
        sql`${gymExercises.proposedAt} is not null`,
      ),
    );
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Esa propuesta ya no está' });
  res.json({ ok: true });
}));

// ---------- Superseries ----------
/**
 * Vincular (o soltar) un ejercicio en superserie con otro del mismo día.
 *
 * La superserie es cómo se EJECUTAN (alternados, X1 Y1 X2 Y2…), no qué son:
 * cada ejercicio conserva su identidad, sus pesos y sus series. Por eso es un
 * id de grupo compartido y no una fusión. Al vincular, los miembros se
 * recolocan adyacentes: una superserie partida por en medio de la lista no
 * hay quien la lea.
 */
gymModule.patch('/ejercicios/:id(\\d+)/superserie', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ withId: z.number().int().positive().nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos incorrectos' });

  const id = Number(req.params.id);
  const [ej] = await db
    .select()
    .from(gymExercises)
    .where(and(eq(gymExercises.id, id), eq(gymExercises.userId, req.userId!), isNull(gymExercises.archivedAt)));
  if (!ej) return res.status(404).json({ error: 'Ejercicio no encontrado' });

  if (parsed.data.withId === null) {
    const grupo = await soltarSuperserie(req.userId!, id);
    if (grupo) {
      // «ha quitado la superserie X + Y»: al otro lado le llega como sugerencia
      await emitirCambio({
        userId: req.userId!,
        dayId: ej.dayId,
        kind: 'ss_baja',
        name: grupo.map((g) => g.name).join(' + '),
        extra: { names: grupo.map((g) => g.name), catalogIds: grupo.map((g) => g.catalogId) },
      });
    }
    return res.json({ ok: true });
  }

  const grupo = await vincularSuperserie(req.userId!, id, parsed.data.withId);
  if (grupo == null) return res.status(400).json({ error: 'Ese ejercicio no está en la misma sesión' });

  const miembros = await db
    .select({ name: gymExercises.name, catalogId: gymExercises.catalogId })
    .from(gymExercises)
    .where(and(eq(gymExercises.supersetId, grupo), isNull(gymExercises.archivedAt)));
  await emitirCambio({
    userId: req.userId!,
    dayId: ej.dayId,
    kind: 'ss_alta',
    name: miembros.map((m) => m.name).join(' + '),
    extra: { names: miembros.map((m) => m.name), catalogIds: miembros.map((m) => m.catalogId) },
  });

  res.json({ ok: true, supersetId: grupo });
}));

/**
 * Sustituir un ejercicio por otro, en su mismo sitio.
 *
 * No es un atajo cosmético: el nuevo hereda la posición y la superserie del
 * viejo, y al otro lado viaja como lo que es (un quitado más un añadido).
 * El historial del viejo no se toca: las series ya hechas son suyas.
 */
gymModule.post('/ejercicios/:id(\\d+)/sustituir', ah(async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ catalogId: z.number().int().positive().nullish(), name: z.string().trim().min(1).max(160) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos incorrectos' });

  const id = Number(req.params.id);
  const [viejo] = await db
    .select()
    .from(gymExercises)
    .where(and(eq(gymExercises.id, id), eq(gymExercises.userId, req.userId!), isNull(gymExercises.archivedAt)));
  if (!viejo) return res.status(404).json({ error: 'Ejercicio no encontrado' });

  const ident = await asegurarIdentidad(req.userId!, { catalogId: parsed.data.catalogId, name: parsed.data.name });
  if (ident.id === viejo.catalogId) return res.status(400).json({ error: 'Es el mismo ejercicio' });

  await db.update(gymExercises).set({ archivedAt: new Date() }).where(eq(gymExercises.id, id));
  const [r] = await db.insert(gymExercises).values({
    userId: req.userId!,
    dayId: viejo.dayId,
    name: ident.name,
    kind: ident.kind,
    catalogId: ident.id,
    parts: ident.parts,
    muscles: musculosDePartes(ident.parts),
    targetSets: viejo.targetSets, // el hueco en la sesión es el mismo
    targetReps: viejo.targetReps,
    sortOrder: viejo.sortOrder,
    supersetId: viejo.supersetId,
  });

  if (!viejo.proposedAt) {
    await emitirCambio({
      userId: req.userId!,
      dayId: viejo.dayId,
      kind: 'baja',
      name: viejo.name,
      exerciseKind: viejo.kind,
      parts: viejo.parts,
      catalogId: viejo.catalogId,
    });
    await emitirCambio({
      userId: req.userId!,
      dayId: viejo.dayId,
      kind: 'alta',
      name: ident.name,
      parts: ident.parts,
      catalogId: ident.id,
    });
  }

  const [row] = await db.select().from(gymExercises).where(eq(gymExercises.id, r.insertId));
  res.status(201).json(row);
}));
