import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { personaEntries } from '../../db/schema';
import { opcionesDeLlave, verificarLlaveDe } from '../../core/auth/passkeys';
import type { AuthedRequest } from '../../core/auth/middleware';
import { preguntaDe } from './preguntas';

/**
 * Persona: conocerse escribiendo.
 *
 * Un diario con la mecánica del bloc —un día con algo escrito es una fila, un
 * día en blanco no existe— y una pregunta delante para los días en los que no
 * sabes por dónde empezar.
 *
 * Lo que lo hace distinto es quién puede leerlo. Tener la sesión abierta NO
 * basta: cada entrada aquí exige un PASE que solo se consigue volviendo a pasar
 * Face ID. El pase dura poco, vive en la memoria de la pestaña y no se guarda
 * en ningún sitio: al recargar, la puerta vuelve a estar cerrada.
 *
 * La comprobación es de servidor a propósito. Un candado solo de pantalla se
 * salta llamando a la API con la sesión de siempre, así que no es un candado:
 * es un cartel.
 */
export const personaModule = Router();

const MINUTOS_DE_PASE = 20;
const ES_DIA = /^\d{4}-\d{2}-\d{2}$/;
const ES_MES = /^\d{4}-\d{2}$/;

const hoyMadrid = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', dateStyle: 'short' }).format(new Date());

/** El último día de ese mes, para acotar la consulta sin hacer cuentas raras. */
function finDeMes(mes: string): string {
  const [anio, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(anio, m, 0)).toISOString().slice(0, 10);
}

/** Vacío es no tener texto DENTRO de las etiquetas: `<p><br></p>` es vacío. */
const sinEtiquetas = (html: string): string =>
  html.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim();

// ---------------------------------------------------------------- el pase

/** El pase: corto, de este usuario y solo para Persona. */
function firmarPase(userId: number): string {
  return jwt.sign({ sub: String(userId), scope: 'persona' }, process.env.JWT_SECRET as string, {
    algorithm: 'HS256',
    expiresIn: `${MINUTOS_DE_PASE}m`,
  });
}

/**
 * Exige el pase además de la sesión. Sin él no se lee ni se escribe nada de
 * aquí, aunque el token de siempre sea válido.
 */
function requierePase(req: AuthedRequest, res: import('express').Response, next: import('express').NextFunction) {
  const cabecera = req.headers['x-persona'];
  const pase = typeof cabecera === 'string' ? cabecera : '';
  if (!pase) return res.status(423).json({ error: 'Persona está cerrado' });
  try {
    const payload = jwt.verify(pase, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }) as {
      sub?: string;
      scope?: string;
    };
    if (payload.scope !== 'persona' || Number(payload.sub) !== req.userId) {
      return res.status(423).json({ error: 'Persona está cerrado' });
    }
  } catch {
    return res.status(423).json({ error: 'El pase ha caducado' });
  }
  next();
}

/** Las opciones para pedir Face ID. Necesita sesión, pero no pase. */
personaModule.post('/llave/opciones', ah(async (req: AuthedRequest, res) => {
  const r = await opcionesDeLlave(req.userId!);
  if (!r) return res.status(400).json({ error: 'Necesitas una llave de acceso registrada para abrir Persona' });
  res.json(r);
}));

/** La firma. Si es válida, se abre la puerta durante un rato. */
personaModule.post('/llave/abrir', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ flowId: z.string().min(1), response: z.any() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos incompletos' });

  const vale = await verificarLlaveDe(req.userId!, parsed.data.flowId, parsed.data.response);
  if (!vale) return res.status(401).json({ error: 'No se pudo verificar' });

  res.json({ pase: firmarPase(req.userId!), minutos: MINUTOS_DE_PASE });
}));

// ---------------------------------------------------------------- el diario

/** GET /?mes=YYYY-MM — lo escrito ese mes, con la pregunta de hoy. */
personaModule.get('/', requierePase, ah(async (req: AuthedRequest, res) => {
  const hoy = hoyMadrid();
  const mes = typeof req.query.mes === 'string' && ES_MES.test(req.query.mes) ? req.query.mes : hoy.slice(0, 7);

  const filas = await db
    .select({ fecha: personaEntries.entryDate, texto: personaEntries.body, pregunta: personaEntries.prompt })
    .from(personaEntries)
    .where(
      and(
        eq(personaEntries.userId, req.userId!),
        gte(personaEntries.entryDate, `${mes}-01`),
        lte(personaEntries.entryDate, finDeMes(mes)),
      ),
    )
    .orderBy(desc(personaEntries.entryDate));

  res.json({ hoy, mes, pregunta: preguntaDe(hoy), entradas: filas });
}));

/** GET /meses — qué meses tienen algo escrito. El índice de lo anterior. */
personaModule.get('/meses', requierePase, ah(async (req: AuthedRequest, res) => {
  // La columna va escrita a mano: Drizzle la cualifica en el GROUP BY y no en
  // el SELECT, y TiDB rechaza la consulta entera por ONLY_FULL_GROUP_BY.
  const mes = sql<string>`date_format(persona_entries.entry_date, '%Y-%m')`;
  const filas = await db
    .select({ mes, dias: sql<number>`count(*)` })
    .from(personaEntries)
    .where(eq(personaEntries.userId, req.userId!))
    .groupBy(mes)
    .orderBy(desc(mes));

  res.json(filas.map((f) => ({ mes: f.mes, dias: Number(f.dias) })));
}));

/** PUT /:fecha — guardar lo escrito ese día. Vaciarlo lo borra. */
personaModule.put('/:fecha', requierePase, ah(async (req: AuthedRequest, res) => {
  const fecha = String(req.params.fecha);
  if (!ES_DIA.test(fecha)) return res.status(400).json({ error: 'Fecha no válida' });

  const cuerpo = z
    .object({ texto: z.string().max(50000), pregunta: z.string().max(240).nullish() })
    .safeParse(req.body);
  if (!cuerpo.success) return res.status(400).json({ error: 'Texto no válido' });

  const texto = cuerpo.data.texto;
  if (!sinEtiquetas(texto)) {
    await db
      .delete(personaEntries)
      .where(and(eq(personaEntries.userId, req.userId!), eq(personaEntries.entryDate, fecha)));
    return res.json({ fecha, texto: '', borrada: true });
  }

  await db
    .insert(personaEntries)
    .values({ userId: req.userId!, entryDate: fecha, body: texto, prompt: cuerpo.data.pregunta ?? null })
    .onDuplicateKeyUpdate({ set: { body: texto } });
  res.json({ fecha, texto, borrada: false });
}));
