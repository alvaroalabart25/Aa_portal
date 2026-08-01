import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { users, webauthnCredentials } from '../../db/schema';
import { requireAuth, type AuthedRequest } from './middleware';
import { clientIp, esOrigenNuevo, logSecurityEvent } from '../../lib/security';

// Passkeys: entrar con Face ID / Touch ID sin escribir nada.
//
// La llave privada vive en el llavero del dispositivo y nunca sale de ahí;
// aquí solo guardamos la pública. Como la credencial está atada al dominio,
// una web falsa no puede usarla: es resistente a phishing, algo que ni la
// contraseña ni el código de 6 dígitos consiguen.

export const passkeysRouter = Router();

// Dominio al que se atan las llaves. En producción, el del front.
function rpID(): string {
  if (process.env.WEBAUTHN_RP_ID) return process.env.WEBAUTHN_RP_ID;
  const front = process.env.FRONT_URL;
  if (front) {
    try {
      return new URL(front).hostname;
    } catch {
      /* configuración rara: caemos a localhost */
    }
  }
  return 'localhost';
}

// Orígenes que aceptamos en la verificación (dev incluye los puertos de Vite)
function origenesValidos(): string[] {
  const extra = (process.env.WEBAUTHN_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (extra.length) return extra;
  const front = process.env.FRONT_URL;
  if (front) return [front.replace(/\/$/, '')];
  return ['http://localhost:5173', 'http://localhost:4173'];
}

// Los retos son de un solo uso y caducan pronto. Un Map basta: si el proceso
// se reinicia, el usuario simplemente vuelve a pulsar el botón.
interface Flujo {
  challenge: string;
  userId?: number;
  expira: number;
}
const flujos = new Map<string, Flujo>();
const FLUJO_MS = 3 * 60_000;

function abrirFlujo(challenge: string, userId?: number): string {
  const id = crypto.randomBytes(16).toString('base64url');
  flujos.set(id, { challenge, userId, expira: Date.now() + FLUJO_MS });
  // limpieza de los caducados, para que el Map no crezca
  for (const [k, v] of flujos) if (v.expira < Date.now()) flujos.delete(k);
  return id;
}

function cerrarFlujo(id: string): Flujo | null {
  const f = flujos.get(id);
  flujos.delete(id); // un reto, un uso
  if (!f || f.expira < Date.now()) return null;
  return f;
}

// ---------- Registrar una llave nueva (con sesión abierta) ----------
passkeysRouter.post('/passkeys/register/options', requireAuth, ah(async (req: AuthedRequest, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const previas = await db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, user.id));

  const options = await generateRegistrationOptions({
    rpName: 'Aa Portal',
    rpID: rpID(),
    userName: user.username,
    userDisplayName: user.username,
    attestationType: 'none',
    // no permitimos registrar dos veces la misma llave
    excludeCredentials: previas.map((c) => ({ id: c.credentialId })),
    authenticatorSelection: {
      residentKey: 'required', // así se puede entrar sin escribir el usuario
      userVerification: 'required', // exige Face ID / huella, no solo presencia
    },
  });

  res.json({ flowId: abrirFlujo(options.challenge, user.id), options });
}));

passkeysRouter.post('/passkeys/register/verify', requireAuth, ah(async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ flowId: z.string().min(1), response: z.any(), name: z.string().trim().max(80).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos incompletos' });

  const flujo = cerrarFlujo(parsed.data.flowId);
  if (!flujo || flujo.userId !== req.userId) return res.status(400).json({ error: 'El registro ha caducado, inténtalo otra vez' });

  const verificacion = await verifyRegistrationResponse({
    response: parsed.data.response,
    expectedChallenge: flujo.challenge,
    expectedOrigin: origenesValidos(),
    expectedRPID: rpID(),
    requireUserVerification: true,
  }).catch(() => null);

  if (!verificacion?.verified || !verificacion.registrationInfo) {
    return res.status(400).json({ error: 'No se pudo verificar la llave' });
  }

  const { credential } = verificacion.registrationInfo;
  await db.insert(webauthnCredentials).values({
    userId: req.userId!,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64'),
    counter: credential.counter,
    transports: credential.transports?.join(',') ?? null,
    deviceName: parsed.data.name?.trim() || 'Este dispositivo',
  });

  await logSecurityEvent('passkey_registrada', req, `llave registrada: ${parsed.data.name?.slice(0, 40) ?? 'este dispositivo'}`);
  res.status(201).json({ ok: true });
}));

// ---------- Listar y borrar ----------
passkeysRouter.get('/passkeys', requireAuth, ah(async (req: AuthedRequest, res) => {
  const filas = await db
    .select({
      id: webauthnCredentials.id,
      deviceName: webauthnCredentials.deviceName,
      createdAt: webauthnCredentials.createdAt,
      lastUsedAt: webauthnCredentials.lastUsedAt,
    })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, req.userId!));
  res.json(filas);
}));

passkeysRouter.delete('/passkeys/:id', requireAuth, ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .delete(webauthnCredentials)
    .where(and(eq(webauthnCredentials.id, id), eq(webauthnCredentials.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Llave no encontrada' });
  await logSecurityEvent('passkey_borrada', req, `llave eliminada (id ${id})`);
  res.json({ deleted: true });
}));

// ---------- Entrar con Face ID (sin sesión previa) ----------
passkeysRouter.post('/passkeys/login/options', ah(async (_req, res) => {
  const options = await generateAuthenticationOptions({
    rpID: rpID(),
    userVerification: 'required',
    // sin allowCredentials: el dispositivo ofrece las llaves que tenga para este dominio
  });
  res.json({ flowId: abrirFlujo(options.challenge), options });
}));

/**
 * Verifica la firma y devuelve la sesión. Sirve tanto para entrar como para
 * desbloquear la app: en los dos casos el resultado es un token nuevo.
 */
passkeysRouter.post('/passkeys/login/verify', ah(async (req, res) => {
  const parsed = z.object({ flowId: z.string().min(1), response: z.any() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos incompletos' });

  const flujo = cerrarFlujo(parsed.data.flowId);
  if (!flujo) return res.status(400).json({ error: 'El intento ha caducado, prueba otra vez' });

  const credentialId = String(parsed.data.response?.id ?? '');
  const [cred] = await db.select().from(webauthnCredentials).where(eq(webauthnCredentials.credentialId, credentialId));
  if (!cred) {
    await logSecurityEvent('token_invalido', req, 'intento de entrar con una llave desconocida');
    return res.status(401).json({ error: 'Llave no reconocida' });
  }

  const verificacion = await verifyAuthenticationResponse({
    response: parsed.data.response,
    expectedChallenge: flujo.challenge,
    expectedOrigin: origenesValidos(),
    expectedRPID: rpID(),
    requireUserVerification: true,
    credential: {
      id: cred.credentialId,
      publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64')),
      counter: cred.counter,
      transports: (cred.transports?.split(',') as never) ?? undefined,
    },
  }).catch(() => null);

  if (!verificacion?.verified) {
    await logSecurityEvent('login_fallido', req, 'firma de la llave de acceso inválida');
    return res.status(401).json({ error: 'No se pudo verificar' });
  }

  // El contador creciente delata una llave clonada
  await db
    .update(webauthnCredentials)
    .set({ counter: verificacion.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(webauthnCredentials.id, cred.id));

  const [user] = await db.select().from(users).where(eq(users.id, cred.userId));
  if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

  if (await esOrigenNuevo(clientIp(req))) {
    await logSecurityEvent('login_nuevo_origen', req, 'acceso con llave de acceso desde una IP no vista antes');
  }

  res.json({ token: firmarToken(user.id, user.tokenVersion), username: user.username });
}));

// Se inyecta desde routes.ts para no duplicar la firma del token
let firmarToken: (userId: number, tokenVersion: number) => string = () => {
  throw new Error('firmarToken no inicializado');
};
export function usarFirmador(fn: (userId: number, tokenVersion: number) => string) {
  firmarToken = fn;
}
