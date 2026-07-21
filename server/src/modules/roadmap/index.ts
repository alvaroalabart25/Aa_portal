import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { roadmapItems } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';

// Road Map: listado estanco de mejoras del portal, por categoría.
export const roadmapModule = Router();

const itemBase = z.object({
  title: z.string().trim().min(1).max(255),
  category: z.enum(['agenda', 'organizacion', 'autonomo', 'futuros']),
  status: z.enum(['pending', 'in_progress', 'done']).default('pending'),
});

roadmapModule.get('/', ah(async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(roadmapItems)
    .where(and(eq(roadmapItems.userId, req.userId!), isNull(roadmapItems.archivedAt)))
    .orderBy(asc(roadmapItems.createdAt));
  res.json(rows);
}));

roadmapModule.post('/', ah(async (req: AuthedRequest, res) => {
  const parsed = itemBase.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [result] = await db.insert(roadmapItems).values({ ...parsed.data, userId: req.userId! });
  const [row] = await db.select().from(roadmapItems).where(eq(roadmapItems.id, result.insertId));
  res.status(201).json(row);
}));

roadmapModule.patch('/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = itemBase.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [result] = await db
    .update(roadmapItems)
    .set(parsed.data)
    .where(and(eq(roadmapItems.id, id), eq(roadmapItems.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Mejora no encontrada' });
  const [row] = await db.select().from(roadmapItems).where(eq(roadmapItems.id, id));
  res.json(row);
}));

roadmapModule.delete('/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .update(roadmapItems)
    .set({ archivedAt: new Date() })
    .where(and(eq(roadmapItems.id, id), eq(roadmapItems.userId, req.userId!), isNull(roadmapItems.archivedAt)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Mejora no encontrada' });
  res.json({ archived: true });
}));
