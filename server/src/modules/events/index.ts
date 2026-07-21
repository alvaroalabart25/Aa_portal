import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { events, spaces } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';

// Eventos importantes: fechas clave vinculadas a Autónomo o a un espacio.
// Solo se editan desde la tab Eventos de la Agenda; el resto de vistas los
// muestran en modo lectura.
export const eventsModule = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');

const eventBase = z.object({
  title: z.string().trim().min(1).max(200),
  emoji: z.string().trim().min(1).max(16).default('📌'),
  eventDate: isoDate,
  recurrence: z.enum(['none', 'monthly', 'yearly']).default('none'),
  scope: z.enum(['autonomo', 'space']),
  spaceId: z.number().int().positive().nullish(),
});

const eventInput = eventBase.refine((d) => d.scope !== 'space' || !!d.spaceId, {
  message: 'Elige el espacio del evento',
});

// GET /api/events — con nombre/color del espacio para pintar
eventsModule.get('/', ah(async (req: AuthedRequest, res) => {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      emoji: events.emoji,
      eventDate: events.eventDate,
      recurrence: events.recurrence,
      scope: events.scope,
      spaceId: events.spaceId,
      spaceName: spaces.name,
      spaceColor: spaces.color,
    })
    .from(events)
    .leftJoin(spaces, eq(events.spaceId, spaces.id))
    .where(and(eq(events.userId, req.userId!), isNull(events.archivedAt)))
    .orderBy(asc(events.eventDate));
  res.json(rows);
}));

eventsModule.post('/', ah(async (req: AuthedRequest, res) => {
  const parsed = eventInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;
  const [result] = await db.insert(events).values({
    userId: req.userId!,
    title: d.title,
    emoji: d.emoji,
    eventDate: d.eventDate,
    recurrence: d.recurrence,
    scope: d.scope,
    spaceId: d.scope === 'space' ? d.spaceId! : null,
  });
  const [row] = await db.select().from(events).where(eq(events.id, result.insertId));
  res.status(201).json(row);
}));

eventsModule.patch('/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = eventBase.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;
  const data: Record<string, unknown> = { ...d };
  if (d.scope === 'autonomo') data.spaceId = null;
  const [result] = await db
    .update(events)
    .set(data)
    .where(and(eq(events.id, id), eq(events.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Evento no encontrado' });
  const [row] = await db.select().from(events).where(eq(events.id, id));
  res.json(row);
}));

eventsModule.delete('/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .update(events)
    .set({ archivedAt: new Date() })
    .where(and(eq(events.id, id), eq(events.userId, req.userId!), isNull(events.archivedAt)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json({ archived: true });
}));
