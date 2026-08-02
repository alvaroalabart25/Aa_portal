import { Router } from 'express';
import express from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { and, asc, eq, getTableColumns, isNull, max, sql } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import {
  dreamCategories,
  dreamImageData,
  dreamImages,
  dreamLinks,
  dreamSteps,
  dreams,
  wishlistItems,
} from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';
import { PLANTILLAS, plantilla } from './plantillas';

/**
 * Módulo Sueños. Tres tableros que comparten categorías:
 *  - macro: sueños de vida.
 *  - micro: concretos y alcanzables; pueden colgar de un macro o ir sueltos.
 *  - lista de deseos: cosas que solo te separa el dinero.
 *
 * La frontera entre un microsueño y un deseo es difusa a propósito, así que hay
 * conversión en los dos sentidos: equivocarse no debe costar nada.
 */
export const dreamsModule = Router();

// Las imágenes van en un router aparte y SIN login: una etiqueta <img> no puede
// mandar la cabecera de autorización. Se protegen con una firma en la dirección
// (ver `firmaImagen`), y así además el navegador puede cachearlas para siempre.
export const dreamImagesRouter = Router();

const ESTADOS = ['sonando', 'en_marcha', 'cumplido', 'aparcado'] as const;

// Hoy en Europa/Madrid (el server corre en UTC en Render)
function hoyMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', dateStyle: 'short' }).format(new Date());
}

// ---------- Imágenes: direcciones firmadas ----------

/**
 * Firma de una imagen. No caduca a propósito: si caducara, el navegador no
 * podría cachearla y cada visita volvería a pedir los bytes. Lo que protege es
 * que sin el secreto del servidor la dirección no se puede fabricar, y solo
 * aparece dentro de respuestas que ya exigen tu sesión.
 */
function firmaImagen(id: number, size: 'thumb' | 'full'): string {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET as string)
    .update(`dream-img:${id}:${size}`)
    .digest('hex')
    .slice(0, 32);
}

function urlImagen(id: number, size: 'thumb' | 'full'): string {
  return `/api/dreams/img/${id}/${size}?t=${firmaImagen(id, size)}`;
}

dreamImagesRouter.get('/img/:id/:size', ah(async (req, res) => {
  const id = Number(req.params.id);
  const size = req.params.size === 'full' ? 'full' : 'thumb';
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Imagen inválida' });

  const firmaEsperada = firmaImagen(id, size);
  const recibida = String(req.query.t ?? '');
  // comparación en tiempo constante: no filtrar cuánto acierta un intento
  const ok =
    recibida.length === firmaEsperada.length &&
    crypto.timingSafeEqual(Buffer.from(recibida), Buffer.from(firmaEsperada));
  if (!ok) return res.status(403).json({ error: 'Firma inválida' });

  const [ficha] = await db.select({ mime: dreamImages.mime }).from(dreamImages).where(eq(dreamImages.id, id));
  if (!ficha) return res.status(404).json({ error: 'Imagen no encontrada' });

  const [datos] = await db
    .select(size === 'full' ? { bytes: dreamImageData.full } : { bytes: dreamImageData.thumb })
    .from(dreamImageData)
    .where(eq(dreamImageData.imageId, id));
  if (!datos) return res.status(404).json({ error: 'Imagen no encontrada' });

  res.setHeader('Content-Type', ficha.mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  // el front vive en otro dominio que la API: sin esto el navegador no la pinta
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(datos.bytes);
}));

// ---------- Categorías (compartidas por los tres tableros) ----------

dreamsModule.get('/categories', ah(async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(dreamCategories)
    .where(and(eq(dreamCategories.userId, req.userId!), isNull(dreamCategories.archivedAt)))
    .orderBy(asc(dreamCategories.sortOrder), asc(dreamCategories.id));
  res.json(rows);
}));

const categoriaInput = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0a0a0a'),
});

dreamsModule.post('/categories', ah(async (req: AuthedRequest, res) => {
  const parsed = categoriaInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [{ n }] = await db
    .select({ n: max(dreamCategories.sortOrder) })
    .from(dreamCategories)
    .where(eq(dreamCategories.userId, req.userId!));
  const [result] = await db.insert(dreamCategories).values({
    userId: req.userId!,
    name: parsed.data.name,
    color: parsed.data.color,
    sortOrder: (n ?? 0) + 1,
  });
  const [row] = await db.select().from(dreamCategories).where(eq(dreamCategories.id, result.insertId));
  res.status(201).json(row);
}));

dreamsModule.patch('/categories/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = categoriaInput.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [result] = await db
    .update(dreamCategories)
    .set(parsed.data)
    .where(and(eq(dreamCategories.id, id), eq(dreamCategories.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
  const [row] = await db.select().from(dreamCategories).where(eq(dreamCategories.id, id));
  res.json(row);
}));

// Archiva la categoría y desasigna lo que la usaba (así nada apunta a un
// nombre que ya no existe)
dreamsModule.delete('/categories/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .update(dreamCategories)
    .set({ archivedAt: new Date() })
    .where(and(eq(dreamCategories.id, id), eq(dreamCategories.userId, req.userId!), isNull(dreamCategories.archivedAt)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
  await db.update(dreams).set({ categoryId: null }).where(and(eq(dreams.userId, req.userId!), eq(dreams.categoryId, id)));
  await db
    .update(wishlistItems)
    .set({ categoryId: null })
    .where(and(eq(wishlistItems.userId, req.userId!), eq(wishlistItems.categoryId, id)));
  res.json({ archived: true });
}));

// ---------- Plantillas ----------

dreamsModule.get('/templates', (_req, res) => {
  res.json(PLANTILLAS.map((p) => ({ id: p.id, title: p.title, emoji: p.emoji, steps: p.steps.length })));
});

// ---------- Sueños ----------

/**
 * GET /?kind=macro|micro -> tarjetas del tablero, ordenadas por prioridad.
 *
 * UNA sola consulta. Antes eran cinco seguidas y con la base en Oregón cada
 * ida y vuelta cuesta ~165 ms desde España, así que el listado tardaba más de
 * 800 ms en puro viaje. Los recuentos van como subconsultas: las tablas son
 * diminutas y salen gratis comparado con otro salto de red.
 */
dreamsModule.get('/', ah(async (req: AuthedRequest, res) => {
  const kind = req.query.kind === 'macro' ? 'macro' : 'micro';

  // OJO con las subconsultas: la columna de la tabla de fuera va escrita a mano
  // como `dreams.id`, NO interpolada. Drizzle la interpolaría sin cualificar
  // (`id`) y entonces la captura la tabla de dentro —que también tiene `id`—
  // convirtiendo la condición en `s.dream_id = s.id`: siempre cero, sin error.
  const filas = await db
    .select({
      ...getTableColumns(dreams),
      parentTitle: sql<string | null>`(select p.title from dreams p where p.id = dreams.parent_id)`,
      // portada = la primera imagen por orden; solo su id, nunca los bytes
      coverImageId: sql<
        number | null
      >`(select i.id from dream_images i where i.dream_id = dreams.id order by i.sort_order, i.id limit 1)`,
      stepsTotal: sql<number>`(select count(*) from dream_steps s where s.dream_id = dreams.id)`,
      stepsDone: sql<number>`(select count(*) from dream_steps s where s.dream_id = dreams.id and s.done = 1)`,
      microsTotal: sql<number>`(select count(*) from dreams m where m.parent_id = dreams.id and m.archived_at is null)`,
      microsDone: sql<number>`(select count(*) from dreams m where m.parent_id = dreams.id and m.archived_at is null and m.status = 'cumplido')`,
    })
    .from(dreams)
    .where(and(eq(dreams.userId, req.userId!), eq(dreams.kind, kind), isNull(dreams.archivedAt)))
    .orderBy(asc(dreams.sortOrder), asc(dreams.id));

  res.json(
    filas.map(({ coverImageId, stepsTotal, stepsDone, microsTotal, microsDone, ...d }) => ({
      ...d,
      coverUrl: coverImageId ? urlImagen(Number(coverImageId), 'thumb') : null,
      steps: { done: Number(stepsDone ?? 0), total: Number(stepsTotal ?? 0) },
      micros: kind === 'macro' ? { done: Number(microsDone ?? 0), total: Number(microsTotal ?? 0) } : null,
    })),
  );
}));

const suenoInput = z.object({
  kind: z.enum(['macro', 'micro']),
  title: z.string().trim().min(1).max(200),
  template: z.string().trim().max(40).optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  parentId: z.number().int().positive().nullable().optional(),
});

// POST / -> sueño nuevo, al principio de la lista (lo recién soñado manda)
dreamsModule.post('/', ah(async (req: AuthedRequest, res) => {
  const parsed = suenoInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { kind, title, template, categoryId, parentId } = parsed.data;

  const plt = template ? plantilla(template) : undefined;
  if (template && !plt) return res.status(400).json({ error: 'Esa plantilla no existe' });
  if (parentId != null) {
    const [padre] = await db
      .select({ id: dreams.id })
      .from(dreams)
      .where(and(eq(dreams.id, parentId), eq(dreams.userId, req.userId!), eq(dreams.kind, 'macro')));
    if (!padre) return res.status(400).json({ error: 'La macrometa indicada no existe' });
  }

  const [{ n }] = await db
    .select({ n: sql<number>`min(sort_order)` })
    .from(dreams)
    .where(and(eq(dreams.userId, req.userId!), eq(dreams.kind, kind)));

  const [result] = await db.insert(dreams).values({
    userId: req.userId!,
    kind,
    title,
    description: plt?.description || null,
    categoryId: categoryId ?? null,
    parentId: kind === 'micro' ? (parentId ?? null) : null,
    sortOrder: Number(n ?? 0) - 1,
  });
  const nuevoId = result.insertId;

  if (plt?.steps.length) {
    await db.insert(dreamSteps).values(
      plt.steps.map((s, i) => ({ userId: req.userId!, dreamId: nuevoId, title: s, sortOrder: i })),
    );
  }

  const [row] = await db.select().from(dreams).where(eq(dreams.id, nuevoId));
  res.status(201).json(row);
}));

// Las rutas de un sueño concreto exigen un id numérico. Así `/wishlist` o
// `/templates` nunca se confunden con un id y el orden de declaración en este
// fichero puede seguir la narrativa del módulo.
// GET /:id -> la ficha completa
dreamsModule.get('/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [sueno] = await db
    .select()
    .from(dreams)
    .where(and(eq(dreams.id, id), eq(dreams.userId, req.userId!), isNull(dreams.archivedAt)));
  if (!sueno) return res.status(404).json({ error: 'Meta no encontrada' });

  // Todo lo demás en paralelo: son consultas independientes y cada ida y vuelta
  // a la base cuesta lo mismo, así que en serie se pagaría cuatro veces.
  const [pasos, enlaces, imagenes, hijos, macros] = await Promise.all([
    db.select().from(dreamSteps).where(eq(dreamSteps.dreamId, id)).orderBy(asc(dreamSteps.sortOrder), asc(dreamSteps.id)),
    db.select().from(dreamLinks).where(eq(dreamLinks.dreamId, id)).orderBy(asc(dreamLinks.sortOrder), asc(dreamLinks.id)),
    db
      .select({ id: dreamImages.id, mime: dreamImages.mime, sortOrder: dreamImages.sortOrder })
      .from(dreamImages)
      .where(eq(dreamImages.dreamId, id))
      .orderBy(asc(dreamImages.sortOrder), asc(dreamImages.id)),
    // un macro enseña sus micros
    sueno.kind === 'macro'
      ? db
          .select({ id: dreams.id, title: dreams.title, status: dreams.status, targetDate: dreams.targetDate })
          .from(dreams)
          .where(and(eq(dreams.userId, req.userId!), eq(dreams.parentId, id), isNull(dreams.archivedAt)))
          .orderBy(asc(dreams.sortOrder), asc(dreams.id))
      : Promise.resolve([]),
    // un micro necesita la lista de macros para el selector de «cuelga de»
    sueno.kind === 'micro'
      ? db
          .select({ id: dreams.id, title: dreams.title })
          .from(dreams)
          .where(and(eq(dreams.userId, req.userId!), eq(dreams.kind, 'macro'), isNull(dreams.archivedAt)))
          .orderBy(asc(dreams.sortOrder), asc(dreams.id))
      : Promise.resolve([]),
  ]);

  res.json({
    ...sueno,
    steps: pasos,
    links: enlaces,
    images: imagenes.map((i) => ({ ...i, thumbUrl: urlImagen(i.id, 'thumb'), fullUrl: urlImagen(i.id, 'full') })),
    children: hijos,
    macros, // para el selector de «cuelga de»
  });
}));

/**
 * Importe opcional. Distingue tres casos que NO son lo mismo:
 *   ausente  -> undefined (no tocar el valor guardado)
 *   null o '' -> null     (borrar el importe)
 *   número   -> '1234.50'
 * Confundir el primero con el segundo hacía que un PATCH de solo el título
 * borrase el coste.
 */
const dinero = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El importe no es válido' });
      return z.NEVER;
    }
    return n.toFixed(2);
  });

const editarInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20000).nullable().optional(),
  status: z.enum(ESTADOS).optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  parentId: z.number().int().positive().nullable().optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  costEstimated: dinero,
  costSaved: dinero,
});

dreamsModule.patch('/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = editarInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const [actual] = await db
    .select()
    .from(dreams)
    .where(and(eq(dreams.id, id), eq(dreams.userId, req.userId!)));
  if (!actual) return res.status(404).json({ error: 'Meta no encontrada' });

  const cambios: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) cambios[k] = v;

  // Un sueño no puede colgar de sí mismo, y un macro no cuelga de nadie
  if ('parentId' in cambios) {
    if (actual.kind === 'macro') cambios.parentId = null;
    else if (cambios.parentId === id) return res.status(400).json({ error: 'Una meta no puede colgar de sí misma' });
  }

  // Cumplirlo pone la fecha sola; dejar de cumplirlo la quita
  if (parsed.data.status === 'cumplido' && actual.status !== 'cumplido') {
    cambios.achievedAt = actual.achievedAt ?? hoyMadrid();
  } else if (parsed.data.status && parsed.data.status !== 'cumplido' && actual.status === 'cumplido') {
    cambios.achievedAt = null;
  }

  if (Object.keys(cambios).length) {
    await db.update(dreams).set(cambios).where(and(eq(dreams.id, id), eq(dreams.userId, req.userId!)));
  }
  const [row] = await db.select().from(dreams).where(eq(dreams.id, id));
  res.json(row);
}));

// DELETE /:id -> lo archiva. Si era un macro, sus micros quedan sueltos en vez
// de apuntar a un padre invisible.
dreamsModule.delete('/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .update(dreams)
    .set({ archivedAt: new Date() })
    .where(and(eq(dreams.id, id), eq(dreams.userId, req.userId!), isNull(dreams.archivedAt)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Meta no encontrada' });
  await db.update(dreams).set({ parentId: null }).where(and(eq(dreams.userId, req.userId!), eq(dreams.parentId, id)));
  res.json({ archived: true });
}));

// POST /reorder { ids } -> la prioridad es el orden en que llegan
dreamsModule.post('/reorder', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ ids: z.array(z.number().int().positive()).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  await Promise.all(
    parsed.data.ids.map((id, i) =>
      db.update(dreams).set({ sortOrder: i }).where(and(eq(dreams.id, id), eq(dreams.userId, req.userId!))),
    ),
  );
  res.json({ ok: true });
}));

// ---------- Pasos ----------

async function suenoPropio(userId: number, dreamId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: dreams.id })
    .from(dreams)
    .where(and(eq(dreams.id, dreamId), eq(dreams.userId, userId)));
  return Boolean(row);
}

dreamsModule.post('/:id(\\d+)/steps', ah(async (req: AuthedRequest, res) => {
  const dreamId = Number(req.params.id);
  const parsed = z.object({ title: z.string().trim().min(1).max(255) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (!(await suenoPropio(req.userId!, dreamId))) return res.status(404).json({ error: 'Meta no encontrada' });

  const [{ n }] = await db
    .select({ n: max(dreamSteps.sortOrder) })
    .from(dreamSteps)
    .where(eq(dreamSteps.dreamId, dreamId));
  const [result] = await db.insert(dreamSteps).values({
    userId: req.userId!,
    dreamId,
    title: parsed.data.title,
    sortOrder: (n ?? 0) + 1,
  });
  const [row] = await db.select().from(dreamSteps).where(eq(dreamSteps.id, result.insertId));
  res.status(201).json(row);
}));

dreamsModule.patch('/steps/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z
    .object({ title: z.string().trim().min(1).max(255).optional(), done: z.boolean().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const cambios: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) cambios.title = parsed.data.title;
  if (parsed.data.done !== undefined) {
    cambios.done = parsed.data.done ? 1 : 0;
    cambios.doneAt = parsed.data.done ? new Date() : null;
  }
  const [result] = await db
    .update(dreamSteps)
    .set(cambios)
    .where(and(eq(dreamSteps.id, id), eq(dreamSteps.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Paso no encontrado' });
  const [row] = await db.select().from(dreamSteps).where(eq(dreamSteps.id, id));
  res.json(row);
}));

dreamsModule.delete('/steps/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .delete(dreamSteps)
    .where(and(eq(dreamSteps.id, id), eq(dreamSteps.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Paso no encontrado' });
  res.json({ deleted: true });
}));

// ---------- Enlaces ----------

// Solo http(s): una dirección `javascript:` guardada aquí sería un agujero al
// pintarla como enlace.
const enlaceUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u), 'El enlace debe empezar por http:// o https://');

dreamsModule.post('/:id(\\d+)/links', ah(async (req: AuthedRequest, res) => {
  const dreamId = Number(req.params.id);
  const parsed = z
    .object({
      label: z.string().trim().min(1).max(120),
      url: enlaceUrl,
      note: z.string().trim().max(300).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (!(await suenoPropio(req.userId!, dreamId))) return res.status(404).json({ error: 'Meta no encontrada' });

  const [{ n }] = await db
    .select({ n: max(dreamLinks.sortOrder) })
    .from(dreamLinks)
    .where(eq(dreamLinks.dreamId, dreamId));
  const [result] = await db.insert(dreamLinks).values({
    userId: req.userId!,
    dreamId,
    label: parsed.data.label,
    url: parsed.data.url,
    note: parsed.data.note || null,
    sortOrder: (n ?? 0) + 1,
  });
  const [row] = await db.select().from(dreamLinks).where(eq(dreamLinks.id, result.insertId));
  res.status(201).json(row);
}));

dreamsModule.delete('/links/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .delete(dreamLinks)
    .where(and(eq(dreamLinks.id, id), eq(dreamLinks.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Enlace no encontrado' });
  res.json({ deleted: true });
}));

// ---------- Imágenes ----------

// El navegador manda las dos versiones ya reducidas en base64. Este cuerpo es
// más grande que el resto de la API, por eso lleva su propio analizador.
const subirImagen = z.object({
  mime: z.enum(['image/webp', 'image/jpeg', 'image/png']).default('image/webp'),
  thumb: z.string().min(1),
  full: z.string().min(1),
});
const LIMITE_IMAGEN = 1_500_000; // bytes por versión, ya reducida

dreamsModule.post('/:id(\\d+)/images', express.json({ limit: '4mb' }), ah(async (req: AuthedRequest, res) => {
  const dreamId = Number(req.params.id);
  const parsed = subirImagen.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (!(await suenoPropio(req.userId!, dreamId))) return res.status(404).json({ error: 'Meta no encontrada' });

  const thumb = Buffer.from(parsed.data.thumb, 'base64');
  const full = Buffer.from(parsed.data.full, 'base64');
  if (!thumb.length || !full.length) return res.status(400).json({ error: 'La imagen llegó vacía' });
  if (thumb.length > LIMITE_IMAGEN || full.length > LIMITE_IMAGEN) {
    return res.status(413).json({ error: 'La imagen es demasiado grande' });
  }

  const [{ n }] = await db
    .select({ n: max(dreamImages.sortOrder) })
    .from(dreamImages)
    .where(eq(dreamImages.dreamId, dreamId));

  const [result] = await db.insert(dreamImages).values({
    userId: req.userId!,
    dreamId,
    mime: parsed.data.mime,
    bytes: full.length,
    sortOrder: (n ?? 0) + 1,
  });
  const id = result.insertId;
  await db.insert(dreamImageData).values({ imageId: id, thumb, full });

  res.status(201).json({
    id,
    mime: parsed.data.mime,
    sortOrder: (n ?? 0) + 1,
    thumbUrl: urlImagen(id, 'thumb'),
    fullUrl: urlImagen(id, 'full'),
  });
}));

// La destacada es la primera por orden: hacerla destacada = ponerla delante
dreamsModule.post('/images/:id/cover', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [img] = await db
    .select({ dreamId: dreamImages.dreamId })
    .from(dreamImages)
    .where(and(eq(dreamImages.id, id), eq(dreamImages.userId, req.userId!)));
  if (!img) return res.status(404).json({ error: 'Imagen no encontrada' });

  const [{ n }] = await db
    .select({ n: sql<number>`min(sort_order)` })
    .from(dreamImages)
    .where(eq(dreamImages.dreamId, img.dreamId));
  await db.update(dreamImages).set({ sortOrder: Number(n ?? 0) - 1 }).where(eq(dreamImages.id, id));
  res.json({ ok: true });
}));

dreamsModule.delete('/images/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .delete(dreamImages)
    .where(and(eq(dreamImages.id, id), eq(dreamImages.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Imagen no encontrada' });
  await db.delete(dreamImageData).where(eq(dreamImageData.imageId, id));
  res.json({ deleted: true });
}));

// ---------- Lista de deseos ----------

dreamsModule.get('/wishlist', ah(async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(wishlistItems)
    .where(and(eq(wishlistItems.userId, req.userId!), isNull(wishlistItems.archivedAt)))
    .orderBy(asc(wishlistItems.sortOrder), asc(wishlistItems.id));

  const pendientes = rows.filter((r) => !r.boughtAt);
  const comprados = rows
    .filter((r) => r.boughtAt)
    .sort((a, b) => String(b.boughtAt).localeCompare(String(a.boughtAt)));
  const total = pendientes.reduce((s, r) => s + Number(r.price ?? 0), 0);
  res.json({ pending: pendientes, bought: comprados, total: total.toFixed(2) });
}));

const deseoInput = z.object({
  title: z.string().trim().min(1).max(200),
  price: dinero,
  url: enlaceUrl.nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
});

dreamsModule.post('/wishlist', ah(async (req: AuthedRequest, res) => {
  const parsed = deseoInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [{ n }] = await db
    .select({ n: max(wishlistItems.sortOrder) })
    .from(wishlistItems)
    .where(eq(wishlistItems.userId, req.userId!));
  const [result] = await db.insert(wishlistItems).values({
    userId: req.userId!,
    title: parsed.data.title,
    price: parsed.data.price ?? null,
    url: parsed.data.url ?? null,
    categoryId: parsed.data.categoryId ?? null,
    sortOrder: (n ?? 0) + 1,
  });
  const [row] = await db.select().from(wishlistItems).where(eq(wishlistItems.id, result.insertId));
  res.status(201).json(row);
}));

dreamsModule.patch('/wishlist/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = deseoInput.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const cambios: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) cambios[k] = v;
  if (!Object.keys(cambios).length) return res.status(400).json({ error: 'Nada que cambiar' });
  const [result] = await db
    .update(wishlistItems)
    .set(cambios)
    .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Deseo no encontrado' });
  const [row] = await db.select().from(wishlistItems).where(eq(wishlistItems.id, id));
  res.json(row);
}));

dreamsModule.post('/wishlist/:id/bought', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ bought: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [result] = await db
    .update(wishlistItems)
    .set({ boughtAt: parsed.data.bought ? hoyMadrid() : null })
    .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Deseo no encontrado' });
  const [row] = await db.select().from(wishlistItems).where(eq(wishlistItems.id, id));
  res.json(row);
}));

dreamsModule.delete('/wishlist/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .update(wishlistItems)
    .set({ archivedAt: new Date() })
    .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, req.userId!), isNull(wishlistItems.archivedAt)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Deseo no encontrado' });
  res.json({ archived: true });
}));

dreamsModule.post('/wishlist/reorder', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ ids: z.array(z.number().int().positive()).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  await Promise.all(
    parsed.data.ids.map((id, i) =>
      db
        .update(wishlistItems)
        .set({ sortOrder: i })
        .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, req.userId!))),
    ),
  );
  res.json({ ok: true });
}));

// ---------- Conversiones entre deseo y microsueño ----------
// La frontera es difusa, así que se puede cruzar en los dos sentidos sin perder
// lo escrito. Lo convertido se archiva, no se borra.

dreamsModule.post('/wishlist/:id/to-dream', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [deseo] = await db
    .select()
    .from(wishlistItems)
    .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, req.userId!), isNull(wishlistItems.archivedAt)));
  if (!deseo) return res.status(404).json({ error: 'Deseo no encontrado' });

  const [{ n }] = await db
    .select({ n: sql<number>`min(sort_order)` })
    .from(dreams)
    .where(and(eq(dreams.userId, req.userId!), eq(dreams.kind, 'micro')));

  const [result] = await db.insert(dreams).values({
    userId: req.userId!,
    kind: 'micro',
    title: deseo.title,
    categoryId: deseo.categoryId,
    costEstimated: deseo.price,
    sortOrder: Number(n ?? 0) - 1,
  });
  if (deseo.url) {
    await db.insert(dreamLinks).values({
      userId: req.userId!,
      dreamId: result.insertId,
      label: 'Referencia',
      url: deseo.url,
      sortOrder: 0,
    });
  }
  await db.update(wishlistItems).set({ archivedAt: new Date() }).where(eq(wishlistItems.id, id));
  res.status(201).json({ dreamId: result.insertId });
}));

dreamsModule.post('/:id(\\d+)/to-wishlist', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [sueno] = await db
    .select()
    .from(dreams)
    .where(and(eq(dreams.id, id), eq(dreams.userId, req.userId!), isNull(dreams.archivedAt)));
  if (!sueno) return res.status(404).json({ error: 'Meta no encontrada' });

  const [enlace] = await db
    .select({ url: dreamLinks.url })
    .from(dreamLinks)
    .where(eq(dreamLinks.dreamId, id))
    .orderBy(asc(dreamLinks.sortOrder))
    .limit(1);

  const [{ n }] = await db
    .select({ n: max(wishlistItems.sortOrder) })
    .from(wishlistItems)
    .where(eq(wishlistItems.userId, req.userId!));

  const [result] = await db.insert(wishlistItems).values({
    userId: req.userId!,
    title: sueno.title,
    price: sueno.costEstimated,
    url: enlace?.url ?? null,
    categoryId: sueno.categoryId,
    sortOrder: (n ?? 0) + 1,
  });
  await db.update(dreams).set({ archivedAt: new Date() }).where(eq(dreams.id, id));
  await db.update(dreams).set({ parentId: null }).where(and(eq(dreams.userId, req.userId!), eq(dreams.parentId, id)));
  res.status(201).json({ wishlistId: result.insertId });
}));
