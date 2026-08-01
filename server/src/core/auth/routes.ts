import { Router } from 'express';
import { ah } from '../../lib/async';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { securityEvents, users } from '../../db/schema';
import { bumpTokenVersion, requireAuth, type AuthedRequest } from './middleware';
import { clientIp, esOrigenNuevo, logSecurityEvent } from '../../lib/security';
import { z } from 'zod';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

export const authRouter = Router();

// Firmamos y verificamos siempre con el mismo algoritmo (nada de negociación)
function signToken(userId: number, tokenVersion: number): string {
  return jwt.sign({ sub: String(userId), tv: tokenVersion }, process.env.JWT_SECRET as string, {
    algorithm: 'HS256',
    expiresIn: '30d',
  });
}

// POST /api/auth/login  { username, password } -> { token }
authRouter.post('/login', ah(async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Faltan usuario o contraseña' });
  }
  const [user] = await db.select().from(users).where(eq(users.username, username));
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    await logSecurityEvent('login_fallido', req, `usuario probado: ${username.slice(0, 40)}`);
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  // Segundo factor: si está activado, la contraseña sola no basta
  if (user.totpEnabled === 1) {
    const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\s/g, '') : '';
    if (!code) {
      // el front usa esta marca para pedir el código sin dar por fallido el intento
      return res.status(401).json({ error: 'Falta el código de verificación', need2fa: true });
    }
    if (!verificarTotp(user.totpSecret, code)) {
      await logSecurityEvent('login_fallido', req, 'contraseña correcta pero código de verificación incorrecto');
      return res.status(401).json({ error: 'Código de verificación incorrecto', need2fa: true });
    }
  }

  // Aviso inmediato si es la primera vez que se entra desde esta IP
  const ip = clientIp(req);
  if (await esOrigenNuevo(ip)) {
    await logSecurityEvent('login_nuevo_origen', req, 'acceso correcto desde una IP no vista antes');
  }
  res.json({ token: signToken(user.id, user.tokenVersion), username: user.username });
}));

// ---------- Bitácora de seguridad (para verla desde el portal) ----------
authRouter.get('/security-events', requireAuth, ah(async (_req: AuthedRequest, res) => {
  const filas = await db
    .select({
      id: securityEvents.id,
      kind: securityEvents.kind,
      severity: securityEvents.severity,
      ip: securityEvents.ip,
      detail: securityEvents.detail,
      createdAt: securityEvents.createdAt,
    })
    .from(securityEvents)
    .orderBy(desc(securityEvents.id))
    .limit(60);
  res.json(filas);
}));

// ---------- Contraseña ----------
// Cambiarla invalida las demás sesiones: si alguien tenía una, deja de valer.
authRouter.post('/change-password', requireAuth, ah(async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ current: z.string().min(1), next: z.string().min(12, 'La nueva contraseña debe tener al menos 12 caracteres').max(200) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!(await bcrypt.compare(parsed.data.current, user.passwordHash))) {
    await logSecurityEvent('login_fallido', req, 'contraseña actual incorrecta al intentar cambiarla');
    return res.status(401).json({ error: 'La contraseña actual no es correcta' });
  }

  const nextVersion = user.tokenVersion + 1;
  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(parsed.data.next, 12), tokenVersion: nextVersion })
    .where(eq(users.id, user.id));
  bumpTokenVersion(user.id, nextVersion);
  await logSecurityEvent('contrasena_cambiada', req, 'contraseña cambiada desde el portal');
  res.json({ token: signToken(user.id, nextVersion) });
}));

// ---------- Segundo factor (app autenticadora) ----------
function verificarTotp(secretBase32: string | null, code: string): boolean {
  if (!secretBase32) return false;
  const totp = new OTPAuth.TOTP({
    issuer: 'Aa Portal',
    label: 'Aa Portal',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  // ventana de ±1 periodo: tolera un reloj algo desfasado
  return totp.validate({ token: code, window: 1 }) !== null;
}

authRouter.get('/2fa/status', requireAuth, ah(async (req: AuthedRequest, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  res.json({ enabled: user?.totpEnabled === 1 });
}));

// Genera un secreto nuevo (aún sin activar) y su QR para la app autenticadora
authRouter.post('/2fa/setup', requireAuth, ah(async (req: AuthedRequest, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (user.totpEnabled === 1) return res.status(400).json({ error: 'El segundo factor ya está activado' });

  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const uri = new OTPAuth.TOTP({
    issuer: 'Aa Portal',
    label: user.username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).toString();

  await db.update(users).set({ totpSecret: secret }).where(eq(users.id, user.id));
  // QR como data URI: la política de contenido del portal permite img data:
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
  res.json({ secret, uri, qr });
}));

// Confirma que la app genera códigos válidos y lo deja activado
authRouter.post('/2fa/enable', requireAuth, ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ code: z.string().min(6).max(10) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Falta el código' });
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user?.totpSecret) return res.status(400).json({ error: 'Pide primero el código QR' });
  if (!verificarTotp(user.totpSecret, parsed.data.code.replace(/\s/g, ''))) {
    return res.status(400).json({ error: 'El código no coincide. Comprueba la hora del móvil e inténtalo otra vez.' });
  }
  await db.update(users).set({ totpEnabled: 1 }).where(eq(users.id, user.id));
  await logSecurityEvent('2fa_activado', req, 'segundo factor activado');
  res.json({ enabled: true });
}));

// Desactivarlo exige contraseña Y código: que un token robado no baste
authRouter.post('/2fa/disable', requireAuth, ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ password: z.string().min(1), code: z.string().min(6).max(10) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Hacen falta la contraseña y el código' });
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    await logSecurityEvent('login_fallido', req, 'contraseña incorrecta al intentar desactivar el segundo factor');
    return res.status(401).json({ error: 'La contraseña no es correcta' });
  }
  if (!verificarTotp(user.totpSecret, parsed.data.code.replace(/\s/g, ''))) {
    return res.status(400).json({ error: 'El código no es correcto' });
  }
  await db.update(users).set({ totpEnabled: 0, totpSecret: null }).where(eq(users.id, user.id));
  await logSecurityEvent('2fa_desactivado', req, 'segundo factor desactivado');
  res.json({ enabled: false });
}));

// Cerrar sesión en TODOS los dispositivos: sube la versión (invalida los tokens
// emitidos) y devuelve uno nuevo para no echar al dispositivo actual.
authRouter.post('/revoke-all', requireAuth, ah(async (req: AuthedRequest, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const nextVersion = user.tokenVersion + 1;
  await db.update(users).set({ tokenVersion: nextVersion }).where(eq(users.id, user.id));
  bumpTokenVersion(user.id, nextVersion);
  await logSecurityEvent('sesiones_revocadas', req, 'se han invalidado las sesiones de todos los dispositivos');
  res.json({ token: signToken(user.id, nextVersion) });
}));
