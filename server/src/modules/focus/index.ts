import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, getTableColumns, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { focusDaily, focusItems, focusTasks, projects, spaces, tasks } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';

/**
 * Vista Macro: lo que tengo entre manos este mes, frente a lo que toca hoy.
 *
 * Tres tipos en una sola entidad (melón / formación / libro). El melón es un
 * objetivo del mes que se NUTRE de tareas que ya existen y que viven en
 * espacios distintos; no las posee ni las mueve, solo las señala.
 */
export const focusModule = Router();

const KINDS = ['melon', 'formacion', 'libro'] as const;
const SCOPES = ['trabajo', 'personal'] as const;

// Topes del mes, pedidos por el usuario. Avisan, no bloquean: un límite duro se
// esquiva por fuera; uno que te lo dice cumple su función, que es hacerte
// consciente de que estás disperso.
export const TOPES: Record<(typeof SCOPES)[number], number> = { trabajo: 3, personal: 2 };

function hoyMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', dateStyle: 'short' }).format(new Date());
}
const mesDe = (iso: string) => iso.slice(0, 7);

/** Racha: días seguidos hacia atrás con marca (hecha o libre), contando hoy si la hay. */
function racha(fechas: string[], hoy: string): number {
  const puestas = new Set(fechas);
  let dias = 0;
  const d = new Date(`${hoy}T12:00:00`);
  // si hoy aún no está marcado, la racha se mide desde ayer: no se ha roto,
  // simplemente el día no ha terminado
  if (!puestas.has(hoy)) d.setDate(d.getDate() - 1);
  for (;;) {
    const iso = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(d);
    if (!puestas.has(iso)) break;
    dias += 1;
    d.setDate(d.getDate() - 1);
  }
  return dias;
}

// ---------- Listado del mes ----------

/**
 * GET /?month=YYYY-MM (por defecto, el mes en curso).
 *
 * Devuelve lo activo (arrastrando lo que viene de meses anteriores) y lo hecho
 * ESTE mes. Los recuentos de tareas van como subconsultas: ojo, la columna de
 * fuera va escrita a mano (`focus_items.id`), no interpolada — Drizzle la
 * generaría sin cualificar y la capturaría la tabla de dentro.
 */
focusModule.get('/', ah(async (req: AuthedRequest, res) => {
  const hoy = hoyMadrid();
  const mes = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : mesDe(hoy);

  const filas = await db
    .select({
      ...getTableColumns(focusItems),
      tareasTotal: sql<number>`(select count(*) from focus_tasks ft where ft.item_id = focus_items.id)`,
      tareasHechas: sql<number>`(select count(*) from focus_tasks ft join tasks t on t.id = ft.task_id
        where ft.item_id = focus_items.id and t.status in ('completed','cancelled'))`,
    })
    .from(focusItems)
    .where(and(eq(focusItems.userId, req.userId!), isNull(focusItems.archivedAt)))
    .orderBy(asc(focusItems.sortOrder), asc(focusItems.id));

  // Lo que se ve este mes: lo activo (venga de donde venga) y lo cerrado en el mes
  const delMes = filas.filter(
    (f) => (f.status === 'activo' && f.startMonth <= mes) || (f.doneAt != null && mesDe(f.doneAt) === mes),
  );

  // Marcas diarias de los que tienen gesto diario, para la racha y el «¿hoy?»
  const conDiario = delMes.filter((f) => f.daily === 1).map((f) => f.id);
  const marcas = new Map<number, string[]>();
  const hoyMarcado = new Map<number, 'hecho' | 'libre'>();
  if (conDiario.length) {
    const rows = await db
      .select({ itemId: focusDaily.itemId, doneDate: focusDaily.doneDate, mark: focusDaily.mark })
      .from(focusDaily)
      .where(and(eq(focusDaily.userId, req.userId!), inArray(focusDaily.itemId, conDiario)))
      .orderBy(desc(focusDaily.doneDate));
    for (const r of rows) {
      if (!marcas.has(r.itemId)) marcas.set(r.itemId, []);
      marcas.get(r.itemId)!.push(r.doneDate);
      if (r.doneDate === hoy) hoyMarcado.set(r.itemId, r.mark);
    }
  }

  const items = delMes.map(({ tareasTotal, tareasHechas, ...f }) => ({
    ...f,
    tareas: { hechas: Number(tareasHechas ?? 0), total: Number(tareasTotal ?? 0) },
    arrastra: f.status === 'activo' && f.startMonth < mes ? f.startMonth : null,
    racha: f.daily === 1 ? racha(marcas.get(f.id) ?? [], hoy) : 0,
    hoy: f.daily === 1 ? (hoyMarcado.get(f.id) ?? null) : null,
  }));

  // Recuento de melones activos por ámbito, para el aviso de dispersión
  const melones = items.filter((i) => i.kind === 'melon' && i.status === 'activo');
  res.json({
    month: mes,
    today: hoy,
    items,
    limites: {
      trabajo: { usados: melones.filter((m) => m.scope === 'trabajo').length, tope: TOPES.trabajo },
      personal: { usados: melones.filter((m) => m.scope === 'personal').length, tope: TOPES.personal },
    },
  });
}));

// ---------- Crear, editar, archivar ----------

const crearInput = z.object({
  kind: z.enum(KINDS),
  scope: z.enum(SCOPES).default('trabajo'),
  title: z.string().trim().min(1).max(200),
  daily: z.boolean().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

focusModule.post('/', ah(async (req: AuthedRequest, res) => {
  const parsed = crearInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { kind, scope, title, daily, month } = parsed.data;

  const [{ n }] = await db
    .select({ n: sql<number>`min(sort_order)` })
    .from(focusItems)
    .where(and(eq(focusItems.userId, req.userId!), eq(focusItems.kind, kind)));

  const [result] = await db.insert(focusItems).values({
    userId: req.userId!,
    kind,
    scope,
    title,
    // una formación nace con gesto diario; un melón nunca; un libro, si lo pides
    daily: (daily ?? kind === 'formacion') ? 1 : 0,
    startMonth: month ?? mesDe(hoyMadrid()),
    sortOrder: Number(n ?? 0) - 1,
  });
  const [row] = await db.select().from(focusItems).where(eq(focusItems.id, result.insertId));
  res.status(201).json(row);
}));

const editarInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().max(50000).nullable().optional(),
  scope: z.enum(SCOPES).optional(),
  status: z.enum(['activo', 'hecho', 'aparcado']).optional(),
  daily: z.boolean().optional(),
});

focusModule.patch('/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = editarInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const [actual] = await db
    .select()
    .from(focusItems)
    .where(and(eq(focusItems.id, id), eq(focusItems.userId, req.userId!)));
  if (!actual) return res.status(404).json({ error: 'No encontrado' });

  const cambios: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    cambios[k] = k === 'daily' ? (v ? 1 : 0) : v;
  }
  // darlo por hecho pone la fecha sola; reabrirlo la quita
  if (parsed.data.status === 'hecho' && actual.status !== 'hecho') cambios.doneAt = actual.doneAt ?? hoyMadrid();
  else if (parsed.data.status && parsed.data.status !== 'hecho' && actual.status === 'hecho') cambios.doneAt = null;

  if (Object.keys(cambios).length) {
    await db.update(focusItems).set(cambios).where(and(eq(focusItems.id, id), eq(focusItems.userId, req.userId!)));
  }
  const [row] = await db.select().from(focusItems).where(eq(focusItems.id, id));
  res.json(row);
}));

focusModule.delete('/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .update(focusItems)
    .set({ archivedAt: new Date() })
    .where(and(eq(focusItems.id, id), eq(focusItems.userId, req.userId!), isNull(focusItems.archivedAt)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
  res.json({ archived: true });
}));

focusModule.post('/reorder', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ ids: z.array(z.number().int().positive()).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  await Promise.all(
    parsed.data.ids.map((id, i) =>
      db.update(focusItems).set({ sortOrder: i }).where(and(eq(focusItems.id, id), eq(focusItems.userId, req.userId!))),
    ),
  );
  res.json({ ok: true });
}));

// ---------- Ficha ----------

focusModule.get('/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [item] = await db
    .select()
    .from(focusItems)
    .where(and(eq(focusItems.id, id), eq(focusItems.userId, req.userId!), isNull(focusItems.archivedAt)));
  if (!item) return res.status(404).json({ error: 'No encontrado' });

  const hoy = hoyMadrid();
  const [tareas, dias] = await Promise.all([
    // las tareas del melón, con su proyecto y su espacio: viven ahí, aquí solo
    // se enseñan juntas
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        projectId: tasks.projectId,
        projectName: projects.name,
        spaceId: spaces.id,
        spaceName: spaces.name,
        spaceColor: spaces.color,
      })
      .from(focusTasks)
      .innerJoin(tasks, eq(tasks.id, focusTasks.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(spaces, eq(spaces.id, projects.spaceId))
      .where(and(eq(focusTasks.itemId, id), isNull(tasks.archivedAt)))
      .orderBy(asc(spaces.name), asc(tasks.dueDate)),
    db
      .select({ doneDate: focusDaily.doneDate, mark: focusDaily.mark })
      .from(focusDaily)
      .where(eq(focusDaily.itemId, id))
      .orderBy(desc(focusDaily.doneDate))
      .limit(120),
  ]);

  res.json({
    ...item,
    tasks: tareas,
    dias,
    racha: item.daily === 1 ? racha(dias.map((d) => d.doneDate), hoy) : 0,
    hoy: dias.find((d) => d.doneDate === hoy)?.mark ?? null,
    today: hoy,
  });
}));

// ---------- Gesto diario ----------

/**
 * POST /:id/daily { mark: 'hecho' | 'libre' | 'ninguno', date? }
 *
 * Es un hábito, no una tarea: se marca el día y mañana vuelve limpio. No hay
 * «mover a mañana» a propósito — un día que no fue, no fue, y eso es justo la
 * información que interesa. `libre` es el día de descanso adrede, que cuenta
 * para la racha.
 */
focusModule.post('/:id(\\d+)/daily', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z
    .object({
      mark: z.enum(['hecho', 'libre', 'ninguno']),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const [item] = await db
    .select({ id: focusItems.id, daily: focusItems.daily })
    .from(focusItems)
    .where(and(eq(focusItems.id, id), eq(focusItems.userId, req.userId!)));
  if (!item) return res.status(404).json({ error: 'No encontrado' });
  if (item.daily !== 1) return res.status(400).json({ error: 'Esto no tiene gesto diario' });

  const fecha = parsed.data.date ?? hoyMadrid();
  await db.delete(focusDaily).where(and(eq(focusDaily.itemId, id), eq(focusDaily.doneDate, fecha)));
  if (parsed.data.mark !== 'ninguno') {
    await db.insert(focusDaily).values({ userId: req.userId!, itemId: id, doneDate: fecha, mark: parsed.data.mark });
  }

  const dias = await db
    .select({ doneDate: focusDaily.doneDate })
    .from(focusDaily)
    .where(eq(focusDaily.itemId, id))
    .orderBy(desc(focusDaily.doneDate))
    .limit(120);
  const hoy = hoyMadrid();
  res.json({
    date: fecha,
    mark: parsed.data.mark === 'ninguno' ? null : parsed.data.mark,
    racha: racha(dias.map((d) => d.doneDate), hoy),
  });
}));

// ---------- Tareas del melón ----------

focusModule.post('/:id(\\d+)/tasks', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ taskId: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const [item] = await db
    .select({ id: focusItems.id })
    .from(focusItems)
    .where(and(eq(focusItems.id, id), eq(focusItems.userId, req.userId!)));
  if (!item) return res.status(404).json({ error: 'No encontrado' });

  const [tarea] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, parsed.data.taskId), eq(tasks.userId, req.userId!)));
  if (!tarea) return res.status(400).json({ error: 'Esa tarea no existe' });

  const [ya] = await db
    .select({ id: focusTasks.id })
    .from(focusTasks)
    .where(and(eq(focusTasks.itemId, id), eq(focusTasks.taskId, parsed.data.taskId)));
  if (ya) return res.json({ ok: true, ya: true });

  await db.insert(focusTasks).values({ userId: req.userId!, itemId: id, taskId: parsed.data.taskId });
  res.status(201).json({ ok: true });
}));

focusModule.delete('/:id(\\d+)/tasks/:taskId(\\d+)', ah(async (req: AuthedRequest, res) => {
  const [result] = await db
    .delete(focusTasks)
    .where(
      and(
        eq(focusTasks.itemId, Number(req.params.id)),
        eq(focusTasks.taskId, Number(req.params.taskId)),
        eq(focusTasks.userId, req.userId!),
      ),
    );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Esa tarea no estaba asociada' });
  res.json({ deleted: true });
}));

/**
 * GET /:id/candidatas?q=&spaceId=&projectId= — tareas para asociar al melón.
 *
 * Busca en TODOS los espacios a propósito: la gracia del melón es juntar cosas
 * repartidas. Se ordena por vencimiento (hoy, mañana, pasado…) y las que no
 * tienen fecha van al final: es el orden en que se decide qué atacar.
 *
 * NO se ofrecen tareas cerradas: asociar algo ya hecho no aporta. Si una tarea
 * se completa DESPUÉS de asociarla, se queda en el melón y cuenta como avance.
 */
focusModule.get('/:id(\\d+)/candidatas', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  const spaceId = Number(req.query.spaceId);
  const projectId = Number(req.query.projectId);

  const yaPuestas = await db.select({ taskId: focusTasks.taskId }).from(focusTasks).where(eq(focusTasks.itemId, id));
  const excluir = new Set(yaPuestas.map((x) => x.taskId));

  const filas = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      projectId: tasks.projectId,
      projectName: projects.name,
      spaceId: spaces.id,
      spaceName: spaces.name,
      spaceColor: spaces.color,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(spaces, eq(spaces.id, projects.spaceId))
    .where(
      and(
        eq(tasks.userId, req.userId!),
        isNull(tasks.archivedAt),
        notInArray(tasks.status, ['completed', 'cancelled']),
        q ? sql`${tasks.title} like ${'%' + q + '%'}` : sql`1 = 1`,
        Number.isInteger(spaceId) && spaceId > 0 ? eq(spaces.id, spaceId) : sql`1 = 1`,
        Number.isInteger(projectId) && projectId > 0 ? eq(tasks.projectId, projectId) : sql`1 = 1`,
      ),
    )
    // las sin fecha al final: `due_date is null` ordena 0 antes que 1
    .orderBy(sql`${tasks.dueDate} is null`, asc(tasks.dueDate), asc(tasks.id))
    .limit(80);

  res.json(filas.filter((f) => !excluir.has(f.id)));
}));

// ---------- Desde el lado de la tarea ----------

/** Melones activos, para el selector de la ficha de una tarea. */
focusModule.get('/melones', ah(async (req: AuthedRequest, res) => {
  const filas = await db
    .select({ id: focusItems.id, title: focusItems.title, scope: focusItems.scope, startMonth: focusItems.startMonth })
    .from(focusItems)
    .where(
      and(
        eq(focusItems.userId, req.userId!),
        eq(focusItems.kind, 'melon'),
        eq(focusItems.status, 'activo'),
        isNull(focusItems.archivedAt),
      ),
    )
    .orderBy(asc(focusItems.sortOrder), asc(focusItems.id));
  res.json(filas);
}));

/** ¿A qué melones está asociada esta tarea? */
focusModule.get('/tarea/:taskId(\\d+)', ah(async (req: AuthedRequest, res) => {
  const filas = await db
    .select({ id: focusItems.id, title: focusItems.title, scope: focusItems.scope })
    .from(focusTasks)
    .innerJoin(focusItems, eq(focusItems.id, focusTasks.itemId))
    .where(
      and(
        eq(focusTasks.taskId, Number(req.params.taskId)),
        eq(focusTasks.userId, req.userId!),
        isNull(focusItems.archivedAt),
      ),
    )
    .orderBy(asc(focusItems.sortOrder));
  res.json(filas);
}));
