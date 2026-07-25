import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { healthEntries } from '../../db/schema';
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

// DELETE /entries/:id -> corrige un registro erróneo (borrado real: es un tally)
healthModule.delete('/entries/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .delete(healthEntries)
    .where(and(eq(healthEntries.id, id), eq(healthEntries.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Registro no encontrado' });
  res.json({ deleted: true });
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
