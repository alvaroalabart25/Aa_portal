import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gte, isNull, lte, max } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { dailyCheckDone, dailyChecks, healthEntries } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';

// Salud · Diario: marcas puntuales del día. El cigarro lleva su hora (la
// radiografía lo pinta sobre la actividad en curso); el peso lleva valor y
// hora (no es lo mismo pesarse a las 8:00 que a las 10:00).
export const healthModule = Router();

export const HEALTH_KINDS = ['cigarro', 'peso'] as const;

// Fecha de hoy en Europa/Madrid (el server corre en UTC en Render)
function madridNow(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

const entryInput = z.object({
  kind: z.enum(HEALTH_KINDS),
  value: z.number().positive().max(500).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(), // por defecto, ahora (Madrid)
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // por defecto, hoy
});

// GET /day?date=YYYY-MM-DD (por defecto hoy) -> entradas del día
healthModule.get('/day', ah(async (req: AuthedRequest, res) => {
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : madridNow().date;
  const rows = await db
    .select()
    .from(healthEntries)
    .where(and(eq(healthEntries.userId, req.userId!), eq(healthEntries.entryDate, date)))
    .orderBy(asc(healthEntries.createdAt));
  res.json({ date, entries: rows });
}));

// POST /entries { kind, value? } -> registra en el día de hoy (Madrid)
healthModule.post('/entries', ah(async (req: AuthedRequest, res) => {
  const parsed = entryInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (parsed.data.kind === 'peso' && parsed.data.value == null) {
    return res.status(400).json({ error: 'El peso necesita un valor en kg' });
  }
  const now = madridNow();
  const [result] = await db.insert(healthEntries).values({
    userId: req.userId!,
    kind: parsed.data.kind,
    value: parsed.data.value ?? null,
    entryDate: parsed.data.date ?? now.date,
    entryTime: parsed.data.time ?? now.time,
  });
  const [row] = await db.select().from(healthEntries).where(eq(healthEntries.id, result.insertId));
  res.status(201).json(row);
}));

// PATCH /entries/:id { time?, value? } -> corregir la hora (arrastrando la
// marca en la radiografía) o el valor del peso
healthModule.patch('/entries/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z
    .object({
      time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      value: z.number().positive().max(500).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [result] = await db
    .update(healthEntries)
    .set({ ...(parsed.data.time ? { entryTime: parsed.data.time } : {}), ...(parsed.data.value ? { value: parsed.data.value } : {}) })
    .where(and(eq(healthEntries.id, id), eq(healthEntries.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Registro no encontrado' });
  const [row] = await db.select().from(healthEntries).where(eq(healthEntries.id, id));
  res.json(row);
}));

// DELETE /entries/:id -> corrige un registro erróneo (borrado real: es un tally)
healthModule.delete('/entries/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .delete(healthEntries)
    .where(and(eq(healthEntries.id, id), eq(healthEntries.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Registro no encontrado' });
  res.json({ deleted: true });
}));

// ---------- Checks del día ----------
// Cosas que se repiten a diario. Lo hecho vive por (check, fecha), así que se
// reinicia solo cada día. El check de tipo 'peso' no se marca a mano: se
// cumple cuando hay un peso registrado ese día.
healthModule.get('/checks', ah(async (req: AuthedRequest, res) => {
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : madridNow().date;

  const checks = await db
    .select()
    .from(dailyChecks)
    .where(and(eq(dailyChecks.userId, req.userId!), isNull(dailyChecks.archivedAt)))
    .orderBy(asc(dailyChecks.sortOrder), asc(dailyChecks.id));

  const done = await db
    .select({ checkId: dailyCheckDone.checkId })
    .from(dailyCheckDone)
    .where(and(eq(dailyCheckDone.userId, req.userId!), eq(dailyCheckDone.checkDate, date)));
  const doneIds = new Set(done.map((d) => d.checkId));

  const [pesoRow] = await db
    .select()
    .from(healthEntries)
    .where(and(eq(healthEntries.userId, req.userId!), eq(healthEntries.entryDate, date), eq(healthEntries.kind, 'peso')))
    .orderBy(desc(healthEntries.id))
    .limit(1);

  res.json({
    date,
    checks: checks.map((c) => ({
      id: c.id,
      title: c.title,
      emoji: c.emoji,
      kind: c.kind,
      done: c.kind === 'peso' ? Boolean(pesoRow) : doneIds.has(c.id),
      peso: c.kind === 'peso' && pesoRow ? { id: pesoRow.id, value: pesoRow.value, time: pesoRow.entryTime } : null,
    })),
  });
}));

// POST /checks { title, emoji } -> nuevo check al final de la lista
healthModule.post('/checks', ah(async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ title: z.string().trim().min(1).max(120), emoji: z.string().trim().min(1).max(16).default('✅') })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [{ n }] = await db
    .select({ n: max(dailyChecks.sortOrder) })
    .from(dailyChecks)
    .where(eq(dailyChecks.userId, req.userId!));
  const [result] = await db.insert(dailyChecks).values({
    userId: req.userId!,
    title: parsed.data.title,
    emoji: parsed.data.emoji,
    sortOrder: (n ?? 0) + 1,
  });
  const [row] = await db.select().from(dailyChecks).where(eq(dailyChecks.id, result.insertId));
  res.status(201).json(row);
}));

// DELETE /checks/:id -> lo saca de la lista (el historial de días queda)
healthModule.delete('/checks/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .update(dailyChecks)
    .set({ archivedAt: new Date() })
    .where(and(eq(dailyChecks.id, id), eq(dailyChecks.userId, req.userId!), isNull(dailyChecks.archivedAt)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Check no encontrado' });
  res.json({ archived: true });
}));

// POST /checks/:id/toggle { done, date? } -> marcar o desmarcar
healthModule.post('/checks/:id/toggle', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z
    .object({ done: z.boolean(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const date = parsed.data.date ?? madridNow().date;

  const [check] = await db
    .select()
    .from(dailyChecks)
    .where(and(eq(dailyChecks.id, id), eq(dailyChecks.userId, req.userId!)));
  if (!check) return res.status(404).json({ error: 'Check no encontrado' });
  if (check.kind === 'peso') {
    return res.status(400).json({ error: 'El pesaje se cumple registrando el peso' });
  }

  if (parsed.data.done) {
    const [existing] = await db
      .select()
      .from(dailyCheckDone)
      .where(and(eq(dailyCheckDone.checkId, id), eq(dailyCheckDone.checkDate, date)));
    if (!existing) await db.insert(dailyCheckDone).values({ userId: req.userId!, checkId: id, checkDate: date });
  } else {
    await db
      .delete(dailyCheckDone)
      .where(and(eq(dailyCheckDone.checkId, id), eq(dailyCheckDone.checkDate, date), eq(dailyCheckDone.userId, req.userId!)));
  }
  res.json({ id, date, done: parsed.data.done });
}));

// GET /summary?from&to -> agregado por día: pitis por contexto y último peso
healthModule.get('/summary', ah(async (req: AuthedRequest, res) => {
  const from = String(req.query.from ?? '');
  const to = String(req.query.to ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'Rango inválido' });
  }
  const rows = await db
    .select()
    .from(healthEntries)
    .where(and(eq(healthEntries.userId, req.userId!), gte(healthEntries.entryDate, from), lte(healthEntries.entryDate, to)))
    .orderBy(desc(healthEntries.entryDate), asc(healthEntries.createdAt));

  const byDate = new Map<string, { date: string; cigarros: number; peso: number | null; pesoTime: string | null }>();
  for (const r of rows) {
    if (!byDate.has(r.entryDate)) byDate.set(r.entryDate, { date: r.entryDate, cigarros: 0, peso: null, pesoTime: null });
    const d = byDate.get(r.entryDate)!;
    if (r.kind === 'cigarro') d.cigarros += 1;
    if (r.kind === 'peso' && r.value != null) {
      d.peso = r.value; // el último del día gana
      d.pesoTime = r.entryTime;
    }
  }
  res.json([...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)));
}));
