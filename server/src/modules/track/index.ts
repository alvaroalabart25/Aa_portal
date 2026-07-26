import { Router } from 'express';
import crypto from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { diarySessions, healthEntries, routineItems, users } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';

// Control remoto del Diario (Atajos de iOS): un GET/POST con token propio
// registra sin abrir la app. El token vive en la BD (users.track_secret),
// así no hay que tocar variables de entorno para estrenarlo.

function madridNow(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

// ---------- Setup (con login): obtener/generar el token ----------
export const trackSetup = Router();

trackSetup.get('/track-setup', ah(async (req: AuthedRequest, res) => {
  const [u] = await db.select().from(users).where(eq(users.id, req.userId!));
  let secret = u?.trackSecret ?? null;
  if (!secret) {
    secret = crypto.randomBytes(24).toString('base64url');
    await db.update(users).set({ trackSecret: secret }).where(eq(users.id, req.userId!));
  }
  res.json({ secret });
}));

// ---------- Endpoint público con token ----------
export const trackModule = Router();

trackModule.all('/track', ah(async (req, res) => {
  const q: Record<string, unknown> = { ...req.query, ...(typeof req.body === 'object' && req.body ? req.body : {}) };
  const t = String(q.t ?? req.headers['x-track-secret'] ?? '');
  if (!t) return res.status(401).json({ ok: false, message: 'Falta el token' });
  const [user] = await db.select().from(users).where(eq(users.trackSecret, t));
  if (!user) return res.status(401).json({ ok: false, message: 'Token inválido' });

  const action = String(q.action ?? '');
  const now = madridNow();
  // 'do' responde en texto plano: queda limpio en la notificación de Atajos
  const plain = action === 'do' || q.plain != null;
  const reply = (status: number, message: string) =>
    plain ? res.status(status).type('text/plain').send(message) : res.status(status).json({ ok: status < 400, message });

  const doCigarro = async () => {
    await db.insert(healthEntries).values({ userId: user.id, kind: 'cigarro', entryDate: now.date, entryTime: now.time });
    return reply(200, `🚬 Piti registrado a las ${now.time}`);
  };

  const doStop = async () => {
    const [result] = await db
      .update(diarySessions)
      .set({ endAt: new Date() })
      .where(and(eq(diarySessions.userId, user.id), isNull(diarySessions.endAt)));
    return reply(200, result.affectedRows > 0 ? `■ Actividad parada a las ${now.time}` : 'No había nada en curso');
  };

  const doStart = async (wanted: string) => {
    const items = await db
      .select()
      .from(routineItems)
      .where(and(eq(routineItems.userId, user.id), isNull(routineItems.archivedAt)));
    const item = items.find((i) => normalize(i.title) === wanted) ?? items.find((i) => normalize(i.title).includes(wanted));
    if (!item) return reply(400, `Actividad "${wanted}" no encontrada. Hay: ${items.map((i) => i.title).join(', ')}`);
    const nowDate = new Date();
    // Puntual: solo deja la marca, sin interrumpir lo que estuviera en curso
    if (item.isInstant === 1) {
      await db.insert(diarySessions).values({ userId: user.id, itemId: item.id, startAt: nowDate, endAt: nowDate });
      return reply(200, `✓ ${item.emoji} ${item.title} a las ${now.time}`);
    }
    await db
      .update(diarySessions)
      .set({ endAt: nowDate })
      .where(and(eq(diarySessions.userId, user.id), isNull(diarySessions.endAt)));
    await db.insert(diarySessions).values({ userId: user.id, itemId: item.id, startAt: nowDate });
    return reply(200, `▶ ${item.emoji} ${item.title} desde las ${now.time}`);
  };

  if (action === 'cigarro') return doCigarro();
  if (action === 'stop') return doStop();

  if (action === 'peso') {
    const value = Number(q.value);
    if (!value || value <= 0 || value > 400) return reply(400, 'Peso inválido (kg)');
    await db.insert(healthEntries).values({ userId: user.id, kind: 'peso', value, entryDate: now.date, entryTime: now.time });
    return reply(200, `⚖️ ${value} kg registrados a las ${now.time}`);
  }

  if (action === 'start') {
    const wanted = normalize(String(q.item ?? ''));
    if (!wanted) return reply(400, 'Falta la actividad (item)');
    return doStart(wanted);
  }

  // Menú del atajo único: favoritas del catálogo (o todas si no hay) + fijos
  if (action === 'list') {
    const items = await db
      .select()
      .from(routineItems)
      .where(and(eq(routineItems.userId, user.id), isNull(routineItems.archivedAt)));
    const pool = items.some((i) => i.isFavorite === 1) ? items.filter((i) => i.isFavorite === 1) : items;
    const opciones = ['🚬 Piti', '■ Parar', ...pool.sort((a, b) => a.title.localeCompare(b.title)).map((i) => `${i.emoji} ${i.title}`)];
    return res.json({ opciones });
  }

  // Ejecutar lo elegido en el menú: piti, parar o empezar actividad.
  // El valor se lee del final de la URL en crudo: así un título con "&"
  // (p. ej. "Café & Otros") no se parte en dos parámetros.
  if (action === 'do') {
    const afterWhat = req.originalUrl.split('what=')[1];
    let raw = String(q.what ?? '');
    if (afterWhat) {
      try {
        raw = decodeURIComponent(afterWhat.replace(/\+/g, ' '));
      } catch {
        raw = afterWhat;
      }
    }
    // Si llega el menú entero, falta el paso «Elegir de la lista» en el atajo
    if (/piti/i.test(raw) && /parar/i.test(raw)) {
      return reply(400, 'Parece que el atajo manda la lista entera: añade el paso «Seleccionar de la lista» antes de esta acción e inserta la variable «Ítem seleccionado».');
    }
    const wanted = normalize(raw.replace(/[^\p{L}\p{N} &+]/gu, ' ')).replace(/\s+/g, ' ').trim();
    if (!wanted) return reply(400, 'Falta la elección: inserta la variable «Ítem seleccionado» detrás de what=');
    if (wanted.includes('piti') || wanted.includes('cigarro')) return doCigarro();
    if (wanted.includes('parar') || wanted === 'stop') return doStop();
    return doStart(wanted);
  }

  reply(400, 'Acción desconocida (usa list, do, start, stop, cigarro o peso)');
}));
