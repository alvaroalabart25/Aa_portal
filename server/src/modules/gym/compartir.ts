/**
 * Gimnasio compartido: dos cuentas que se pasan la rutina y se van avisando.
 *
 * LA IDEA, que es lo único que hay que entender para leer el resto:
 * lo que se vincula NO son las rutinas, son los DÍAS. Compartir la rutina
 * entera solo crea varios vínculos de una vez. Si uno borra su «Full body»,
 * ese vínculo muere y de esa sesión ya no llega nada; los demás siguen. El
 * vínculo va por id de día, así que renombrarlo no rompe nada.
 *
 * Y todo se PROPONE, nunca se aplica solo: un cambio del otro llega como
 * sugerencia y se acepta o se descarta.
 *
 * Lo que viaja: QUÉ ejercicio entra o sale, y su zona muscular. Nada más.
 * Ni los kilos ni el objetivo (series × repeticiones) ni las notas técnicas:
 * eso es de cada cuerpo. Saber que el otro hace 4×15 no ayuda a decidir nada;
 * saber que ha metido un ejercicio nuevo, sí.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { gymChanges, gymDayLinks, gymDays, gymExercises, gymPairs, gymShareCodes, users } from '../../db/schema';
import { type AuthedRequest } from '../../core/auth/middleware';
import { sendToUser } from '../push';
import { limpiarPartes, musculosDePartes } from './partes';
import { asegurarIdentidad } from './catalogo';
import { soltarSuperserie, vincularSuperserie } from './superseries';

export const compartirRouter = Router();

const DIAS_VALIDEZ = 7;

function huella(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/** Cómo se le llama al otro por pantalla. Nunca su correo si tiene nombre. */
async function nombreDe(userId: number): Promise<string> {
  const [u] = await db.select({ n: users.displayName, u: users.username }).from(users).where(eq(users.id, userId));
  if (!u) return 'Alguien';
  return u.n || u.u.split('@')[0];
}

/** Las parejas vivas de esta cuenta, con el id del otro. */
async function parejasDe(userId: number) {
  const filas = await db
    .select()
    .from(gymPairs)
    .where(and(isNull(gymPairs.revokedAt), or(eq(gymPairs.userA, userId), eq(gymPairs.userB, userId))));
  return filas.map((p) => ({ pair: p, otro: p.userA === userId ? p.userB : p.userA }));
}

/**
 * Los vínculos vivos de un día, con a quién apuntan.
 *
 * Se resuelve aquí y no en cada sitio porque un vínculo es simétrico: el mismo
 * registro sirve para «mi día 3 → su día 7» y para el revés, y equivocarse de
 * lado manda el aviso a quien hizo el cambio.
 */
async function vinculosDeDia(dayId: number) {
  const filas = await db
    .select({ link: gymDayLinks, pair: gymPairs })
    .from(gymDayLinks)
    .innerJoin(gymPairs, eq(gymDayLinks.pairId, gymPairs.id))
    .where(and(isNull(gymDayLinks.brokenAt), isNull(gymPairs.revokedAt), or(eq(gymDayLinks.dayA, dayId), eq(gymDayLinks.dayB, dayId))));

  return filas.map(({ link, pair }) => {
    const soyA = link.dayA === dayId;
    return {
      linkId: link.id,
      otroDia: soyA ? link.dayB : link.dayA,
      otroUsuario: soyA ? pair.userB : pair.userA,
    };
  });
}

/** Al borrar un día, sus vínculos mueren. Es la regla que él puso con el
 *  ejemplo del «Full body»: se desconecta y deja de llegar nada de ahí. */
export async function romperVinculosDeDia(dayId: number, motivo = 'dia_borrado') {
  await db
    .update(gymDayLinks)
    .set({ brokenAt: new Date(), brokenReason: motivo })
    .where(and(isNull(gymDayLinks.brokenAt), or(eq(gymDayLinks.dayA, dayId), eq(gymDayLinks.dayB, dayId))));
}

export interface CambioEmitido {
  userId: number;
  dayId: number;
  /**
   * Solo alta y baja. El OBJETIVO (series × repeticiones) no viaja: es de cada
   * uno, igual que los kilos. Que a mí me llegue que él ahora hace 4×15 no me
   * dice nada, porque su cuerpo no es el mío. Lo que sí importa es que ha
   * metido o quitado un ejercicio.
   */
  kind: 'alta' | 'baja' | 'ss_alta' | 'ss_baja';
  name: string;
  exerciseKind?: 'repes' | 'tiempo';
  parts?: string;
  /** La identidad de catálogo: si es un ejercicio común, el otro lado casa
   *  exacto; si es privado, el nombre sigue valiendo de puente. */
  catalogId?: number | null;
  /** Superseries: los nombres e identidades de TODOS los implicados. */
  extra?: { names: string[]; catalogIds: (number | null)[] };
  /** Al aceptar una sugerencia no se devuelve el eco a quien la mandó. */
  exceptoLink?: number;
}

/**
 * Propaga un cambio a los días vinculados.
 *
 * La regla de que NO se acumulan vive aquí: antes de escribir la sugerencia
 * nueva, cualquier otra sobre el MISMO ejercicio y el mismo vínculo pasa a
 * «sustituida». Rechazar algo no hace que reaparezca luego el histórico; lo que
 * llega es siempre el último estado.
 */
export async function emitirCambio(c: CambioEmitido): Promise<void> {
  const vinculos = (await vinculosDeDia(c.dayId)).filter((v) => v.linkId !== c.exceptoLink);
  if (!vinculos.length) return;

  const [dia] = await db.select({ name: gymDays.name }).from(gymDays).where(eq(gymDays.id, c.dayId));
  const quien = await nombreDe(c.userId);

  for (const v of vinculos) {
    // La sugerencia describe lo que le falta a QUIEN LA RECIBE, no la historia
    // de quien la manda. Sin esto pasa lo siguiente: añado un ejercicio, luego
    // le cambio las repeticiones, y al otro le llega «ha cambiado el objetivo»
    // de algo que él nunca ha tenido, que al aceptarlo no puede hacer nada.
    const [suyo] = await db
      .select({ id: gymExercises.id })
      .from(gymExercises)
      .where(
        and(
          eq(gymExercises.dayId, v.otroDia),
          isNull(gymExercises.archivedAt),
          isNull(gymExercises.proposedAt),
          c.catalogId
            ? or(eq(gymExercises.catalogId, c.catalogId), sql`lower(${gymExercises.name}) = lower(${c.name})`)
            : sql`lower(${gymExercises.name}) = lower(${c.name})`,
        ),
      );

    const kind = c.kind;
    if (kind === 'baja' && !suyo) continue; // no lo tiene: no hay nada que sugerir
    if (kind === 'alta' && suyo) continue; // ya lo tiene: el objetivo es cosa suya

    // Superseries: se mira si el receptor ya está (o ya no está) en ese estado.
    if (kind === 'ss_alta' || kind === 'ss_baja') {
      const nombres = (c.extra?.names ?? []).map((n) => n.toLowerCase());
      const suyos = await db
        .select({ id: gymExercises.id, name: gymExercises.name, supersetId: gymExercises.supersetId })
        .from(gymExercises)
        .where(and(eq(gymExercises.dayId, v.otroDia), isNull(gymExercises.archivedAt), isNull(gymExercises.proposedAt)));
      const implicados = suyos.filter((x) => nombres.includes(x.name.toLowerCase()));
      const yaJuntos =
        implicados.length === nombres.length &&
        implicados.length > 1 &&
        implicados.every((x) => x.supersetId != null && x.supersetId === implicados[0].supersetId);
      if (kind === 'ss_alta' && yaJuntos) continue; // ya la tiene montada
      if (kind === 'ss_baja' && !yaJuntos) continue; // no la tenía: nada que deshacer
    }

    await db
      .update(gymChanges)
      .set({ status: 'sustituida', resolvedAt: new Date() })
      .where(
        and(
          eq(gymChanges.linkId, v.linkId),
          eq(gymChanges.toUser, v.otroUsuario),
          sql`lower(${gymChanges.exerciseName}) = lower(${c.name})`,
          inArray(gymChanges.status, ['pendiente', 'rechazada']),
        ),
      );

    await db.insert(gymChanges).values({
      linkId: v.linkId,
      fromUser: c.userId,
      toUser: v.otroUsuario,
      kind,
      exerciseName: c.name,
      exerciseKind: c.exerciseKind ?? 'repes',
      parts: c.parts ?? '',
      catalogId: c.catalogId ?? null,
      extra: c.extra ? JSON.stringify(c.extra).slice(0, 600) : null,
    });

    // El aviso dice QUÉ ha cambiado. «Ha cambiado su rutina» no sirve de nada.
    const verbo =
      kind === 'alta'
        ? 'ha añadido'
        : kind === 'baja'
          ? 'ha quitado'
          : kind === 'ss_alta'
            ? 'ha creado una superserie:'
            : 'ha quitado la superserie';
    void sendToUser(v.otroUsuario, {
      title: `${quien} ${verbo} ${c.name}`,
      body: `En ${dia?.name ?? 'una sesión'} que compartís. Míralo en Rutina y decide si lo coges.`,
      url: '/gimnasio?tab=rutina',
    }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// La key
// ─────────────────────────────────────────────────────────────────────────────

/** POST /gym/compartir/key -> { code } (se enseña UNA vez) */
compartirRouter.post('/compartir/key', ah(async (req: AuthedRequest, res) => {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(gymDays)
    .where(and(eq(gymDays.userId, req.userId!), isNull(gymDays.archivedAt)));
  if (Number(n) === 0) return res.status(400).json({ error: 'Primero monta tu rutina: no hay nada que compartir' });

  // Corta y legible: se dicta por teléfono. Sin i/l/0/o para no confundir.
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const code = Array.from(crypto.randomBytes(10))
    .map((b) => alfabeto[b % alfabeto.length])
    .join('')
    .replace(/(.{5})(?=.)/g, '$1-');

  await db.insert(gymShareCodes).values({
    codeHash: huella(code),
    createdBy: req.userId!,
    expiresAt: new Date(Date.now() + DIAS_VALIDEZ * 24 * 60 * 60 * 1000),
  });
  res.status(201).json({ code, expiresAt: new Date(Date.now() + DIAS_VALIDEZ * 24 * 60 * 60 * 1000) });
}));

/**
 * POST /gym/compartir/canjear { code }
 *
 * Canjear la key hace dos cosas de golpe: te llevas una COPIA de su rutina y
 * cada día copiado queda vinculado con el suyo. La copia es tuya desde el
 * primer momento: la editas sin tocarle nada.
 */
compartirRouter.post('/compartir/canjear', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ code: z.string().trim().min(4).max(40) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Falta la key' });
  const code = parsed.data.code.toUpperCase();

  const [vale] = await db.select().from(gymShareCodes).where(eq(gymShareCodes.codeHash, huella(code)));
  if (!vale || vale.revokedAt) return res.status(404).json({ error: 'Esa key no vale' });
  if (vale.usedAt) return res.status(400).json({ error: 'Esa key ya se ha usado' });
  if (new Date(vale.expiresAt) < new Date()) return res.status(400).json({ error: 'Esa key ha caducado' });
  if (vale.createdBy === req.userId!) return res.status(400).json({ error: 'Esa key es tuya' });

  const yo = req.userId!;
  const otro = vale.createdBy;
  const [userA, userB] = yo < otro ? [yo, otro] : [otro, yo];

  const [existente] = await db
    .select()
    .from(gymPairs)
    .where(and(eq(gymPairs.userA, userA), eq(gymPairs.userB, userB)));

  let pairId: number;
  if (existente && !existente.revokedAt) {
    pairId = existente.id;
  } else if (existente) {
    await db.update(gymPairs).set({ revokedAt: null }).where(eq(gymPairs.id, existente.id));
    pairId = existente.id;
  } else {
    const [r] = await db.insert(gymPairs).values({ userA, userB });
    pairId = r.insertId;
  }

  // Su rutina, copiada a la mía. Sin kilos ni notas: son suyos.
  const susDias = await db
    .select()
    .from(gymDays)
    .where(and(eq(gymDays.userId, otro), isNull(gymDays.archivedAt)))
    .orderBy(gymDays.sortOrder, gymDays.id);

  const [{ base }] = await db
    .select({ base: sql<number>`count(*)` })
    .from(gymDays)
    .where(and(eq(gymDays.userId, yo), isNull(gymDays.archivedAt)));

  let copiados = 0;
  let ejerciciosCopiados = 0;
  for (const [i, d] of susDias.entries()) {
    const [nuevo] = await db.insert(gymDays).values({
      userId: yo,
      name: d.name,
      sortOrder: Number(base) + i,
    });
    copiados += 1;

    const sus = await db
      .select()
      .from(gymExercises)
      .where(and(eq(gymExercises.dayId, d.id), isNull(gymExercises.archivedAt), isNull(gymExercises.proposedAt)))
      .orderBy(gymExercises.sortOrder, gymExercises.id);

    for (const e of sus) {
      // La copia conserva la identidad: si el ejercicio es común se comparte el
      // id; si era privado de quien invita, nace una copia privada del receptor.
      const ident = await asegurarIdentidad(yo, { catalogId: e.catalogId, name: e.name, parts: e.parts, kind: e.kind });
      await db.insert(gymExercises).values({
        userId: yo,
        dayId: nuevo.insertId,
        name: e.name,
        kind: e.kind,
        catalogId: ident.id,
        parts: e.parts,
        partsSecondary: e.partsSecondary,
        muscles: e.muscles,
        targetSets: e.targetSets,
        targetReps: e.targetReps,
        // targetWeight y notes se quedan fuera a propósito
        sortOrder: e.sortOrder,
      });
      ejerciciosCopiados += 1;
    }

    const [dayA, dayB] = pairId && userA === yo ? [nuevo.insertId, d.id] : [d.id, nuevo.insertId];
    await db.insert(gymDayLinks).values({ pairId, dayA, dayB });
  }

  await db.update(gymShareCodes).set({ usedAt: new Date(), usedBy: yo }).where(eq(gymShareCodes.id, vale.id));

  const quien = await nombreDe(yo);
  void sendToUser(otro, {
    title: `${quien} se ha unido a tu rutina`,
    body: `Compartís ${copiados} ${copiados === 1 ? 'sesión' : 'sesiones'}. Cuando uno cambie algo, al otro le llegará como sugerencia.`,
    url: '/gimnasio?tab=rutina',
  }).catch(() => {});

  res.status(201).json({ pairId, dias: copiados, ejercicios: ejerciciosCopiados, con: await nombreDe(otro) });
}));

/** GET /gym/compartir -> con quién comparto y qué días */
compartirRouter.get('/compartir', ah(async (req: AuthedRequest, res) => {
  const parejas = await parejasDe(req.userId!);
  const salida = [];
  for (const { pair, otro } of parejas) {
    const enlaces = await db
      .select({ id: gymDayLinks.id, dayA: gymDayLinks.dayA, dayB: gymDayLinks.dayB })
      .from(gymDayLinks)
      .where(and(eq(gymDayLinks.pairId, pair.id), isNull(gymDayLinks.brokenAt)));

    const mios = enlaces.map((l) => (pair.userA === req.userId! ? l.dayA : l.dayB));
    const nombres = mios.length
      ? await db.select({ id: gymDays.id, name: gymDays.name }).from(gymDays).where(inArray(gymDays.id, mios))
      : [];

    salida.push({
      pairId: pair.id,
      con: await nombreDe(otro),
      desde: pair.createdAt,
      sesiones: enlaces.map((l) => {
        const mio = pair.userA === req.userId! ? l.dayA : l.dayB;
        return { linkId: l.id, dayId: mio, name: nombres.find((n) => n.id === mio)?.name ?? '(borrada)' };
      }),
    });
  }
  res.json(salida);
}));

/** DELETE /gym/compartir/:pairId — romper la key. No borra nada de nadie. */
compartirRouter.delete('/compartir/:pairId(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.pairId);
  const [p] = await db
    .select()
    .from(gymPairs)
    .where(and(eq(gymPairs.id, id), or(eq(gymPairs.userA, req.userId!), eq(gymPairs.userB, req.userId!))));
  if (!p) return res.status(404).json({ error: 'No compartes con nadie ahí' });

  await db.update(gymPairs).set({ revokedAt: new Date() }).where(eq(gymPairs.id, id));
  await db
    .update(gymDayLinks)
    .set({ brokenAt: new Date(), brokenReason: 'key_rota' })
    .where(and(eq(gymDayLinks.pairId, id), isNull(gymDayLinks.brokenAt)));
  // Las sugerencias que quedaran a medias dejan de tener sentido
  await db
    .update(gymChanges)
    .set({ status: 'sustituida', resolvedAt: new Date() })
    .where(and(eq(gymChanges.status, 'pendiente'), inArray(gymChanges.toUser, [p.userA, p.userB])));
  res.json({ ok: true });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Sugerencias
// ─────────────────────────────────────────────────────────────────────────────

/** GET /gym/sugerencias -> lo que el otro ha cambiado y tú no has resuelto */
compartirRouter.get('/sugerencias', ah(async (req: AuthedRequest, res) => {
  const filas = await db
    .select({ c: gymChanges, link: gymDayLinks })
    .from(gymChanges)
    .innerJoin(gymDayLinks, eq(gymChanges.linkId, gymDayLinks.id))
    .where(and(eq(gymChanges.toUser, req.userId!), eq(gymChanges.status, 'pendiente'), isNull(gymDayLinks.brokenAt)))
    .orderBy(sql`${gymChanges.id} desc`)
    .limit(60);

  // Lo que esta cuenta VE en el catálogo, para saber si un alta trae además un
  // ejercicio que no está en su listado (ahí la sugerencia es doble).
  const { gymCatalog } = await import('../../db/schema');
  const visibles = await db
    .select({ id: gymCatalog.id, name: gymCatalog.name })
    .from(gymCatalog)
    .where(and(isNull(gymCatalog.archivedAt), or(sql`${gymCatalog.createdBy} is null`, eq(gymCatalog.createdBy, req.userId!))));
  const idsVisibles = new Set(visibles.map((v) => v.id));
  const nombresVisibles = new Set(visibles.map((v) => v.name.trim().toLowerCase()));

  const salida = [];
  for (const { c, link } of filas) {
    // mi día del vínculo: el que NO es del que manda
    const [mio] = await db
      .select({ id: gymDays.id, name: gymDays.name })
      .from(gymDays)
      .where(and(inArray(gymDays.id, [link.dayA, link.dayB]), eq(gymDays.userId, req.userId!), isNull(gymDays.archivedAt)));
    if (!mio) continue; // el día es mío y ya no está: el vínculo se romperá solo
    salida.push({
      extra: c.extra,
      enTuListado:
        (c.catalogId != null && idsVisibles.has(c.catalogId)) || nombresVisibles.has(c.exerciseName.trim().toLowerCase()),
      id: c.id,
      kind: c.kind,
      name: c.exerciseName,
      exerciseKind: c.exerciseKind,
      parts: c.parts,
      targetSets: c.targetSets,
      targetReps: c.targetReps,
      prevSets: c.prevSets,
      prevReps: c.prevReps,
      de: await nombreDe(c.fromUser),
      dayId: mio.id,
      dayName: mio.name,
      createdAt: c.createdAt,
    });
  }
  res.json(salida);
}));

/** POST /gym/sugerencias/:id/aceptar */
compartirRouter.post('/sugerencias/:id(\\d+)/aceptar', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [fila] = await db
    .select({ c: gymChanges, link: gymDayLinks })
    .from(gymChanges)
    .innerJoin(gymDayLinks, eq(gymChanges.linkId, gymDayLinks.id))
    .where(and(eq(gymChanges.id, id), eq(gymChanges.toUser, req.userId!), eq(gymChanges.status, 'pendiente')));
  if (!fila) return res.status(404).json({ error: 'Esa sugerencia ya no está' });

  const { c, link } = fila;
  const [mio] = await db
    .select()
    .from(gymDays)
    .where(and(inArray(gymDays.id, [link.dayA, link.dayB]), eq(gymDays.userId, req.userId!), isNull(gymDays.archivedAt)));
  if (!mio) return res.status(400).json({ error: 'Ese día ya no está en tu rutina' });

  // Superseries: montar (creando lo que falte) o deshacer, y listo.
  if (c.kind === 'ss_alta' || c.kind === 'ss_baja') {
    const info = (() => {
      try {
        return JSON.parse(c.extra ?? '{}') as { names?: string[]; catalogIds?: (number | null)[] };
      } catch {
        return {};
      }
    })();
    const nombres = info.names ?? [];
    if (nombres.length < 2) return res.status(400).json({ error: 'Esa sugerencia viene incompleta' });

    const mios = await db
      .select()
      .from(gymExercises)
      .where(and(eq(gymExercises.dayId, mio.id), isNull(gymExercises.archivedAt), isNull(gymExercises.proposedAt)));

    if (c.kind === 'ss_alta') {
      const ids: number[] = [];
      for (let i = 0; i < nombres.length; i += 1) {
        const ya = mios.find((x) => x.name.toLowerCase() === nombres[i].toLowerCase());
        if (ya) {
          ids.push(ya.id);
          continue;
        }
        // no lo tenía: entra en el día con su identidad y el objetivo por defecto
        const ident = await asegurarIdentidad(req.userId!, { catalogId: info.catalogIds?.[i], name: nombres[i] });
        const [r] = await db.insert(gymExercises).values({
          userId: req.userId!,
          dayId: mio.id,
          name: ident.name,
          kind: ident.kind,
          catalogId: ident.id,
          parts: ident.parts,
          partsSecondary: ident.partsSecondary,
          muscles: musculosDePartes(ident.parts),
          targetSets: 4,
          targetReps: '8-10',
          sortOrder: mios.length + i,
        });
        ids.push(r.insertId);
      }
      for (let i = 1; i < ids.length; i += 1) await vincularSuperserie(req.userId!, ids[0], ids[i]);
    } else {
      const implicado = mios.find((x) => nombres.some((n) => n.toLowerCase() === x.name.toLowerCase()) && x.supersetId != null);
      if (implicado) await soltarSuperserie(req.userId!, implicado.id);
    }

    await db.update(gymChanges).set({ status: 'aceptada', resolvedAt: new Date() }).where(eq(gymChanges.id, id));
    return res.json({ ok: true, aviso: null });
  }

  const [existente] = await db
    .select()
    .from(gymExercises)
    .where(
      and(
        eq(gymExercises.dayId, mio.id),
        isNull(gymExercises.archivedAt),
        sql`lower(${gymExercises.name}) = lower(${c.exerciseName})`,
      ),
    );

  let aviso: string | null = null;

  let identidad: { id: number; parts: string } | null = null;
  if (c.kind === 'alta') {
    if (existente) {
      aviso = 'Ya lo tenías en ese día: no se ha duplicado.';
    } else {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(gymExercises)
        .where(and(eq(gymExercises.dayId, mio.id), isNull(gymExercises.archivedAt)));
      // La identidad se resuelve PARA EL RECEPTOR: si el ejercicio es común se
      // reutiliza; si era privado del otro (o no existe aquí), nace como
      // privado de quien acepta. Cogerlo al día implica tenerlo en el listado.
      const ident = await asegurarIdentidad(req.userId!, {
        catalogId: c.catalogId,
        name: c.exerciseName,
        parts: c.parts,
        kind: c.exerciseKind,
      });
      identidad = { id: ident.id, parts: ident.parts || limpiarPartes(c.parts) };
      await db.insert(gymExercises).values({
        userId: req.userId!,
        dayId: mio.id,
        name: ident.name,
        kind: c.exerciseKind,
        catalogId: ident.id,
        parts: identidad.parts,
        partsSecondary: ident.partsSecondary,
        muscles: musculosDePartes(identidad.parts),
        // Objetivo por defecto: el suyo no viaja y no se va a inventar uno
        // ajeno. Se ajusta al entrenarlo, como el peso.
        targetSets: 4,
        targetReps: '8-10',
        sortOrder: Number(n),
      });
    }
  } else {
    if (!existente) aviso = 'Ya no lo tenías.';
    else await db.update(gymExercises).set({ archivedAt: new Date() }).where(eq(gymExercises.id, existente.id));
  }

  await db.update(gymChanges).set({ status: 'aceptada', resolvedAt: new Date() }).where(eq(gymChanges.id, id));

  // Si comparto ese día con alguien MÁS, también se entera. Al que me lo mandó
  // no se le devuelve el eco: ya lo tiene.
  if (!aviso) {
    await emitirCambio({
      userId: req.userId!,
      dayId: mio.id,
      kind: c.kind === 'baja' ? 'baja' : 'alta',
      name: c.exerciseName,
      exerciseKind: c.exerciseKind,
      parts: c.parts,
      catalogId: identidad?.id ?? c.catalogId,
      exceptoLink: link.id,
    });
  }

  res.json({ ok: true, aviso });
}));

/**
 * POST /gym/sugerencias/:id/solo-listado — la segunda mitad de la decisión
 * doble: «no lo quiero en mi día, pero guárdamelo en el listado». Solo tiene
 * sentido en las altas de ejercicios que no tenías: el ejercicio se te crea
 * (o se reutiliza el común) y la sugerencia del día queda descartada.
 */
compartirRouter.post('/sugerencias/:id(\\d+)/solo-listado', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [c] = await db
    .select()
    .from(gymChanges)
    .where(and(eq(gymChanges.id, id), eq(gymChanges.toUser, req.userId!), eq(gymChanges.status, 'pendiente')));
  if (!c) return res.status(404).json({ error: 'Esa sugerencia ya no está' });
  if (c.kind !== 'alta') return res.status(400).json({ error: 'Solo las altas se pueden guardar en el listado' });

  const ident = await asegurarIdentidad(req.userId!, {
    catalogId: c.catalogId,
    name: c.exerciseName,
    parts: c.parts,
    kind: c.exerciseKind,
  });
  await db.update(gymChanges).set({ status: 'rechazada', resolvedAt: new Date() }).where(eq(gymChanges.id, id));
  res.json({ ok: true, catalogId: ident.id, name: ident.name });
}));

/** POST /gym/sugerencias/:id/rechazar — se descarta y no vuelve. Si el otro
 *  vuelve a tocar ese ejercicio llegará el cambio NUEVO, no este. */
compartirRouter.post('/sugerencias/:id(\\d+)/rechazar', ah(async (req: AuthedRequest, res) => {
  const [r] = await db
    .update(gymChanges)
    .set({ status: 'rechazada', resolvedAt: new Date() })
    .where(and(eq(gymChanges.id, Number(req.params.id)), eq(gymChanges.toUser, req.userId!), eq(gymChanges.status, 'pendiente')));
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Esa sugerencia ya no está' });
  res.json({ ok: true });
}));
