import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, getTableColumns, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { focusDaily, focusItems, focusProjects, focusTasks, projects, spaces, tasks } from '../../db/schema';
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

/** Los `n` días que acaban hoy, del más antiguo al más reciente. */
function ultimosDias(hoy: string, n: number): string[] {
  const fechas: string[] = [];
  const d = new Date(`${hoy}T12:00:00`);
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i += 1) {
    fechas.push(new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(d));
    d.setDate(d.getDate() + 1);
  }
  return fechas;
}

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
      // El aro no puede estar a cero cuando hay cosas en marcha: eso es justo
      // cuando más desmoraliza. Así que además de lo hecho se cuenta lo que se
      // está moviendo, por estados, y el aro lo pinta.
      tareasRevision: sql<number>`(select count(*) from focus_tasks ft join tasks t on t.id = ft.task_id
        where ft.item_id = focus_items.id and t.status = 'in_review')`,
      tareasProgreso: sql<number>`(select count(*) from focus_tasks ft join tasks t on t.id = ft.task_id
        where ft.item_id = focus_items.id and t.status = 'in_progress')`,
      tareasBloqueadas: sql<number>`(select count(*) from focus_tasks ft join tasks t on t.id = ft.task_id
        where ft.item_id = focus_items.id and t.status = 'blocked')`,
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
  const porFecha = new Map<number, Map<string, 'hecho' | 'libre'>>();
  if (conDiario.length) {
    const rows = await db
      .select({ itemId: focusDaily.itemId, doneDate: focusDaily.doneDate, mark: focusDaily.mark })
      .from(focusDaily)
      .where(and(eq(focusDaily.userId, req.userId!), inArray(focusDaily.itemId, conDiario)))
      .orderBy(desc(focusDaily.doneDate));
    for (const r of rows) {
      if (!marcas.has(r.itemId)) marcas.set(r.itemId, []);
      marcas.get(r.itemId)!.push(r.doneDate);
      if (!porFecha.has(r.itemId)) porFecha.set(r.itemId, new Map());
      porFecha.get(r.itemId)!.set(r.doneDate, r.mark);
    }
  }

  // La última semana, para pintarla en la tarjeta. Sale de las marcas que ya
  // están cargadas: ni una consulta más.
  const semana = ultimosDias(hoy, 7);
  const semanaDe = (id: number) => {
    const suyas = porFecha.get(id);
    return semana.map((date) => ({ date, mark: suyas?.get(date) ?? null }));
  };

  const items = delMes.map(
    ({ tareasTotal, tareasHechas, tareasRevision, tareasProgreso, tareasBloqueadas, ...f }) => ({
    ...f,
    tareas: {
      hechas: Number(tareasHechas ?? 0),
      revision: Number(tareasRevision ?? 0),
      progreso: Number(tareasProgreso ?? 0),
      bloqueadas: Number(tareasBloqueadas ?? 0),
      total: Number(tareasTotal ?? 0),
    },
    arrastra: f.status === 'activo' && f.startMonth < mes ? f.startMonth : null,
    racha: f.daily === 1 ? racha(marcas.get(f.id) ?? [], hoy) : 0,
    hoy: f.daily === 1 ? (porFecha.get(f.id)?.get(hoy) ?? null) : null,
    semana: f.daily === 1 ? semanaDe(f.id) : [],
    }),
  );

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

/**
 * GET /plan — la plani: los objetivos colocados en el tiempo.
 *
 * Macro contesta «qué tengo entre manos ESTE mes». Esto contesta otra cosa
 * distinta: **cuándo sale cada cosa**, que es lo que no se puede ver mes a mes
 * cuando tienes proyectos que llegan hasta enero.
 *
 * Se devuelve todo lo vivo con sus fechas y lo que le queda por hacer, sin
 * filtrar por mes: el recorte lo hace la pantalla, que es la que sabe cuántas
 * columnas caben. Los que no tienen fecha vienen igual, marcados: un objetivo
 * sin colocar no se esconde, se enseña para que lo coloques.
 */
focusModule.get('/plan', ah(async (req: AuthedRequest, res) => {
  const filas = await db
    .select({
      id: focusItems.id,
      title: focusItems.title,
      scope: focusItems.scope,
      status: focusItems.status,
      startMonth: focusItems.startMonth,
      startsOn: focusItems.startsOn,
      dueOn: focusItems.dueOn,
      doneAt: focusItems.doneAt,
      sortOrder: focusItems.sortOrder,
      total: sql<number>`(select count(*) from focus_tasks ft where ft.item_id = focus_items.id)`,
      hechas: sql<number>`(select count(*) from focus_tasks ft join tasks t on t.id = ft.task_id
        where ft.item_id = focus_items.id and t.status in ('completed','cancelled'))`,
      enMarcha: sql<number>`(select count(*) from focus_tasks ft join tasks t on t.id = ft.task_id
        where ft.item_id = focus_items.id and t.status in ('in_progress','in_review'))`,
      bloqueadas: sql<number>`(select count(*) from focus_tasks ft join tasks t on t.id = ft.task_id
        where ft.item_id = focus_items.id and t.status = 'blocked')`,
    })
    .from(focusItems)
    .where(
      and(
        eq(focusItems.userId, req.userId!),
        eq(focusItems.kind, 'melon'),
        isNull(focusItems.archivedAt),
        notInArray(focusItems.status, ['aparcado']),
      ),
    )
    .orderBy(asc(focusItems.dueOn), asc(focusItems.startMonth), asc(focusItems.sortOrder));

  res.json({
    hoy: hoyMadrid(),
    items: filas.map((f) => {
      const total = Number(f.total ?? 0);
      const hechas = Number(f.hechas ?? 0);
      return {
        ...f,
        total,
        hechas,
        enMarcha: Number(f.enMarcha ?? 0),
        bloqueadas: Number(f.bloqueadas ?? 0),
        // lo que queda: es el dato que quiere ver sin entrar
        pendientes: Math.max(0, total - hechas),
      };
    }),
  });
}));

// ---------- Crear, editar, archivar ----------

const crearInput = z.object({
  kind: z.enum(KINDS),
  scope: z.enum(SCOPES).default('trabajo'),
  title: z.string().trim().min(1).max(200),
  daily: z.boolean().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

focusModule.post('/', ah(async (req: AuthedRequest, res) => {
  const parsed = crearInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { kind, scope, title, daily, month, startsOn, dueOn } = parsed.data;

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
    // El mes sale de la fecha de entrega si viene: crear «Redes» para mediados
    // de septiembre no debe meterlo en el mes en curso.
    startMonth: month ?? mesDe(startsOn ?? dueOn ?? hoyMadrid()),
    startsOn: startsOn ?? null,
    dueOn: dueOn ?? null,
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
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  startMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
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
  // Si se dice cuándo arranca, el mes va detrás: un objetivo que empieza en
  // septiembre es de septiembre. Mover solo la ENTREGA no lo cambia de mes —uno
  // que arrancó en agosto y se entrega en septiembre sigue siendo de agosto—.
  if (parsed.data.startsOn && !parsed.data.startMonth) cambios.startMonth = mesDe(parsed.data.startsOn);

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
  const [tareas, dias, suyos] = await Promise.all([
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
        // lo que le falta para ser una tarea completa y poder pintarse con la
        // misma tabla que la Agenda, con su badge de aplazamientos incluido
        sortOrder: tasks.sortOrder,
        postponedCount: tasks.postponedCount,
        lastPostponedAt: tasks.lastPostponedAt,
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
    // De dónde salen sus tareas. Con su cuenta de tareas del objetivo, para
    // saber de un vistazo qué proyecto está tirando del carro.
    db
      .select({
        id: projects.id,
        name: projects.name,
        spaceId: spaces.id,
        spaceName: spaces.name,
        spaceColor: spaces.color,
        status: projects.status,
      })
      .from(focusProjects)
      .innerJoin(projects, eq(projects.id, focusProjects.projectId))
      .innerJoin(spaces, eq(spaces.id, projects.spaceId))
      .where(and(eq(focusProjects.itemId, id), eq(focusProjects.userId, req.userId!)))
      .orderBy(asc(spaces.name), asc(projects.name)),
  ]);

  res.json({
    ...item,
    tasks: tareas,
    projects: suyos,
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
/**
 * POST /:id/projects — de aquí también salen tareas de este objetivo.
 *
 * Vincular un proyecto NO arrastra sus tareas: solo dice dónde buscarlas y
 * dónde crear la siguiente. Meter todas sería confundir «el proyecto entero es
 * el objetivo» con «este objetivo se nutre de este proyecto», que casi nunca es
 * lo mismo.
 */
focusModule.post('/:id(\\d+)/projects', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ projectId: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Falta el proyecto' });

  const [suyo] = await db
    .select({ id: focusItems.id })
    .from(focusItems)
    .where(and(eq(focusItems.id, id), eq(focusItems.userId, req.userId!)));
  if (!suyo) return res.status(404).json({ error: 'No encontrado' });

  const [proyecto] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, parsed.data.projectId), eq(projects.userId, req.userId!)));
  if (!proyecto) return res.status(404).json({ error: 'Ese proyecto no existe' });

  await db
    .insert(focusProjects)
    .values({ userId: req.userId!, itemId: id, projectId: parsed.data.projectId })
    .onDuplicateKeyUpdate({ set: { itemId: id } });
  res.status(201).json({ ok: true });
}));

/**
 * DELETE /:id/projects/:projectId — quitar el proyecto del objetivo.
 *
 * Las tareas que ya estaban colgadas se quedan: se eligieron una a una y
 * borrarlas por arrastre sería perder trabajo suyo sin pedirlo.
 */
focusModule.delete('/:id(\\d+)/projects/:projectId(\\d+)', ah(async (req: AuthedRequest, res) => {
  const [r] = await db
    .delete(focusProjects)
    .where(
      and(
        eq(focusProjects.itemId, Number(req.params.id)),
        eq(focusProjects.projectId, Number(req.params.projectId)),
        eq(focusProjects.userId, req.userId!),
      ),
    );
  if (!r.affectedRows) return res.status(404).json({ error: 'No estaba vinculado' });
  res.json({ deleted: true });
}));

focusModule.get('/:id(\\d+)/candidatas', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  const spaceId = Number(req.query.spaceId);
  const projectId = Number(req.query.projectId);

  const yaPuestas = await db.select({ taskId: focusTasks.taskId }).from(focusTasks).where(eq(focusTasks.itemId, id));
  const excluir = new Set(yaPuestas.map((x) => x.taskId));

  // Si el objetivo tiene proyectos declarados, se busca SOLO en ellos: es la
  // razón de declararlos. Si no tiene ninguno todavía, se busca en todo, que es
  // como funcionaba antes y sigue siendo útil el primer día.
  const suyos = await db
    .select({ projectId: focusProjects.projectId })
    .from(focusProjects)
    .where(and(eq(focusProjects.itemId, id), eq(focusProjects.userId, req.userId!)));
  const soloSuyos = suyos.map((p) => p.projectId);

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
        soloSuyos.length ? inArray(tasks.projectId, soloSuyos) : sql`1 = 1`,
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
