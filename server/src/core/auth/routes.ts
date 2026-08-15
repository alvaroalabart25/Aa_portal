import { Router } from 'express';
import { ah } from '../../lib/async';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { and, isNull, gt } from 'drizzle-orm';
import { invites, passwordResets, securityEvents, totpRecoveryCodes, users } from '../../db/schema';
import { aTexto, limpiarModulos, MODULOS_POR_DEFECTO } from '../modulos';
import { enviarCorreo } from '../../lib/mail';
import { passkeysRouter, usarFirmador } from './passkeys';
import { bumpTokenVersion, requireAdmin, requireAuth, type AuthedRequest } from './middleware';
import { clientIp, esOrigenNuevo, logSecurityEvent } from '../../lib/security';
import { z } from 'zod';
import crypto from 'crypto';
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

// Las passkeys viven en su propio fichero pero comparten la firma del token
usarFirmador(signToken);
authRouter.use(passkeysRouter);

// POST /api/auth/login  { username, password } -> { token }
authRouter.post('/login', ah(async (req, res) => {
  const { username: crudo, password } = req.body ?? {};
  if (typeof crudo !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Faltan usuario o contraseña' });
  }
  // En minúsculas SIEMPRE: el alta ya guarda así, pero la columna es
  // utf8mb4_bin (distingue mayúsculas) y el teclado del iPhone pone mayúscula
  // la primera letra él solo. Sin esto, «Jose@…» no encuentra a «jose@…» y
  // sale «credenciales incorrectas» CON la contraseña buena.
  const username = crudo.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.username, username));
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    await logSecurityEvent('login_fallido', req, `usuario probado: ${username.slice(0, 40)}`);
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  // Cuenta desactivada: se dice claro. Sus datos siguen ahí, la puerta no.
  if (user.disabledAt) {
    return res.status(403).json({ error: 'Esta cuenta está desactivada' });
  }

  // Segundo factor: si está activado, la contraseña sola no basta
  if (user.totpEnabled === 1) {
    const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\s/g, '') : '';
    if (!code) {
      // el front usa esta marca para pedir el código sin dar por fallido el intento
      return res.status(401).json({ error: 'Falta el código de verificación', need2fa: true });
    }
    if (!verificarTotp(user.totpSecret, code)) {
      // Puede ser un código de recuperación: se gasta y se avisa, porque usar
      // uno significa que algo ha pasado con el móvil (o que no eres tú).
      if (await usarCodigoDeRecuperacion(user.id, code)) {
        const [quedan] = [
          await db
            .select({ id: totpRecoveryCodes.id })
            .from(totpRecoveryCodes)
            .where(and(eq(totpRecoveryCodes.userId, user.id), isNull(totpRecoveryCodes.usedAt))),
        ];
        await logSecurityEvent(
          'codigo_recuperacion_usado',
          req,
          `se ha entrado con un código de recuperación; quedan ${quedan.length}`,
        );
      } else {
        await logSecurityEvent('login_fallido', req, 'contraseña correcta pero código de verificación incorrecto');
        return res.status(401).json({ error: 'Código de verificación incorrecto', need2fa: true });
      }
    }
  }

  // Aviso inmediato si es la primera vez que se entra desde esta IP
  const ip = clientIp(req);
  if (await esOrigenNuevo(ip)) {
    await logSecurityEvent('login_nuevo_origen', req, 'acceso correcto desde una IP no vista antes');
  }
  res.json({ token: signToken(user.id, user.tokenVersion), username: user.username });
}));

// ---------- Olvidé mi contraseña ----------
// Del enlace solo se guarda su huella (como una contraseña), así que ni con la
// base delante se puede usar. Caduca en 30 min, sirve una sola vez, y pedir uno
// nuevo anula los anteriores. La respuesta es siempre la misma exista o no la
// cuenta: si no, este endpoint sería una forma de averiguar quién está dado de alta.
const VENTANA_MIN = 30;

function huella(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

authRouter.post('/forgot-password', ah(async (req, res) => {
  const parsed = z.object({ username: z.string().trim().min(1).max(190) }).safeParse(req.body);
  const respuestaNeutra = { ok: true, message: 'Si la cuenta existe, te llega un correo con el enlace.' };
  if (!parsed.success) return res.json(respuestaNeutra);

  const dato = parsed.data.username.toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.username, dato));
  if (!user?.email) {
    await logSecurityEvent('login_fallido', req, `recuperación pedida para una cuenta inexistente: ${dato.slice(0, 40)}`);
    return res.json(respuestaNeutra);
  }

  // anula los enlaces anteriores que siguieran vivos
  await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));

  const token = crypto.randomBytes(32).toString('base64url');
  await db.insert(passwordResets).values({
    userId: user.id,
    tokenHash: huella(token),
    ip: clientIp(req),
    expiresAt: new Date(Date.now() + VENTANA_MIN * 60_000),
  });

  const base = (process.env.FRONT_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  const enlace = `${base}/recuperar?token=${token}`;
  await enviarCorreo({
    to: user.email,
    subject: '🔑 Aa Portal · Restablecer tu contraseña',
    text: [
      'Has pedido restablecer la contraseña de tu portal.',
      '',
      'Abre este enlace (caduca en ' + VENTANA_MIN + ' minutos y solo sirve una vez):',
      enlace,
      '',
      'Al usarlo se cerrarán las sesiones de todos tus dispositivos.',
      'Si tienes segundo factor o Face ID, seguirán haciendo falta para entrar.',
      '',
      'Si no has sido tú, ignora este correo: tu contraseña no ha cambiado. Y si te',
      'llegan varios avisos como este, alguien está intentando entrar en tu cuenta.',
    ].join('\n'),
  }).catch((e) => {
    console.error(`[recuperación] no se pudo enviar el correo: ${(e as Error).message.slice(0, 120)}`);
  });

  await logSecurityEvent('recuperacion_solicitada', req, 'se ha enviado un enlace para restablecer la contraseña');
  res.json(respuestaNeutra);
}));

authRouter.post('/reset-password', ah(async (req, res) => {
  const parsed = z
    .object({
      token: z.string().min(20).max(200),
      next: z.string().min(12, 'La nueva contraseña debe tener al menos 12 caracteres').max(200),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const ahora = new Date();
  const [fila] = await db
    .select()
    .from(passwordResets)
    .where(and(eq(passwordResets.tokenHash, huella(parsed.data.token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, ahora)));
  if (!fila) {
    await logSecurityEvent('token_invalido', req, 'enlace de recuperación caducado, ya usado o inventado');
    return res.status(400).json({ error: 'El enlace ya no vale. Pide uno nuevo.' });
  }

  const [user] = await db.select().from(users).where(eq(users.id, fila.userId));
  if (!user) return res.status(400).json({ error: 'El enlace ya no vale' });

  const nextVersion = user.tokenVersion + 1;
  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(parsed.data.next, 12), tokenVersion: nextVersion })
    .where(eq(users.id, user.id));
  await db.update(passwordResets).set({ usedAt: ahora }).where(eq(passwordResets.id, fila.id));
  bumpTokenVersion(user.id, nextVersion);

  await logSecurityEvent('contrasena_restablecida', req, 'contraseña restablecida con el enlace del correo');
  // El segundo factor sigue vigente: restablecer la contraseña no lo salta
  res.json({ ok: true, need2fa: user.totpEnabled === 1 });
}));

// ---------- Bitácora de seguridad (para verla desde el portal) ----------
// La bitácora vive en su propia pantalla, así que puede pedir más de una
// pantallazo. Tope duro de 300: es un registro para mirar cuando algo huele
// mal, no un archivo histórico que haya que paginar.
// Solo el administrador: la bitácora es del portal entero (IPs, navegadores,
// intentos fallidos de cualquiera), no de una cuenta. Con varias personas
// dentro, dejarla abierta sería enseñar los movimientos de las demás.
authRouter.get('/security-events', requireAuth, requireAdmin, ah(async (req: AuthedRequest, res) => {
  const pedido = Number(req.query.limit);
  const limite = Number.isFinite(pedido) ? Math.min(Math.max(Math.trunc(pedido), 1), 300) : 60;
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
    .limit(limite);
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

/**
 * Códigos de recuperación: la salida de emergencia del segundo factor.
 *
 * Sin ellos, perder el móvil con la app autenticadora deja fuera del portal,
 * porque el correo de recuperación cambia la contraseña pero NO quita el
 * segundo factor. Se guarda solo la huella de cada código y sirve una vez.
 */
const CODIGOS_POR_TANDA = 8;
// Sin I, O, 0 ni 1: se van a copiar a mano y esos caracteres se confunden
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generarCodigo(): string {
  const bytes = crypto.randomBytes(10);
  const cuerpo = [...bytes].map((b) => ALFABETO[b % ALFABETO.length]).join('');
  return `${cuerpo.slice(0, 5)}-${cuerpo.slice(5)}`;
}

function normalizarCodigo(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function huellaCodigo(v: string): string {
  return crypto.createHash('sha256').update(normalizarCodigo(v)).digest('hex');
}

/** Rehace la tanda entera: los anteriores dejan de valer. */
async function nuevaTandaDeCodigos(userId: number): Promise<string[]> {
  await db.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, userId));
  const codigos = Array.from({ length: CODIGOS_POR_TANDA }, generarCodigo);
  await db.insert(totpRecoveryCodes).values(codigos.map((c) => ({ userId, codeHash: huellaCodigo(c) })));
  return codigos;
}

/** Gasta un código si es válido. Devuelve true solo si lo ha consumido. */
async function usarCodigoDeRecuperacion(userId: number, code: string): Promise<boolean> {
  const normalizado = normalizarCodigo(code);
  if (normalizado.length !== 10) return false;
  const [fila] = await db
    .select({ id: totpRecoveryCodes.id })
    .from(totpRecoveryCodes)
    .where(
      and(
        eq(totpRecoveryCodes.userId, userId),
        eq(totpRecoveryCodes.codeHash, huellaCodigo(normalizado)),
        isNull(totpRecoveryCodes.usedAt),
      ),
    );
  if (!fila) return false;
  // el UPDATE condicionado a que siga sin usar evita gastarlo dos veces si
  // llegan dos intentos a la vez
  const [result] = await db
    .update(totpRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(totpRecoveryCodes.id, fila.id), isNull(totpRecoveryCodes.usedAt)));
  return result.affectedRows === 1;
}

authRouter.get('/2fa/status', requireAuth, ah(async (req: AuthedRequest, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  const restantes = await db
    .select({ id: totpRecoveryCodes.id })
    .from(totpRecoveryCodes)
    .where(and(eq(totpRecoveryCodes.userId, req.userId!), isNull(totpRecoveryCodes.usedAt)));
  res.json({ enabled: user?.totpEnabled === 1, recoveryLeft: restantes.length });
}));

// Rehacer la tanda de códigos (por ejemplo si se pierden o se gastan)
authRouter.post('/2fa/recovery-codes', requireAuth, ah(async (req: AuthedRequest, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (user?.totpEnabled !== 1) return res.status(400).json({ error: 'El segundo factor no está activado' });
  const codigos = await nuevaTandaDeCodigos(user.id);
  await logSecurityEvent('codigos_recuperacion_nuevos', req, 'se han generado códigos de recuperación nuevos');
  res.json({ codes: codigos });
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
  const codigos = await nuevaTandaDeCodigos(user.id);
  await logSecurityEvent('2fa_activado', req, 'segundo factor activado');
  // Los códigos se devuelven UNA vez: después solo queda su huella
  res.json({ enabled: true, codes: codigos });
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
  await db.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, user.id));
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

// ---------- Perfil propio ----------
// Lo que el portal necesita saber de ti para pintarse: cómo te llamas, si
// administras y qué módulos tienes puestos.
authRouter.get('/me', requireAuth, ah(async (req: AuthedRequest, res) => {
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      modules: users.modules,
      guidedSeen: users.guidedSeen,
    })
    .from(users)
    .where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    // Una cuenta antigua sin elegir se queda con los de por defecto, no vacía:
    // un menú en blanco parece un portal roto.
    modules: limpiarModulos(user.modules) ?? MODULOS_POR_DEFECTO,
    // pantallas cuya guía de primera vez ya vio
    guiadoVisto: user.guidedSeen ? user.guidedSeen.split(',').filter(Boolean) : [],
  });
}));

authRouter.patch('/me', requireAuth, ah(async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      displayName: z.string().trim().max(80).optional(),
      modules: z.array(z.string()).optional(),
      // guía contextual: la lista completa de pantallas ya vistas
      guiadoVisto: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(40).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos incorrectos' });

  const cambios: { displayName?: string | null; modules?: string; guidedSeen?: string } = {};
  if (parsed.data.displayName !== undefined) cambios.displayName = parsed.data.displayName || null;
  if (parsed.data.modules !== undefined) {
    const limpios = limpiarModulos(parsed.data.modules);
    // Dejarlo todo apagado no es una preferencia, es quedarse sin portal.
    if (!limpios) return res.status(400).json({ error: 'Deja al menos un módulo activo' });
    cambios.modules = aTexto(limpios);
  }
  if (parsed.data.guiadoVisto !== undefined) {
    cambios.guidedSeen = [...new Set(parsed.data.guiadoVisto)].join(',').slice(0, 600);
  }
  if (!Object.keys(cambios).length) return res.status(400).json({ error: 'Nada que cambiar' });

  await db.update(users).set(cambios).where(eq(users.id, req.userId!));
  res.json({ ok: true });
}));

// ---------- Alta por invitación ----------
// No hay registro abierto: se entra con un enlace que caduca y se gasta una vez.
// Se comprueba por la huella del token, igual que la recuperación de contraseña.

/** Busca la invitación de un token y dice por qué no vale, si no vale. */
async function invitacionDe(token: string) {
  if (typeof token !== 'string' || token.length < 20) return { error: 'Esta invitación no es válida' as const };
  const [inv] = await db.select().from(invites).where(eq(invites.tokenHash, huella(token)));
  if (!inv) return { error: 'Esta invitación no es válida' as const };
  if (inv.revokedAt) return { error: 'Esta invitación se ha anulado' as const };
  if (inv.usedAt) return { error: 'Esta invitación ya se ha usado' as const };
  if (new Date(inv.expiresAt) < new Date()) return { error: 'Esta invitación ha caducado' as const };
  return { inv };
}

// GET /api/auth/invitacion/:token -> ¿sirve este enlace?
// Público a propósito: la pantalla de alta tiene que poder decir «caducada» en
// vez de dejar rellenar un formulario que va a fallar al final.
authRouter.get('/invitacion/:token', ah(async (req, res) => {
  const r = await invitacionDe(req.params.token);
  if ('error' in r) {
    await logSecurityEvent('invitacion_invalida', req, `invitación rechazada: ${r.error}`);
    return res.status(404).json({ error: r.error });
  }
  res.json({
    ok: true,
    // Ni quién invitó ni para quién era: eso es una nota interna del portal.
    modules: limpiarModulos(r.inv.modules) ?? MODULOS_POR_DEFECTO,
    expiresAt: r.inv.expiresAt,
  });
}));

// POST /api/auth/registro { token, username, password, displayName?, modules? }
authRouter.post('/registro', ah(async (req, res) => {
  const parsed = z
    .object({
      token: z.string().min(20).max(200),
      // El usuario es con lo que se entra: sin espacios ni mayúsculas para que
      // nadie se quede fuera por escribirlo distinto al teclear en el móvil.
      username: z
        .string()
        .trim()
        .toLowerCase()
        .min(3, 'El usuario necesita al menos 3 caracteres')
        .max(64)
        .regex(/^[a-z0-9._@-]+$/, 'Usa solo letras, números, punto, guion, guion bajo o @'),
      password: z.string().min(12, 'La contraseña debe tener al menos 12 caracteres').max(200),
      displayName: z.string().trim().max(80).optional(),
      modules: z.array(z.string()).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const r = await invitacionDe(parsed.data.token);
  if ('error' in r) {
    await logSecurityEvent('invitacion_invalida', req, `alta rechazada: ${r.error}`);
    return res.status(404).json({ error: r.error });
  }

  const [ocupado] = await db.select({ id: users.id }).from(users).where(eq(users.username, parsed.data.username));
  if (ocupado) return res.status(409).json({ error: 'Ese usuario ya está cogido, prueba con otro' });

  const modulos = limpiarModulos(parsed.data.modules) ?? limpiarModulos(r.inv.modules) ?? MODULOS_POR_DEFECTO;
  await db.insert(users).values({
    username: parsed.data.username,
    // El correo se rellena con el usuario si parece un correo: si no, la
    // recuperación de contraseña no tendría a dónde escribir.
    email: parsed.data.username.includes('@') ? parsed.data.username : null,
    displayName: parsed.data.displayName || null,
    role: 'user',
    modules: aTexto(modulos),
    passwordHash: await bcrypt.hash(parsed.data.password, 12),
  });
  const [creado] = await db.select().from(users).where(eq(users.username, parsed.data.username));

  // La invitación se gasta aquí, no antes: si algo falla al crear la cuenta, el
  // enlace tiene que seguir sirviendo.
  await db.update(invites).set({ usedAt: new Date(), usedBy: creado.id }).where(eq(invites.id, r.inv.id));

  // Igual que al invitar: el correo de aviso no puede retrasar la respuesta.
  // Quien acaba de crear su cuenta tiene que entrar, no esperar a un SMTP.
  void logSecurityEvent('cuenta_creada', req, `cuenta nueva: ${creado.username}`);
  res.status(201).json({ token: signToken(creado.id, creado.tokenVersion), username: creado.username });
}));
