import { Router } from 'express';
import { ah } from '../../lib/async';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import { projects, spaces, tasks } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';
import { spaceInput, spaceUpdate } from './validation';

export const spacesRouter = Router();

// GET /api/spaces — espacios no archivados, con nº de proyectos activos
spacesRouter.get('/', ah(async (req: AuthedRequest, res) => {
  const rows = await db
    .select({
      id: spaces.id,
      name: spaces.name,
      color: spaces.color,
      notes: spaces.notes,
      sortOrder: spaces.sortOrder,
    })
    .from(spaces)
    .where(and(eq(spaces.userId, req.userId!), isNull(spaces.archivedAt)))
    .orderBy(asc(spaces.sortOrder), asc(spaces.name));

  const counts = await db
    .select({ spaceId: projects.spaceId, n: sql<number>`count(*)` })
    .from(projects)
    .where(
      and(eq(projects.userId, req.userId!), eq(projects.status, 'active'), isNull(projects.archivedAt)),
    )
    .groupBy(projects.spaceId);
  const bySpace = new Map(counts.map((c) => [c.spaceId, Number(c.n)]));

  res.json(rows.map((r) => ({ ...r, activeProjects: bySpace.get(r.id) ?? 0 })));
}));

// GET /api/spaces/:id — detalle
spacesRouter.get('/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [row] = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.id, id), eq(spaces.userId, req.userId!)));
  if (!row) return res.status(404).json({ error: 'Espacio no encontrado' });
  res.json(row);
}));

// POST /api/spaces
spacesRouter.post('/', ah(async (req: AuthedRequest, res) => {
  const parsed = spaceInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [result] = await db
    .insert(spaces)
    .values({ ...parsed.data, userId: req.userId! });
  const [row] = await db.select().from(spaces).where(eq(spaces.id, result.insertId));
  res.status(201).json(row);
}));

// PATCH /api/spaces/:id
spacesRouter.patch('/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = spaceUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [result] = await db
    .update(spaces)
    .set(parsed.data)
    .where(and(eq(spaces.id, id), eq(spaces.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Espacio no encontrado' });
  const [row] = await db.select().from(spaces).where(eq(spaces.id, id));
  res.json(row);
}));

// DELETE /api/spaces/:id — nunca borra: archiva (y sus proyectos/tareas quedan ocultos con él)
spacesRouter.delete('/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .update(spaces)
    .set({ archivedAt: new Date() })
    .where(and(eq(spaces.id, id), eq(spaces.userId, req.userId!), isNull(spaces.archivedAt)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Espacio no encontrado' });
  res.json({ archived: true });
}));
