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
    // No registrar dos veces la misma llave EN ESTE DISPOSITIVO. El matiz de
    // `internal` importa: sin él, el navegador puede ponerse a buscar la llave
    // por el móvil para comprobar si ya la tienes, y en el Mac eso se queda
    // colgado —«no carga»— cuando la llave vive solo en el iPhone. Con la
    // pista, mira su propio llavero y si no está, deja registrar una nueva.
    excludeCredentials: previas.map((c) => ({ id: c.credentialId, transports: ['internal' as Transporte] })),
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
 * Desbloquear la app (ya hay sesión, solo está tapada por el bloqueo).
 *
 * Aquí SÍ se dice qué llaves valen. Al concretarlas, el iPhone va directo a
 * Face ID en vez de abrir primero la hoja de «elige una llave»: sabe que solo
 * hay una opción posible. En la entrada sin sesión no se puede hacer esto,
 * porque decir qué credenciales existen antes de identificarse sería filtrar
 * información a cualquiera.
 */
// El tipo de transporte se saca de la propia firma de la librería: importarlo
// por una ruta interna del paquete se rompería en la próxima actualización.
type Transporte = NonNullable<
  NonNullable<Parameters<typeof generateAuthenticationOptions>[0]['allowCredentials']>[number]['transports']
>[number];

passkeysRouter.post('/passkeys/unlock/options', requireAuth, ah(async (req: AuthedRequest, res) => {
  const r = await opcionesDeLlave(req.userId!, req.body?.otro === true);
  if (!r) return res.status(400).json({ error: 'No tienes ninguna llave registrada' });
  res.json(r);
}));

/**
 * Las opciones para pedir Face ID a un usuario que YA tiene sesión.
 *
 * Lo usa el desbloqueo de la app y también el módulo Persona, que pide la
 * llave otra vez para abrirse. Está aquí y no duplicado allí porque esto es
 * criptografía: una copia mal hecha es un agujero.
 */
export async function opcionesDeLlave(userId: number, otroDispositivo = false) {
  const llaves = await db
    .select({ credentialId: webauthnCredentials.credentialId, transports: webauthnCredentials.transports })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
  if (!llaves.length) return null;

  const options = await generateAuthenticationOptions({
    rpID: rpID(),
    userVerification: 'required',
    allowCredentials: llaves.map((k) => {
      const transportes = k.transports?.split(',').filter(Boolean) ?? [];
      // Por defecto, si la llave vive en el dispositivo se ofrece SOLO esa vía:
      // dejar también 'hybrid' hace que el iPhone pregunte «¿esta o otro
      // dispositivo?» en vez de ir derecho a Face ID.
      //
      // Pero eso deja tirado al ordenador que NO tiene la llave en su llavero:
      // el navegador dice «no tienes llaves de acceso» y no hay salida. Para
      // eso está `otroDispositivo`: se ofrecen todas las vías y aparece el
      // código QR para firmar con el iPhone.
      const vias = otroDispositivo || !transportes.includes('internal') ? transportes : ['internal'];
      return {
        id: k.credentialId,
        transports: (vias.length ? vias : undefined) as Transporte[] | undefined,
      };
    }),
  });
  return { flowId: abrirFlujo(options.challenge), options };
}

/**
 * ¿Ha firmado ESTE usuario con una llave suya?
 *
 * Devuelve true solo si el reto era el que dimos, la firma es válida y la
 * credencial pertenece al usuario que pregunta. Es lo que usa Persona para
 * abrirse: comprobar la sesión no basta, ahí hace falta el dedo o la cara.
 */
export async function verificarLlaveDe(
  userId: number,
  flowId: string,
  response: unknown,
): Promise<boolean> {
  const flujo = cerrarFlujo(flowId);
  if (!flujo) return false;

  const credentialId = String((response as { id?: string })?.id ?? '');
  const [cred] = await db
    .select()
    .from(webauthnCredentials)
    .where(and(eq(webauthnCredentials.credentialId, credentialId), eq(webauthnCredentials.userId, userId)));
  if (!cred) return false;

  const verificacion = await verifyAuthenticationResponse({
    response: response as never,
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

  if (!verificacion?.verified) return false;

  await db
    .update(webauthnCredentials)
    .set({ counter: verificacion.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(webauthnCredentials.id, cred.id));
  return true;
}

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
