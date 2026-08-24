/**
 * El catálogo de ejercicios: el vocabulario del gimnasio.
 *
 * Dos capas: los POR DEFECTO (createdBy NULL) los ve todo el mundo y son la
 * forma de que dos cuentas hablen del mismo ejercicio; los PRIVADOS solo los ve
 * su dueño. La estandarización viene de que la lista común sea grande, no de
 * obligar a compartir lo propio.
 *
 * Lo que devuelve de «uso» (PR, última vez, historial) es SIEMPRE del que
 * pregunta: el catálogo es común, los números no.
 */
import { Router } from 'express';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { gymCatalog, gymCatalogNotes, gymExercises, gymSessions, gymSets } from '../../db/schema';
import { type AuthedRequest } from '../../core/auth/middleware';
import { limpiarPartes, musculosDePartes } from './partes';

export const catalogoRouter = Router();

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Lo que esta cuenta puede ver: lo común más lo suyo. */
function visiblePara(userId: number) {
  return and(isNull(gymCatalog.archivedAt), or(isNull(gymCatalog.createdBy), eq(gymCatalog.createdBy, userId)));
}

/**
 * Garantiza que un ejercicio tiene identidad en el catálogo para ESTA cuenta.
 *
 * Es el único camino de entrada: venga de la lista (catalogId), escrito a mano
 * (name) o de una sugerencia de otra cuenta. Si el nombre ya existe en lo que
 * esta cuenta ve, se reutiliza — así los duplicados no pueden nacer. Si no,
 * nace como PRIVADO de esta cuenta: lo manual no ensucia la lista común.
 */
export async function asegurarIdentidad(
  userId: number,
  pedido: { catalogId?: number | null; name: string; parts?: string; kind?: 'repes' | 'tiempo' },
): Promise<{ id: number; name: string; parts: string; partsSecondary: string; kind: 'repes' | 'tiempo'; barKg: string | null }> {
  if (pedido.catalogId) {
    const [c] = await db
      .select()
      .from(gymCatalog)
      .where(and(eq(gymCatalog.id, pedido.catalogId), visiblePara(userId)));
    if (c) return { id: c.id, name: c.name, parts: c.parts, partsSecondary: c.partsSecondary, kind: c.kind, barKg: c.barKg };
  }

  const visibles = await db
    .select({
      id: gymCatalog.id,
      name: gymCatalog.name,
      parts: gymCatalog.parts,
      partsSecondary: gymCatalog.partsSecondary,
      kind: gymCatalog.kind,
      barKg: gymCatalog.barKg,
    })
    .from(gymCatalog)
    .where(visiblePara(userId));
  const igual = visibles.find((c) => norm(c.name) === norm(pedido.name));
  if (igual) return igual;

  // Lo creado a mano nace con todo como principal: no hay forma honesta de
  // adivinar qué es colateral, y exigir de más se corrige mejor que mentir.
  const partes = limpiarPartes(pedido.parts ?? '');
  const [r] = await db.insert(gymCatalog).values({
    name: pedido.name.trim(),
    parts: partes,
    kind: pedido.kind ?? 'repes',
    createdBy: userId,
  });
  // Sin barra: del nombre no se puede deducir, y suponerla falsearía el peso.
  // Se marca a mano desde la ficha del ejercicio.
  return { id: r.insertId, name: pedido.name.trim(), parts: partes, partsSecondary: '', kind: pedido.kind ?? 'repes', barKg: null };
}

// GET /gym/catalogo — la lista, con TUS números al lado de cada uno
catalogoRouter.get('/catalogo', ah(async (req: AuthedRequest, res) => {
  const lista = await db
    .select()
    .from(gymCatalog)
    .where(visiblePara(req.userId!))
    .orderBy(gymCatalog.name);

  // El chivato del listado: tu PR y tu última vez, por identidad de catálogo.
  // Una sola consulta agregada: con la base en Oregón, una por ejercicio sería
  // eterno.
  const uso = await db
    .select({
      catalogId: gymExercises.catalogId,
      // nullif: una serie a peso corporal (0 kg) no es un PR de 0
      pr: sql<string | null>`max(nullif(${gymSets.weight}, 0))`,
      ultima: sql<string | null>`max(${gymSets.createdAt})`,
      series: sql<number>`count(*)`,
    })
    .from(gymSets)
    .innerJoin(gymExercises, eq(gymSets.exerciseId, gymExercises.id))
    .where(and(eq(gymSets.userId, req.userId!), sql`${gymExercises.catalogId} is not null`))
    .groupBy(gymExercises.catalogId);
  const usoPor = new Map(uso.map((u) => [u.catalogId, u]));

  const notas = await db
    .select({ catalogId: gymCatalogNotes.catalogId })
    .from(gymCatalogNotes)
    .where(eq(gymCatalogNotes.userId, req.userId!));
  const conNota = new Set(notas.map((n) => n.catalogId));

  // En qué días de tu rutina está ahora mismo (para marcarlo «en rutina»)
  const enRutina = await db
    .select({ catalogId: gymExercises.catalogId })
    .from(gymExercises)
    .where(and(eq(gymExercises.userId, req.userId!), isNull(gymExercises.archivedAt), isNull(gymExercises.proposedAt)));
  const activos = new Set(enRutina.map((e) => e.catalogId));

  res.json(
    lista.map((c) => ({
      id: c.id,
      name: c.name,
      parts: c.parts,
      partsSecondary: c.partsSecondary,
      kind: c.kind,
      // con valor, el peso de ese ejercicio se apunta por un lado
      barKg: c.barKg,
      explain: c.explainText,
      mine: c.createdBy != null,
      pr: usoPor.get(c.id)?.pr ?? null,
      lastDone: usoPor.get(c.id)?.ultima ?? null,
      sets: Number(usoPor.get(c.id)?.series ?? 0),
      hasNote: conNota.has(c.id),
      inRoutine: activos.has(c.id),
    })),
  );
}));

// GET /gym/catalogo/:id — la ficha: tu nota y tu historial con él
catalogoRouter.get('/catalogo/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [c] = await db.select().from(gymCatalog).where(and(eq(gymCatalog.id, id), visiblePara(req.userId!)));
  if (!c) return res.status(404).json({ error: 'Ese ejercicio no está en tu lista' });

  const [nota] = await db
    .select({ note: gymCatalogNotes.note, updatedAt: gymCatalogNotes.updatedAt })
    .from(gymCatalogNotes)
    .where(and(eq(gymCatalogNotes.userId, req.userId!), eq(gymCatalogNotes.catalogId, id)));

  // Tu historial: las series tuyas de cualquier copia de rutina que apunte a
  // esta identidad, agrupadas por día de gimnasio.
  const filas = await db
    .select({
      fecha: gymSessions.sessionDate,
      weight: gymSets.weight,
      reps: gymSets.reps,
      seconds: gymSets.seconds,
    })
    .from(gymSets)
    .innerJoin(gymExercises, eq(gymSets.exerciseId, gymExercises.id))
    .innerJoin(gymSessions, eq(gymSets.sessionId, gymSessions.id))
    .where(and(eq(gymSets.userId, req.userId!), eq(gymExercises.catalogId, id)))
    .orderBy(desc(gymSessions.sessionDate))
    .limit(240);

  const porDia = new Map<string, { sets: number; mejorPeso: number | null; mejorReps: number | null; mejorSegs: number | null }>();
  for (const f of filas) {
    const d = porDia.get(f.fecha) ?? { sets: 0, mejorPeso: null, mejorReps: null, mejorSegs: null };
    d.sets += 1;
    const w = f.weight == null ? null : Number(f.weight);
    if (w != null && (d.mejorPeso == null || w > d.mejorPeso)) {
      d.mejorPeso = w;
      d.mejorReps = f.reps;
    }
    if (f.seconds != null && (d.mejorSegs == null || f.seconds > d.mejorSegs)) d.mejorSegs = f.seconds;
    porDia.set(f.fecha, d);
  }

  res.json({
    id: c.id,
    name: c.name,
    parts: c.parts,
    partsSecondary: c.partsSecondary,
    kind: c.kind,
    barKg: c.barKg,
    explain: c.explainText,
    mine: c.createdBy != null,
    note: nota?.note ?? null,
    history: [...porDia.entries()].map(([fecha, d]) => ({ fecha, ...d })),
  });
}));

// POST /gym/catalogo — crear uno PRIVADO (el caso raro, pero existe)
catalogoRouter.post('/catalogo', ah(async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(160),
      parts: z.string().max(320).default(''),
      kind: z.enum(['repes', 'tiempo']).default('repes'),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const visibles = await db
    .select({ id: gymCatalog.id, name: gymCatalog.name })
    .from(gymCatalog)
    .where(visiblePara(req.userId!));
  const igual = visibles.find((c) => norm(c.name) === norm(parsed.data.name));
  if (igual) return res.status(409).json({ error: `Ya existe «${igual.name}» en tu lista`, id: igual.id });

  const creado = await asegurarIdentidad(req.userId!, parsed.data);
  res.status(201).json(creado);
}));

// PATCH /gym/catalogo/:id — la explicación genérica del ejercicio.
// En los comunes solo la toca el administrador: lo que escribas ahí lo lee todo
// el mundo, y lo personal tiene su sitio en la nota. En los tuyos, tú.
catalogoRouter.patch('/catalogo/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ explain: z.string().max(4000).nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos incorrectos' });

  const id = Number(req.params.id);
  const [c] = await db.select().from(gymCatalog).where(and(eq(gymCatalog.id, id), visiblePara(req.userId!)));
  if (!c) return res.status(404).json({ error: 'Ese ejercicio no está en tu lista' });

  const esComun = c.createdBy == null;
  if (esComun && req.userRole !== 'admin') {
    return res.status(403).json({ error: 'La explicación de los ejercicios comunes la mantiene el administrador. Tu nota personal es tuya: úsala.' });
  }
  if (!esComun && c.createdBy !== req.userId!) return res.status(404).json({ error: 'Ese ejercicio no está en tu lista' });

  await db.update(gymCatalog).set({ explainText: parsed.data.explain || null }).where(eq(gymCatalog.id, id));
  res.json({ ok: true });
}));

// PUT /gym/catalogo/:id/nota — tu relación con el ejercicio. Vacía = se borra.
catalogoRouter.put('/catalogo/:id(\\d+)/nota', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ note: z.string().max(4000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos incorrectos' });

  const id = Number(req.params.id);
  const [c] = await db.select({ id: gymCatalog.id }).from(gymCatalog).where(and(eq(gymCatalog.id, id), visiblePara(req.userId!)));
  if (!c) return res.status(404).json({ error: 'Ese ejercicio no está en tu lista' });

  const texto = parsed.data.note.trim();
  const [ya] = await db
    .select({ id: gymCatalogNotes.id })
    .from(gymCatalogNotes)
    .where(and(eq(gymCatalogNotes.userId, req.userId!), eq(gymCatalogNotes.catalogId, id)));

  if (!texto) {
    if (ya) await db.delete(gymCatalogNotes).where(eq(gymCatalogNotes.id, ya.id));
  } else if (ya) {
    await db.update(gymCatalogNotes).set({ note: texto }).where(eq(gymCatalogNotes.id, ya.id));
  } else {
    await db.insert(gymCatalogNotes).values({ userId: req.userId!, catalogId: id, note: texto });
  }
  res.json({ ok: true });
}));
