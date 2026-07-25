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

  if (action === 'cigarro') {
    await db.insert(healthEntries).values({ userId: user.id, kind: 'cigarro', entryDate: now.date, entryTime: now.time });
    return res.json({ ok: true, message: `🚬 Piti registrado a las ${now.time}` });
  }

  if (action === 'peso') {
    const value = Number(q.value);
    if (!value || value <= 0 || value > 400) return res.status(400).json({ ok: false, message: 'Peso inválido (kg)' });
    await db.insert(healthEntries).values({ userId: user.id, kind: 'peso', value, entryDate: now.date, entryTime: now.time });
    return res.json({ ok: true, message: `⚖️ ${value} kg registrados a las ${now.time}` });
  }

  if (action === 'stop') {
    const [result] = await db
      .update(diarySessions)
      .set({ endAt: new Date() })
      .where(and(eq(diarySessions.userId, user.id), isNull(diarySessions.endAt)));
    return res.json({ ok: true, message: result.affectedRows > 0 ? `■ Actividad parada a las ${now.time}` : 'No había nada en curso' });
  }

  if (action === 'start') {
    const wanted = normalize(String(q.item ?? ''));
    if (!wanted) return res.status(400).json({ ok: false, message: 'Falta la actividad (item)' });
    const items = await db
      .select()
      .from(routineItems)
      .where(and(eq(routineItems.userId, user.id), isNull(routineItems.archivedAt)));
    const item = items.find((i) => normalize(i.title) === wanted) ?? items.find((i) => normalize(i.title).includes(wanted));
    if (!item) {
      return res.status(400).json({ ok: false, message: `Actividad "${q.item}" no encontrada. Hay: ${items.map((i) => i.title).join(', ')}` });
    }
    const nowDate = new Date();
    await db
      .update(diarySessions)
      .set({ endAt: nowDate })
      .where(and(eq(diarySessions.userId, user.id), isNull(diarySessions.endAt)));
    await db.insert(diarySessions).values({ userId: user.id, itemId: item.id, startAt: nowDate });
    return res.json({ ok: true, message: `▶ ${item.emoji} ${item.title} desde las ${now.time}` });
  }

  res.status(400).json({ ok: false, message: 'Acción desconocida (usa start, stop, cigarro o peso)' });
}));
