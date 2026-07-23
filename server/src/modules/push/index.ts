import { Router } from 'express';
import { z } from 'zod';
import webpush from 'web-push';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import {
  events,
  notificationPrefs,
  pushSubscriptions,
  routineChecks,
  routineSlots,
  spaces,
  tasks,
  users,
} from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';

// Notificaciones push (Web Push a la PWA instalada).
// - El usuario activa el dispositivo desde el configurador (suscripción).
// - Cada tipo de aviso es un interruptor con su hora.
// - /run lo llama GitHub Actions cada hora (con secreto): envía lo que toque
//   según la hora de Madrid, una vez al día como máximo por tipo.
export const pushModule = Router();

function vapidConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function setupVapid() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:hola@alvaroalabart.es',
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

function madridNow(): { iso: string; hhmm: string } {
  const parts = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { iso: `${get('year')}-${get('month')}-${get('day')}`, hhmm: `${get('hour')}:${get('minute')}` };
}

function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

// Tipos de aviso disponibles (el configurador los pinta de aquí)
export const NOTIFICATION_TYPES: Array<{ type: string; label: string; defaultTime: string }> = [
  { type: 'tasks_due', label: 'Tareas que vencen hoy', defaultTime: '08:30' },
  { type: 'events_radar', label: 'Eventos importantes (hitos del radar)', defaultTime: '09:00' },
  { type: 'routine_incomplete', label: 'Rutina incompleta', defaultTime: '21:00' },
];

async function sendToUser(userId: number, payload: { title: string; body: string; url?: string }) {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)); // suscripción muerta
      }
    }
  }
  return sent;
}

// ---------- Constructores de cada tipo de aviso (null = nada que avisar) ----------
async function buildPayload(type: string, userId: number, todayIso: string) {
  if (type === 'tasks_due') {
    const rows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.dueDate, todayIso),
          isNull(tasks.archivedAt),
          inArray(tasks.status, ['backlog', 'in_progress', 'blocked']),
        ),
      );
    if (rows.length === 0) return null;
    return {
      title: 'Aa Portal · Agenda',
      body: rows.length === 1 ? 'Tienes 1 tarea que vence hoy' : `Tienes ${rows.length} tareas que vencen hoy`,
      url: '/agenda',
    };
  }

  if (type === 'events_radar') {
    const MILESTONES = new Set([0, 1, 2, 3, 7, 15, 30]);
    const rows = await db
      .select({ title: events.title, emoji: events.emoji, eventDate: events.eventDate, recurrence: events.recurrence })
      .from(events)
      .where(and(eq(events.userId, userId), isNull(events.archivedAt)));
    const base = new Date(`${todayIso}T12:00:00`);
    const hits: string[] = [];
    for (const ev of rows) {
      // próxima ocurrencia (los recurrentes ruedan)
      let next = ev.eventDate;
      if (ev.recurrence !== 'none' && next < todayIso) {
        const [, m, d] = ev.eventDate.split('-').map(Number);
        const y = base.getFullYear();
        if (ev.recurrence === 'yearly') {
          const cand = new Date(y, m - 1, d);
          next = cand.toISOString().slice(0, 10) >= todayIso ? cand.toISOString().slice(0, 10) : new Date(y + 1, m - 1, d).toISOString().slice(0, 10);
        } else {
          const cand = new Date(y, base.getMonth(), d);
          next = cand.toISOString().slice(0, 10) >= todayIso ? cand.toISOString().slice(0, 10) : new Date(y, base.getMonth() + 1, d).toISOString().slice(0, 10);
        }
      }
      const days = Math.round((new Date(`${next}T12:00:00`).getTime() - base.getTime()) / 86_400_000);
      if (MILESTONES.has(days)) {
        hits.push(days === 0 ? `${ev.emoji} HOY: ${ev.title}` : `${ev.emoji} En ${days} día${days === 1 ? '' : 's'}: ${ev.title}`);
      }
    }
    if (hits.length === 0) return null;
    return { title: 'Aa Portal · Eventos importantes', body: hits.join('\n'), url: '/agenda' };
  }

  if (type === 'routine_incomplete') {
    const wd = weekdayOf(todayIso);
    const slots = await db
      .select({ id: routineSlots.id })
      .from(routineSlots)
      .where(and(eq(routineSlots.userId, userId), eq(routineSlots.weekday, wd), isNull(routineSlots.archivedAt)));
    if (slots.length === 0) return null;
    const checks = await db
      .select({ id: routineChecks.id })
      .from(routineChecks)
      .where(and(eq(routineChecks.userId, userId), eq(routineChecks.checkDate, todayIso)));
    const missing = slots.length - checks.length;
    if (missing <= 0) return null;
    return {
      title: 'Aa Portal · Rutina',
      body: missing === slots.length ? `Aún no has marcado nada de tu rutina de hoy (${slots.length} checks)` : `Te quedan ${missing} de ${slots.length} checks de la rutina de hoy`,
      url: '/rutina',
    };
  }

  return null;
}

// ---------- Rutas autenticadas (configurador) ----------
pushModule.get('/public-key', ah(async (_req: AuthedRequest, res) => {
  if (!vapidConfigured()) return res.status(503).json({ error: 'Notificaciones no configuradas en el servidor' });
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
}));

const subInput = z.object({
  endpoint: z.string().url().max(500),
  keys: z.object({ p256dh: z.string().max(255), auth: z.string().max(255) }),
});

pushModule.post('/subscribe', ah(async (req: AuthedRequest, res) => {
  const parsed = subInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { endpoint, keys } = parsed.data;
  const [existing] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  if (!existing) {
    await db.insert(pushSubscriptions).values({ userId: req.userId!, endpoint, p256dh: keys.p256dh, auth: keys.auth });
  }
  res.status(201).json({ subscribed: true });
}));

pushModule.post('/unsubscribe', ah(async (req: AuthedRequest, res) => {
  const endpoint = String(req.body?.endpoint ?? '');
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, req.userId!)));
  res.json({ subscribed: false });
}));

pushModule.get('/prefs', ah(async (req: AuthedRequest, res) => {
  const rows = await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, req.userId!));
  const byType = new Map(rows.map((r) => [r.type, r]));
  const subs = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, req.userId!));
  res.json({
    devices: subs.length,
    prefs: NOTIFICATION_TYPES.map((t) => ({
      type: t.type,
      label: t.label,
      enabled: byType.has(t.type) ? byType.get(t.type)!.enabled === 1 : true,
      sendTime: byType.get(t.type)?.sendTime ?? t.defaultTime,
    })),
  });
}));

const prefInput = z.object({
  type: z.string().max(40),
  enabled: z.boolean(),
  sendTime: z.string().regex(/^\d{2}:\d{2}$/),
});

pushModule.put('/prefs', ah(async (req: AuthedRequest, res) => {
  const parsed = prefInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { type, enabled, sendTime } = parsed.data;
  if (!NOTIFICATION_TYPES.some((t) => t.type === type)) return res.status(400).json({ error: 'Tipo desconocido' });
  const [existing] = await db
    .select()
    .from(notificationPrefs)
    .where(and(eq(notificationPrefs.userId, req.userId!), eq(notificationPrefs.type, type)));
  if (existing) {
    await db
      .update(notificationPrefs)
      .set({ enabled: enabled ? 1 : 0, sendTime })
      .where(eq(notificationPrefs.id, existing.id));
  } else {
    await db.insert(notificationPrefs).values({ userId: req.userId!, type, enabled: enabled ? 1 : 0, sendTime });
  }
  res.json({ ok: true });
}));

// Prueba inmediata en los dispositivos activados
pushModule.post('/test', ah(async (req: AuthedRequest, res) => {
  if (!vapidConfigured()) return res.status(503).json({ error: 'Notificaciones no configuradas en el servidor' });
  setupVapid();
  const sent = await sendToUser(req.userId!, {
    title: 'Aa Portal 🎉',
    body: 'Las notificaciones funcionan en este dispositivo.',
    url: '/agenda',
  });
  if (sent === 0) return res.status(400).json({ error: 'No hay dispositivos activados (o la suscripción caducó)' });
  res.json({ sent });
}));

// ---------- Disparador horario (GitHub Actions, con secreto) ----------
export const pushRunner = Router();

pushRunner.post('/run', ah(async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  if (!vapidConfigured()) return res.json({ sent: 0, reason: 'VAPID no configurado' });
  setupVapid();

  const { iso: today, hhmm } = madridNow();
  const allUsers = await db.select({ id: users.id }).from(users);
  const results: Array<{ user: number; type: string; sent: number }> = [];

  for (const u of allUsers) {
    const rows = await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, u.id));
    const byType = new Map(rows.map((r) => [r.type, r]));
    for (const t of NOTIFICATION_TYPES) {
      const pref = byType.get(t.type);
      const enabled = pref ? pref.enabled === 1 : true;
      const sendTime = pref?.sendTime ?? t.defaultTime;
      const lastSent = pref?.lastSent ?? null;
      // toca si: activado, ya pasó su hora (Madrid) y no se envió hoy
      if (!enabled || hhmm < sendTime || lastSent === today) continue;

      const payload = await buildPayload(t.type, u.id, today);
      // se marca como tratado hoy aunque no haya nada que avisar (evita reintentos)
      if (pref) {
        await db.update(notificationPrefs).set({ lastSent: today }).where(eq(notificationPrefs.id, pref.id));
      } else {
        await db.insert(notificationPrefs).values({ userId: u.id, type: t.type, enabled: 1, sendTime, lastSent: today });
      }
      if (payload) {
        const sent = await sendToUser(u.id, payload);
        results.push({ user: u.id, type: t.type, sent });
      }
    }
  }
  res.json({ time: `${today} ${hhmm}`, results });
}));

// referencia usada solo para tipado/documentación del radar
void spaces;
