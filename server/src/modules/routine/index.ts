import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { routineChecks, routineItems, routineSlots } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';

// Rutinas: catálogo + plantilla semanal + checks diarios + estadísticas.
// Regla clave: los checks SOLO se marcan/desmarcan para el día en curso
// (no se puede completar hacia atrás). El borrado siempre es archivado,
// así el historial de la cuadrícula queda intacto.
export const routineModule = Router();

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// lunes = 0 ... domingo = 6
function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

// ---------- Catálogo ----------
const itemInput = z.object({
  title: z.string().trim().min(1).max(120),
  emoji: z.string().trim().min(1).max(16).default('🔁'),
});

routineModule.get('/items', ah(async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(routineItems)
    .where(and(eq(routineItems.userId, req.userId!), isNull(routineItems.archivedAt)))
    .orderBy(asc(routineItems.title));
  res.json(rows);
}));

routineModule.post('/items', ah(async (req: AuthedRequest, res) => {
  const parsed = itemInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [result] = await db.insert(routineItems).values({ ...parsed.data, userId: req.userId! });
  const [row] = await db.select().from(routineItems).where(eq(routineItems.id, result.insertId));
  res.status(201).json(row);
}));

routineModule.patch('/items/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = itemInput.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [result] = await db
    .update(routineItems)
    .set(parsed.data)
    .where(and(eq(routineItems.id, id), eq(routineItems.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Evento no encontrado' });
  const [row] = await db.select().from(routineItems).where(eq(routineItems.id, id));
  res.json(row);
}));

// Archiva el evento Y sus slots (el historial pasado no se toca)
routineModule.delete('/items/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const now = new Date();
  const [result] = await db
    .update(routineItems)
    .set({ archivedAt: now })
    .where(and(eq(routineItems.id, id), eq(routineItems.userId, req.userId!), isNull(routineItems.archivedAt)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Evento no encontrado' });
  await db
    .update(routineSlots)
    .set({ archivedAt: now })
    .where(and(eq(routineSlots.itemId, id), eq(routineSlots.userId, req.userId!), isNull(routineSlots.archivedAt)));
  res.json({ archived: true });
}));

// ---------- Plantilla semanal (slots) ----------
const slotInput = z.object({
  itemId: z.number().int().positive(),
  weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida (HH:MM)'),
});

routineModule.get('/slots', ah(async (req: AuthedRequest, res) => {
  const rows = await db
    .select({
      id: routineSlots.id,
      itemId: routineSlots.itemId,
      weekday: routineSlots.weekday,
      time: routineSlots.time,
      title: routineItems.title,
      emoji: routineItems.emoji,
    })
    .from(routineSlots)
    .innerJoin(routineItems, eq(routineSlots.itemId, routineItems.id))
    .where(and(eq(routineSlots.userId, req.userId!), isNull(routineSlots.archivedAt)))
    .orderBy(asc(routineSlots.weekday), asc(routineSlots.time));
  res.json(rows);
}));

routineModule.post('/slots', ah(async (req: AuthedRequest, res) => {
  const parsed = slotInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [item] = await db
    .select({ id: routineItems.id })
    .from(routineItems)
    .where(and(eq(routineItems.id, parsed.data.itemId), eq(routineItems.userId, req.userId!)));
  if (!item) return res.status(400).json({ error: 'El evento indicado no existe' });
  const [result] = await db.insert(routineSlots).values({ ...parsed.data, userId: req.userId! });
  const [row] = await db.select().from(routineSlots).where(eq(routineSlots.id, result.insertId));
  res.status(201).json(row);
}));

routineModule.patch('/slots/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = slotInput.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [result] = await db
    .update(routineSlots)
    .set(parsed.data)
    .where(and(eq(routineSlots.id, id), eq(routineSlots.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Slot no encontrado' });
  const [row] = await db.select().from(routineSlots).where(eq(routineSlots.id, id));
  res.json(row);
}));

routineModule.delete('/slots/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .update(routineSlots)
    .set({ archivedAt: new Date() })
    .where(and(eq(routineSlots.id, id), eq(routineSlots.userId, req.userId!), isNull(routineSlots.archivedAt)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Slot no encontrado' });
  res.json({ archived: true });
}));

// ---------- Hoy: checklist del día en curso ----------
routineModule.get('/today', ah(async (req: AuthedRequest, res) => {
  const today = todayIso();
  const wd = weekdayOf(today);
  const slots = await db
    .select({
      slotId: routineSlots.id,
      time: routineSlots.time,
      title: routineItems.title,
      emoji: routineItems.emoji,
    })
    .from(routineSlots)
    .innerJoin(routineItems, eq(routineSlots.itemId, routineItems.id))
    .where(and(eq(routineSlots.userId, req.userId!), eq(routineSlots.weekday, wd), isNull(routineSlots.archivedAt)))
    .orderBy(asc(routineSlots.time));
  const checks = await db
    .select({ slotId: routineChecks.slotId })
    .from(routineChecks)
    .where(and(eq(routineChecks.userId, req.userId!), eq(routineChecks.checkDate, today)));
  const checked = new Set(checks.map((c) => c.slotId));
  res.json({ date: today, items: slots.map((s) => ({ ...s, checked: checked.has(s.slotId) })) });
}));

// Marcar/desmarcar: SIEMPRE sobre hoy — el servidor ignora cualquier fecha.
routineModule.post('/check', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ slotId: z.number().int().positive(), checked: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const today = todayIso();
  const { slotId, checked } = parsed.data;

  const [slot] = await db
    .select()
    .from(routineSlots)
    .where(and(eq(routineSlots.id, slotId), eq(routineSlots.userId, req.userId!)));
  if (!slot) return res.status(404).json({ error: 'Slot no encontrado' });
  if (slot.weekday !== weekdayOf(today)) {
    return res.status(400).json({ error: 'Ese evento no está en la rutina de hoy' });
  }

  if (checked) {
    const [existing] = await db
      .select()
      .from(routineChecks)
      .where(and(eq(routineChecks.slotId, slotId), eq(routineChecks.checkDate, today)));
    if (!existing) {
      await db.insert(routineChecks).values({ userId: req.userId!, slotId, checkDate: today });
    }
  } else {
    await db
      .delete(routineChecks)
      .where(and(eq(routineChecks.slotId, slotId), eq(routineChecks.checkDate, today), eq(routineChecks.userId, req.userId!)));
  }
  res.json({ date: today, slotId, checked });
}));

// ---------- Estadísticas para la cuadrícula ----------
// GET /stats?from=YYYY-MM-DD&to=YYYY-MM-DD -> [{date, scheduled, checked}]
// Un slot cuenta para un día si ya existía entonces y aún no estaba archivado.
routineModule.get('/stats', ah(async (req: AuthedRequest, res) => {
  const from = String(req.query.from ?? '');
  const to = String(req.query.to ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'Rango inválido' });
  }

  const slots = await db
    .select({
      id: routineSlots.id,
      weekday: routineSlots.weekday,
      createdAt: routineSlots.createdAt,
      archivedAt: routineSlots.archivedAt,
    })
    .from(routineSlots)
    .where(eq(routineSlots.userId, req.userId!));

  const checks = await db
    .select({ slotId: routineChecks.slotId, checkDate: routineChecks.checkDate })
    .from(routineChecks)
    .where(and(eq(routineChecks.userId, req.userId!), gte(routineChecks.checkDate, from), lte(routineChecks.checkDate, to)));
  const checksByDate = new Map<string, number>();
  for (const c of checks) {
    checksByDate.set(c.checkDate, (checksByDate.get(c.checkDate) ?? 0) + 1);
  }

  const out: Array<{ date: string; scheduled: number; checked: number }> = [];
  const cursor = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cursor <= end) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    const wd = (cursor.getDay() + 6) % 7;
    const dayEnd = new Date(`${iso}T23:59:59`);
    const scheduled = slots.filter(
      (s) => s.weekday === wd && s.createdAt <= dayEnd && (!s.archivedAt || s.archivedAt > dayEnd),
    ).length;
    out.push({ date: iso, scheduled, checked: checksByDate.get(iso) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  res.json(out);
}));
