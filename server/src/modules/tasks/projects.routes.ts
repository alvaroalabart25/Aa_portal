import { Router } from 'express';
import { and, asc, eq, inArray, isNull, not, sql } from 'drizzle-orm';
import { db } from '../../db';
import { projects, spaces, tasks } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';
import { projectInput, projectUpdate } from './validation';

export const projectsRouter = Router();

const taskCounts = {
  totalTasks: sql<number>`(
    select count(*) from ${tasks} t
    where t.project_id = ${projects.id} and t.status not in ('cancelled') and t.archived_at is null
  )`,
  doneTasks: sql<number>`(
    select count(*) from ${tasks} t
    where t.project_id = ${projects.id} and t.status = 'completed' and t.archived_at is null
  )`,
};

// GET /api/projects?spaceId=&status= — por defecto solo activos (los completados/cancelados se ocultan)
projectsRouter.get('/', async (req: AuthedRequest, res) => {
  const conds = [eq(projects.userId, req.userId!), isNull(projects.archivedAt)];
  const spaceId = req.query.spaceId ? Number(req.query.spaceId) : undefined;
  if (spaceId) conds.push(eq(projects.spaceId, spaceId));
  const status = String(req.query.status ?? 'active');
  if (status !== 'all') {
    conds.push(eq(projects.status, status as 'active' | 'completed' | 'cancelled'));
  }
  const rows = await db
    .select({
      id: projects.id,
      spaceId: projects.spaceId,
      name: projects.name,
      status: projects.status,
      dueDate: projects.dueDate,
      sortOrder: projects.sortOrder,
      spaceName: spaces.name,
      spaceColor: spaces.color,
      ...taskCounts,
    })
    .from(projects)
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(and(...conds))
    .orderBy(asc(projects.sortOrder), asc(projects.name));
  res.json(rows);
});

// GET /api/projects/:id — detalle (con nombre/color del espacio para migas de pan)
projectsRouter.get('/:id', async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [row] = await db
    .select({
      id: projects.id,
      spaceId: projects.spaceId,
      name: projects.name,
      status: projects.status,
      notes: projects.notes,
      dueDate: projects.dueDate,
      sortOrder: projects.sortOrder,
      completedAt: projects.completedAt,
      spaceName: spaces.name,
      spaceColor: spaces.color,
      ...taskCounts,
    })
    .from(projects)
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(and(eq(projects.id, id), eq(projects.userId, req.userId!)));
  if (!row) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json(row);
});

// POST /api/projects
projectsRouter.post('/', async (req: AuthedRequest, res) => {
  const parsed = projectInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [space] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.id, parsed.data.spaceId), eq(spaces.userId, req.userId!)));
  if (!space) return res.status(400).json({ error: 'El espacio indicado no existe' });
  const [result] = await db.insert(projects).values({ ...parsed.data, userId: req.userId! });
  const [row] = await db.select().from(projects).where(eq(projects.id, result.insertId));
  res.status(201).json(row);
});

// PATCH /api/projects/:id — completar proyecto => completa y oculta sus tareas pendientes
projectsRouter.patch('/:id', async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = projectUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === 'completed') data.completedAt = new Date();
  if (parsed.data.status === 'active') data.completedAt = null;

  const [result] = await db
    .update(projects)
    .set(data)
    .where(and(eq(projects.id, id), eq(projects.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });

  // Cascada de negocio: al completar el proyecto, sus tareas abiertas se completan
  if (parsed.data.status === 'completed') {
    await db
      .update(tasks)
      .set({ status: 'completed', completedAt: new Date() })
      .where(
        and(
          eq(tasks.projectId, id),
          eq(tasks.userId, req.userId!),
          not(inArray(tasks.status, ['completed', 'cancelled'])),
        ),
      );
  }
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  res.json(row);
});

// DELETE /api/projects/:id — archiva, no borra
projectsRouter.delete('/:id', async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .update(projects)
    .set({ archivedAt: new Date() })
    .where(and(eq(projects.id, id), eq(projects.userId, req.userId!), isNull(projects.archivedAt)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json({ archived: true });
});
