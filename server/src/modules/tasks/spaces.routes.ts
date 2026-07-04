import { Router } from 'express';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import { projects, spaces, tasks } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';
import { spaceInput, spaceUpdate } from './validation';

export const spacesRouter = Router();

// GET /api/spaces — espacios no archivados, con nº de proyectos activos
spacesRouter.get('/', async (req: AuthedRequest, res) => {
  const rows = await db
    .select({
      id: spaces.id,
      name: spaces.name,
      color: spaces.color,
      notes: spaces.notes,
      sortOrder: spaces.sortOrder,
      activeProjects: sql<number>`(
        select count(*) from ${projects} p
        where p.space_id = ${spaces.id} and p.status = 'active' and p.archived_at is null
      )`,
    })
    .from(spaces)
    .where(and(eq(spaces.userId, req.userId!), isNull(spaces.archivedAt)))
    .orderBy(asc(spaces.sortOrder), asc(spaces.name));
  res.json(rows);
});

// GET /api/spaces/:id — detalle
spacesRouter.get('/:id', async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [row] = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.id, id), eq(spaces.userId, req.userId!)));
  if (!row) return res.status(404).json({ error: 'Espacio no encontrado' });
  res.json(row);
});

// POST /api/spaces
spacesRouter.post('/', async (req: AuthedRequest, res) => {
  const parsed = spaceInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [result] = await db
    .insert(spaces)
    .values({ ...parsed.data, userId: req.userId! });
  const [row] = await db.select().from(spaces).where(eq(spaces.id, result.insertId));
  res.status(201).json(row);
});

// PATCH /api/spaces/:id
spacesRouter.patch('/:id', async (req: AuthedRequest, res) => {
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
});

// DELETE /api/spaces/:id — nunca borra: archiva (y sus proyectos/tareas quedan ocultos con él)
spacesRouter.delete('/:id', async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .update(spaces)
    .set({ archivedAt: new Date() })
    .where(and(eq(spaces.id, id), eq(spaces.userId, req.userId!), isNull(spaces.archivedAt)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Espacio no encontrado' });
  res.json({ archived: true });
});
