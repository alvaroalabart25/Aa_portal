/**
 * Administración del portal.
 *
 * REGLA DE ESTE FICHERO, y no es un comentario decorativo: aquí se administra
 * el portal, no se leen los datos de nadie. Se puede saber CUÁNTAS filas tiene
 * una cuenta y CUÁNDO entró por última vez —hace falta para saber si el plan
 * gratuito aguanta y si una cuenta está muerta—, pero jamás qué tarea escribió,
 * qué peso levantó ni cuánto facturó.
 *
 * En la práctica eso significa: solo COUNT(*) y fechas. Si alguna vez una ruta
 * de este fichero necesita seleccionar una columna de contenido, la respuesta
 * correcta es que no se hace.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ah } from '../../lib/async';
import { db } from '../../db';
import {
  dreams,
  events,
  gymSets,
  healthEntries,
  invites,
  invoices,
  projects,
  routineChecks,
  tasks,
  users,
} from '../../db/schema';
import { olvidarUsuario, type AuthedRequest } from '../auth/middleware';
import { logSecurityEvent } from '../../lib/security';
import { aTexto, limpiarModulos, MODULOS_POR_DEFECTO } from '../modulos';

export const adminModule = Router();

/**
 * Las tablas que se cuentan para saber cuánto ocupa una cuenta.
 *
 * Se cuentan filas, que es lo que crece. No están todas las 39 a propósito:
 * estas son las que se llenan con el uso diario, y hacer 39 consultas por
 * usuario para afinar un número que solo sirve de orientación no compensa.
 */
// Se nombran las tablas de verdad (no cadenas sueltas metidas en el SQL): así
// solo se puede contar sobre tablas que existen y solo por su columna de dueño.
const TABLAS_DE_USO = [
  ['Tareas', tasks.userId],
  ['Proyectos', projects.userId],
  ['Eventos', events.userId],
  ['Metas', dreams.userId],
  ['Series de gimnasio', gymSets.userId],
  ['Apuntes de salud', healthEntries.userId],
  ['Rutinas marcadas', routineChecks.userId],
  ['Facturas', invoices.userId],
] as const;

// GET /api/admin/usuarios
// Quién hay, si entra, y cuánto ocupa. Ni un campo de contenido.
adminModule.get('/usuarios', ah(async (_req: AuthedRequest, res) => {
  const cuentas = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      modules: users.modules,
      lastSeenAt: users.lastSeenAt,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
      totpEnabled: users.totpEnabled,
    })
    .from(users)
    .orderBy(users.id);

  // Una consulta por tabla (no por usuario): 8 viajes en total en lugar de 8
  // por cada cuenta. Con la base en Oregón cada viaje son ~165 ms, y eso se
  // nota en una pantalla que se abre a mirar.
  const filasPorUsuario = new Map<number, number>();
  const detallePorUsuario = new Map<number, Record<string, number>>();
  for (const [etiqueta, columnaDueño] of TABLAS_DE_USO) {
    const filas = await db
      .select({ uid: columnaDueño, n: sql<number>`count(*)` })
      .from(columnaDueño.table)
      .groupBy(columnaDueño);
    for (const f of filas) {
      const uid = Number(f.uid);
      const n = Number(f.n);
      if (!Number.isFinite(uid) || !n) continue;
      filasPorUsuario.set(uid, (filasPorUsuario.get(uid) ?? 0) + n);
      const detalle = detallePorUsuario.get(uid) ?? {};
      detalle[etiqueta] = n;
      detallePorUsuario.set(uid, detalle);
    }
  }

  res.json(
    cuentas.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      modules: limpiarModulos(u.modules) ?? MODULOS_POR_DEFECTO,
      lastSeenAt: u.lastSeenAt,
      disabledAt: u.disabledAt,
      createdAt: u.createdAt,
      totpEnabled: u.totpEnabled === 1,
      filas: filasPorUsuario.get(u.id) ?? 0,
      detalle: detallePorUsuario.get(u.id) ?? {},
    })),
  );
}));

// PATCH /api/admin/usuarios/:id  { disabled: boolean }
// Lo único que se puede hacer sobre otra cuenta: abrirle o cerrarle la puerta.
// No se le cambian sus módulos ni su nombre: eso es suyo.
adminModule.patch('/usuarios/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ disabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos incorrectos' });

  const id = Number(req.params.id);
  // Desactivarse a uno mismo deja el portal sin administrador y sin forma de
  // volver a entrar salvo tocando la base a mano.
  if (id === req.userId) return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });

  const [u] = await db.select({ id: users.id, username: users.username }).from(users).where(eq(users.id, id));
  if (!u) return res.status(404).json({ error: 'No existe esa cuenta' });

  await db.update(users).set({ disabledAt: parsed.data.disabled ? new Date() : null }).where(eq(users.id, id));
  olvidarUsuario(id); // que surta efecto ya, sin esperar a que caduque la caché
  res.json({ ok: true });
}));

// ---------- Invitaciones ----------
const DIAS_VALIDEZ = 7;

function huella(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// GET /api/admin/invitaciones — las pendientes y las últimas usadas
adminModule.get('/invitaciones', ah(async (_req: AuthedRequest, res) => {
  const filas = await db
    .select({
      id: invites.id,
      note: invites.note,
      modules: invites.modules,
      expiresAt: invites.expiresAt,
      usedAt: invites.usedAt,
      usedBy: invites.usedBy,
      revokedAt: invites.revokedAt,
      createdAt: invites.createdAt,
      usuario: users.username,
    })
    .from(invites)
    .leftJoin(users, eq(users.id, invites.usedBy))
    .orderBy(sql`${invites.id} desc`)
    .limit(50);

  const ahora = new Date();
  // El token NO se devuelve: solo existe una vez, en el momento de crearlo. Si
  // se pudiera volver a leer, la tabla sería una lista de llaves usables.
  res.json(
    filas.map((f) => ({
      ...f,
      modules: limpiarModulos(f.modules) ?? MODULOS_POR_DEFECTO,
      estado: f.revokedAt
        ? 'anulada'
        : f.usedAt
          ? 'usada'
          : new Date(f.expiresAt) < ahora
            ? 'caducada'
            : 'pendiente',
    })),
  );
}));

// POST /api/admin/invitaciones  { note?, modules? } -> { url }
adminModule.post('/invitaciones', ah(async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ note: z.string().trim().max(120).optional(), modules: z.array(z.string()).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos incorrectos' });

  // 32 bytes al azar: adivinarlo no es una posibilidad práctica, y por eso el
  // enlace puede ir por WhatsApp sin más ceremonia.
  const token = crypto.randomBytes(32).toString('base64url');
  const expira = new Date(Date.now() + DIAS_VALIDEZ * 24 * 60 * 60 * 1000);
  const modulos = limpiarModulos(parsed.data.modules) ?? MODULOS_POR_DEFECTO;

  await db.insert(invites).values({
    tokenHash: huella(token),
    note: parsed.data.note || null,
    modules: aTexto(modulos),
    createdBy: req.userId!,
    expiresAt: expira,
  });

  // Sin `await`: el aviso manda un correo, y la respuesta NO puede esperar a
  // que el servidor de correo conteste. Esperándolo, crear una invitación se
  // quedaba colgada minutos: la fila se guardaba y el enlace no llegaba nunca
  // a la pantalla. El registro se hace igual, solo que por detrás.
  void logSecurityEvent('invitacion_creada', req, `invitación creada${parsed.data.note ? `: ${parsed.data.note}` : ''}`);

  // La dirección se arma con el origen del portal, no con el de la API.
  const base = (process.env.CORS_ORIGIN ?? '').split(',')[0].trim() || 'http://localhost:5173';
  res.status(201).json({ url: `${base}/invitacion/${token}`, expiresAt: expira });
}));

// DELETE /api/admin/invitaciones/:id — anular una pendiente
// No se borra la fila: queda el rastro de que se creó y se anuló.
adminModule.delete('/invitaciones/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [inv] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.id, id), isNull(invites.usedAt), isNull(invites.revokedAt)));
  if (!inv) return res.status(404).json({ error: 'Esa invitación ya no está pendiente' });

  await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, id));
  res.json({ ok: true });
}));
