import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { notes, projects, tasks, workNotes } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';

/**
 * El bloc de notas: lo que se apunta a vuelapluma antes de saber qué es.
 *
 * Un día con algo escrito es una fila; un día sin nada no existe. Esa es toda
 * la regla, y de ella salen las dos cosas que pidió: que el título del día
 * aparezca UNA vez por muchas veces que vuelvas, y que el bloc no se llene de
 * días en blanco de los que no escribiste.
 */
export const notasModule = Router();

const hoyMadrid = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', dateStyle: 'short' }).format(new Date());

const ES_DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lo que llega es HTML del editor: «vacío» es no tener texto DENTRO de las
 * etiquetas, no que la cadena esté vacía. Un `<p><br></p>` es una nota vacía, y
 * una nota vacía se borra.
 */
const sinEtiquetas = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
const ES_MES = /^\d{4}-\d{2}$/;

/** El último día de ese mes, para acotar la consulta sin hacer cuentas raras. */
function finDeMes(mes: string): string {
  const [anio, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(anio, m, 0)).toISOString().slice(0, 10);
}

/**
 * GET /?mes=YYYY-MM — las notas de ese mes, de la más reciente a la más vieja.
 *
 * Devuelve también `hoy` para que la pantalla sepa cuál es el día en curso sin
 * fiarse del reloj del móvil, que puede ir en otra zona horaria.
 */
notasModule.get('/', ah(async (req: AuthedRequest, res) => {
  const hoy = hoyMadrid();
  const mes = typeof req.query.mes === 'string' && ES_MES.test(req.query.mes) ? req.query.mes : hoy.slice(0, 7);

  const filas = await db
    .select({ fecha: notes.noteDate, texto: notes.body, actualizado: notes.updatedAt })
    .from(notes)
    .where(
      and(eq(notes.userId, req.userId!), gte(notes.noteDate, `${mes}-01`), lte(notes.noteDate, finDeMes(mes))),
    )
    .orderBy(desc(notes.noteDate));

  res.json({ hoy, mes, notas: filas });
}));

/**
 * GET /meses — qué meses tienen algo escrito, con cuánto.
 *
 * Es el índice de «meses anteriores»: sin esto habría que traerse el bloc
 * entero para saber qué meses existen.
 */
notasModule.get('/meses', ah(async (req: AuthedRequest, res) => {
  // La columna va escrita a mano y no interpolada: Drizzle la cualifica en el
  // GROUP BY (`notes`.`note_date`) y no en el SELECT, y con esa diferencia TiDB
  // rechaza la consulta entera por ONLY_FULL_GROUP_BY.
  const mes = sql<string>`date_format(notes.note_date, '%Y-%m')`;
  const filas = await db
    .select({ mes, dias: sql<number>`count(*)` })
    .from(notes)
    .where(eq(notes.userId, req.userId!))
    .groupBy(mes)
    .orderBy(desc(mes));

  res.json(filas.map((f) => ({ mes: f.mes, dias: Number(f.dias) })));
}));

/**
 * PUT /:fecha — guardar lo escrito ese día.
 *
 * Vaciar la nota la BORRA: una nota vacía no es una nota, y dejarla convertiría
 * el bloc en la lista de días en blanco que no quiere. Es también la forma de
 * deshacer un día que se abrió sin querer.
 */
notasModule.put('/:fecha', ah(async (req: AuthedRequest, res) => {
  const fecha = String(req.params.fecha);
  if (!ES_DIA.test(fecha)) return res.status(400).json({ error: 'Fecha no válida' });

  const cuerpo = z.object({ texto: z.string().max(50000) }).safeParse(req.body);
  if (!cuerpo.success) return res.status(400).json({ error: 'Texto no válido' });

  const texto = cuerpo.data.texto;
  if (!sinEtiquetas(texto)) {
    await db.delete(notes).where(and(eq(notes.userId, req.userId!), eq(notes.noteDate, fecha)));
    return res.json({ fecha, texto: '', borrada: true });
  }

  await db
    .insert(notes)
    .values({ userId: req.userId!, noteDate: fecha, body: texto })
    .onDuplicateKeyUpdate({ set: { body: texto } });
  res.json({ fecha, texto, borrada: false });
}));

/**
 * Las notas de una tarea o de un proyecto, con fecha.
 *
 * Mismo mecanismo que el bloc y por el mismo motivo: una nota suelta dice qué
 * pasa, una fechada dice cómo ha ido. Un apunte por día y por ficha —si vuelves
 * el mismo día sigues el de ese día— y vaciarlo lo borra.
 *
 * Van aquí y no colgando de tareas porque lo que comparten es la MECÁNICA (el
 * día, el vaciar borra, el editor), no el dueño.
 */
const ES_TIPO = { tarea: 'tarea', proyecto: 'proyecto' } as const;
type Tipo = keyof typeof ES_TIPO;

/** ¿Es tuya esa ficha? Sin esto, cualquiera leería las notas de otro con solo
 *  cambiar el número de la dirección. */
async function esSuya(userId: number, tipo: Tipo, id: number): Promise<boolean> {
  if (tipo === 'tarea') {
    const [t] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    return Boolean(t);
  }
  const [p] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return Boolean(p);
}

/** El filtro de una ficha: la columna que toca, y la otra en NULL. */
const deLaFicha = (tipo: Tipo, id: number) =>
  tipo === 'tarea'
    ? and(eq(workNotes.taskId, id), isNull(workNotes.projectId))
    : and(eq(workNotes.projectId, id), isNull(workNotes.taskId));

function pedido(req: AuthedRequest): { tipo: Tipo; id: number } | null {
  const tipo = String(req.params.tipo) as Tipo;
  const id = Number(req.params.id);
  if (!ES_TIPO[tipo] || !Number.isInteger(id) || id <= 0) return null;
  return { tipo, id };
}

/** GET /ficha/:tipo/:id — los apuntes de esa ficha, del más nuevo al más viejo. */
notasModule.get('/ficha/:tipo/:id', ah(async (req: AuthedRequest, res) => {
  const p = pedido(req);
  if (!p) return res.status(400).json({ error: 'Ficha no válida' });
  if (!(await esSuya(req.userId!, p.tipo, p.id))) return res.status(404).json({ error: 'No encontrada' });

  const filas = await db
    .select({ fecha: workNotes.noteDate, texto: workNotes.body, actualizado: workNotes.updatedAt })
    .from(workNotes)
    .where(and(eq(workNotes.userId, req.userId!), deLaFicha(p.tipo, p.id)))
    .orderBy(desc(workNotes.noteDate));

  res.json({ hoy: hoyMadrid(), notas: filas });
}));

/** PUT /ficha/:tipo/:id/:fecha — guardar el apunte de ese día. Vaciarlo lo borra. */
notasModule.put('/ficha/:tipo/:id/:fecha', ah(async (req: AuthedRequest, res) => {
  const p = pedido(req);
  const fecha = String(req.params.fecha);
  if (!p || !ES_DIA.test(fecha)) return res.status(400).json({ error: 'Ficha o fecha no válida' });
  if (!(await esSuya(req.userId!, p.tipo, p.id))) return res.status(404).json({ error: 'No encontrada' });

  const cuerpo = z.object({ texto: z.string().max(50000) }).safeParse(req.body);
  if (!cuerpo.success) return res.status(400).json({ error: 'Texto no válido' });

  const texto = cuerpo.data.texto;
  if (!sinEtiquetas(texto)) {
    await db
      .delete(workNotes)
      .where(and(eq(workNotes.userId, req.userId!), deLaFicha(p.tipo, p.id), eq(workNotes.noteDate, fecha)));
    return res.json({ fecha, texto: '', borrada: true });
  }

  await db
    .insert(workNotes)
    .values({
      userId: req.userId!,
      taskId: p.tipo === 'tarea' ? p.id : null,
      projectId: p.tipo === 'proyecto' ? p.id : null,
      noteDate: fecha,
      body: texto,
    })
    .onDuplicateKeyUpdate({ set: { body: texto } });
  res.json({ fecha, texto, borrada: false });
}));
