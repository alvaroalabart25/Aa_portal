import { Router } from 'express';
import { ah } from '../../lib/async';
import { and, asc, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../db';
import { projects, spaces, tasks } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';
import { taskInput, taskUpdate } from './validation';

export const tasksRouter = Router();

// Una tarea en revisión sigue viva: cuenta como abierta en agenda y contadores
const OPEN_STATUSES = ['backlog', 'in_progress', 'in_review', 'blocked'] as const;

// El día de HOY en Madrid, que es donde vive quien usa esto. Con UTC, entre
// medianoche y las dos de la mañana «hoy» era ayer.
function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', dateStyle: 'short' }).format(new Date());
}

/**
 * El próximo día que le toca a una tarea que se repite.
 *
 * `desde` no cuenta: al marcar hecha la del lunes, la siguiente es la del
 * martes, no otra vez la de hoy. Con `incluirHoy` sí cuenta, que es lo que
 * hace falta al configurar la repetición por primera vez.
 */
function proximaFecha(repeatDays: string, desde: string, incluirHoy = false): string | null {
  const dias = new Set(repeatDays.split(',').filter(Boolean).map(Number));
  if (dias.size === 0) return null;
  // mediodía a propósito: así ningún cambio de hora mueve el día
  const d = new Date(`${desde}T12:00:00`);
  const iso = (x: Date) => new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(x);
  // 1 = lunes … 7 = domingo (getDay da 0 para domingo)
  const numeroDeDia = (x: Date) => ((x.getDay() + 6) % 7) + 1;
  if (incluirHoy && dias.has(numeroDeDia(d))) return iso(d);
  for (let i = 0; i < 7; i++) {
    d.setDate(d.getDate() + 1);
    if (dias.has(numeroDeDia(d))) return iso(d);
  }
  return null;
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
      repeatDays: tasks.repeatDays,
      lastDoneAt: tasks.lastDoneAt,
      postponedCount: tasks.postponedCount,
      lastPostponedAt: tasks.lastPostponedAt,
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
      repeatDays: tasks.repeatDays,
      lastDoneAt: tasks.lastDoneAt,
      postponedCount: tasks.postponedCount,
      lastPostponedAt: tasks.lastPostponedAt,
      // Desde cuándo lleva esto abierto: es lo que da sentido al número de
      // aplazos —cuatro veces en una semana no es lo mismo que en tres meses—.
      createdAt: tasks.createdAt,
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
  const valores = { ...parsed.data };
  // Nace repitiéndose y sin fecha: se le pone la próxima que toque, hoy
  // incluido. Si no, no saldría en ninguna lista.
  if (valores.repeatDays && !valores.dueDate) {
    valores.dueDate = proximaFecha(valores.repeatDays, today(), true);
  }
  const [result] = await db.insert(tasks).values({ ...valores, userId: req.userId! });
  const [row] = await db.select().from(tasks).where(eq(tasks.id, result.insertId));
  res.status(201).json(row);
}));

// PATCH /api/tasks/:id
tasksRouter.patch('/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = taskUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const [antes] = await db
    .select({ dueDate: tasks.dueDate, repeatDays: tasks.repeatDays })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId!)));
  if (!antes) return res.status(404).json({ error: 'Tarea no encontrada' });

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === 'completed') data.completedAt = new Date();
  else if (parsed.data.status) data.completedAt = null;

  // Los días de repetición que valen tras este cambio: los que vengan en la
  // petición, y si no, los que ya tenía.
  const repite = parsed.data.repeatDays ?? antes.repeatDays;

  /**
   * Una tarea que se repite no se completa: se marca hecha por hoy y se va a
   * su próximo día.
   *
   * Completarla de verdad la mataría, y lo que él pidió es justo lo contrario:
   * «al darle completada me desaparezca y al día siguiente me aparezca». Vive
   * en el servidor y no en la pantalla porque se marca hecha desde cuatro
   * sitios distintos (la lista, la ficha, Macro, la agenda) y una copia mal
   * hecha en uno de ellos dejaría la tarea muerta.
   */
  let vuelveEl: string | null = null;
  if (parsed.data.status === 'completed' && repite) {
    const hoy = today();
    vuelveEl = proximaFecha(repite, hoy);
    data.status = 'backlog';
    data.completedAt = null;
    data.lastDoneAt = hoy;
    data.dueDate = vuelveEl;
  } else if (parsed.data.repeatDays && !parsed.data.dueDate && !antes.dueDate) {
    // Al ponerle días por primera vez y no tener fecha, se le da la próxima
    // que toque (hoy incluido): una tarea que se repite sin fecha no aparece
    // en ninguna lista, y parecería que no se ha guardado.
    data.dueDate = proximaFecha(parsed.data.repeatDays, today(), true);
  }

  // Aplazar = empujar la fecha hacia adelante. Solo eso cuenta: adelantarla,
  // ponerla por primera vez o quitarla no son aplazamientos, y contarlos
  // convertiría el número en ruido en vez de en una señal de que algo se atasca.
  // Marcar hecha una tarea que se repite tampoco: su fecha se mueve sola.
  if (parsed.data.dueDate && !vuelveEl) {
    if (antes.dueDate && parsed.data.dueDate > antes.dueDate) {
      data.postponedCount = sql`${tasks.postponedCount} + 1`;
      data.lastPostponedAt = new Date();
    }
  }

  const [result] = await db
    .update(tasks)
    .set(data)
    .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  // `vuelveEl` viaja aparte para que la pantalla pueda decir cuándo toca otra
  // vez sin tener que deducirlo de la fecha.
  res.json(vuelveEl ? { ...row, vuelveEl } : row);
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
