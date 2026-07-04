import { Router } from 'express';
import { ah } from '../../lib/async';
import { and, asc, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../db';
import { projects, spaces, tasks } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';
import { taskInput, taskUpdate } from './validation';

export const tasksRouter = Router();

const OPEN_STATUSES = ['backlog', 'in_progress', 'blocked'] as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/tasks?projectId=&spaceId=&status=&view=today|upcoming|overdue
// Por defecto: solo tareas abiertas (backlog/en progreso/bloqueada).
// status=completed => vista "Completadas" (recuperación). status=all => todo.
tasksRouter.get('/', ah(async (req: AuthedRequest, res) => {
  // Se excluyen tareas de proyectos o espacios archivados
  const conds = [
    eq(tasks.userId, req.userId!),
    isNull(tasks.archivedAt),
    isNull(projects.archivedAt),
    isNull(spaces.archivedAt),
  ];

  const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
  if (projectId) conds.push(eq(tasks.projectId, projectId));
  const spaceId = req.query.spaceId ? Number(req.query.spaceId) : undefined;
  if (spaceId) conds.push(eq(projects.spaceId, spaceId));

  const status = String(req.query.status ?? 'open');
  if (status === 'open') conds.push(inArray(tasks.status, [...OPEN_STATUSES]));
  else if (status !== 'all') {
    conds.push(eq(tasks.status, status as (typeof tasks.status.enumValues)[number]));
  }

  // Vista transversal por fecha (cruza todos los espacios)
  const view = req.query.view ? String(req.query.view) : undefined;
  if (view === 'today') conds.push(eq(tasks.dueDate, today()));
  if (view === 'overdue') conds.push(lt(tasks.dueDate, today()));
  if (view === 'upcoming') conds.push(gt(tasks.dueDate, today()));

  const rows = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      sortOrder: tasks.sortOrder,
      completedAt: tasks.completedAt,
      projectName: projects.name,
      spaceId: projects.spaceId,
      spaceName: spaces.name,
      spaceColor: spaces.color,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(and(...conds))
    .orderBy(sql`${tasks.dueDate} is null`, asc(tasks.dueDate), asc(tasks.sortOrder));
  res.json(rows);
}));

// GET /api/tasks/:id — detalle con migas de pan (espacio + proyecto)
tasksRouter.get('/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [row] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      notes: tasks.notes,
      dueDate: tasks.dueDate,
      sortOrder: tasks.sortOrder,
      completedAt: tasks.completedAt,
      projectName: projects.name,
      spaceId: projects.spaceId,
      spaceName: spaces.name,
      spaceColor: spaces.color,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId!)));
  if (!row) return res.status(404).json({ error: 'Tarea no encontrada' });
  res.json(row);
}));

// POST /api/tasks
tasksRouter.post('/', ah(async (req: AuthedRequest, res) => {
  const parsed = taskInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, parsed.data.projectId), eq(projects.userId, req.userId!)));
  if (!project) return res.status(400).json({ error: 'El proyecto indicado no existe' });
  const [result] = await db.insert(tasks).values({ ...parsed.data, userId: req.userId! });
  const [row] = await db.select().from(tasks).where(eq(tasks.id, result.insertId));
  res.status(201).json(row);
}));

// PATCH /api/tasks/:id
tasksRouter.patch('/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = taskUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === 'completed') data.completedAt = new Date();
  else if (parsed.data.status) data.completedAt = null;

  const [result] = await db
    .update(tasks)
    .set(data)
    .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  res.json(row);
}));

// DELETE /api/tasks/:id — archiva, no borra
tasksRouter.delete('/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .update(tasks)
    .set({ archivedAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId!), isNull(tasks.archivedAt)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
  res.json({ archived: true });
}));
