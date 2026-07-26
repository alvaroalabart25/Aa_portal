import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { diarySessions, routineItems } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';

// Salud · Diario: sesiones de actividad (la radiografía del día).
// Regla central: las actividades son exclusivas — empezar una nueva cierra
// la que estuviera en curso. Solo fumar (marca puntual, en health-log) se
// superpone. El catálogo es el mismo que el de Rutina.
export const diaryModule = Router();

const SELECT_SESSION = {
  id: diarySessions.id,
  itemId: diarySessions.itemId,
  startAt: diarySessions.startAt,
  endAt: diarySessions.endAt,
  title: routineItems.title,
  emoji: routineItems.emoji,
};

async function ownItem(userId: number, itemId: number) {
  const [item] = await db
    .select({ id: routineItems.id })
    .from(routineItems)
    .where(and(eq(routineItems.id, itemId), eq(routineItems.userId, userId)));
  return Boolean(item);
}

// GET /sessions?from&to (datetimes ISO) -> sesiones que tocan el rango
diaryModule.get('/sessions', ah(async (req: AuthedRequest, res) => {
  const from = new Date(String(req.query.from ?? ''));
  const to = new Date(String(req.query.to ?? ''));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return res.status(400).json({ error: 'Rango inválido' });
  }
  const rows = await db
    .select(SELECT_SESSION)
    .from(diarySessions)
    .innerJoin(routineItems, eq(diarySessions.itemId, routineItems.id))
    .where(
      and(
        eq(diarySessions.userId, req.userId!),
        lte(diarySessions.startAt, to),
        or(isNull(diarySessions.endAt), gte(diarySessions.endAt, from)),
      ),
    )
    .orderBy(asc(diarySessions.startAt));
  res.json(rows);
}));

// GET /current -> la sesión abierta (o null)
diaryModule.get('/current', ah(async (req: AuthedRequest, res) => {
  const [row] = await db
    .select(SELECT_SESSION)
    .from(diarySessions)
    .innerJoin(routineItems, eq(diarySessions.itemId, routineItems.id))
    .where(and(eq(diarySessions.userId, req.userId!), isNull(diarySessions.endAt)))
    .orderBy(desc(diarySessions.startAt))
    .limit(1);
  res.json(row ?? null);
}));

// POST /start { itemId } -> cierra la sesión en curso y abre una nueva AHORA
diaryModule.post('/start', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ itemId: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (!(await ownItem(req.userId!, parsed.data.itemId))) {
    return res.status(400).json({ error: 'La actividad indicada no existe' });
  }
  const now = new Date();
  await db
    .update(diarySessions)
    .set({ endAt: now })
    .where(and(eq(diarySessions.userId, req.userId!), isNull(diarySessions.endAt)));
  const [result] = await db.insert(diarySessions).values({ userId: req.userId!, itemId: parsed.data.itemId, startAt: now });
  const [row] = await db.select().from(diarySessions).where(eq(diarySessions.id, result.insertId));
  res.status(201).json(row);
}));

// POST /moment { itemId } -> marca puntual: se registra el instante (inicio =
// fin) y NO toca la actividad en curso. Levantarme no interrumpe nada.
diaryModule.post('/moment', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ itemId: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (!(await ownItem(req.userId!, parsed.data.itemId))) {
    return res.status(400).json({ error: 'La actividad indicada no existe' });
  }
  const now = new Date();
  const [result] = await db.insert(diarySessions).values({ userId: req.userId!, itemId: parsed.data.itemId, startAt: now, endAt: now });
  const [row] = await db.select().from(diarySessions).where(eq(diarySessions.id, result.insertId));
  res.status(201).json(row);
}));

// POST /stop -> cierra la sesión en curso (quedarse "sin actividad" es válido)
diaryModule.post('/stop', ah(async (req: AuthedRequest, res) => {
  const [result] = await db
    .update(diarySessions)
    .set({ endAt: new Date() })
    .where(and(eq(diarySessions.userId, req.userId!), isNull(diarySessions.endAt)));
  res.json({ stopped: result.affectedRows > 0 });
}));

const sessionEdit = z.object({
  itemId: z.number().int().positive().optional(),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).nullable().optional(),
});

// POST /sessions -> añadir un bloque a posteriori (con inicio y fin)
diaryModule.post('/sessions', ah(async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      itemId: z.number().int().positive(),
      startAt: z.string().datetime({ offset: true }),
      endAt: z.string().datetime({ offset: true }),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const start = new Date(parsed.data.startAt);
  const end = new Date(parsed.data.endAt);
  if (end <= start) return res.status(400).json({ error: 'El fin debe ser posterior al inicio' });
  if (!(await ownItem(req.userId!, parsed.data.itemId))) {
    return res.status(400).json({ error: 'La actividad indicada no existe' });
  }
  const [result] = await db.insert(diarySessions).values({ userId: req.userId!, itemId: parsed.data.itemId, startAt: start, endAt: end });
  const [row] = await db.select().from(diarySessions).where(eq(diarySessions.id, result.insertId));
  res.status(201).json(row);
}));

// PATCH /sessions/:id -> corregir horas o actividad
diaryModule.patch('/sessions/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = sessionEdit.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [existing] = await db
    .select()
    .from(diarySessions)
    .where(and(eq(diarySessions.id, id), eq(diarySessions.userId, req.userId!)));
  if (!existing) return res.status(404).json({ error: 'Sesión no encontrada' });
  if (parsed.data.itemId && !(await ownItem(req.userId!, parsed.data.itemId))) {
    return res.status(400).json({ error: 'La actividad indicada no existe' });
  }
  const start = parsed.data.startAt ? new Date(parsed.data.startAt) : existing.startAt;
  const end = parsed.data.endAt === undefined ? existing.endAt : parsed.data.endAt === null ? null : new Date(parsed.data.endAt);
  if (end && end <= start) return res.status(400).json({ error: 'El fin debe ser posterior al inicio' });
  await db
    .update(diarySessions)
    .set({ itemId: parsed.data.itemId ?? existing.itemId, startAt: start, endAt: end })
    .where(eq(diarySessions.id, id));
  const [row] = await db.select().from(diarySessions).where(eq(diarySessions.id, id));
  res.json(row);
}));

// DELETE /sessions/:id -> borrar un bloque (corrección del registro)
diaryModule.delete('/sessions/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .delete(diarySessions)
    .where(and(eq(diarySessions.id, id), eq(diarySessions.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json({ deleted: true });
}));
