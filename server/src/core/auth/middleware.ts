import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { users } from '../../db/schema';

export interface AuthedRequest extends Request {
  userId?: number;
}

// Versión de sesión en caché: comprobarla contra la base en cada petición
// costaría un viaje extra, así que se guarda 30 s. Al revocar se actualiza al
// instante, de modo que "cerrar en todos los dispositivos" es inmediato.
const CACHE_MS = 30_000;
const cache = new Map<number, { version: number; at: number }>();

export function bumpTokenVersion(userId: number, version: number) {
  cache.set(userId, { version, at: Date.now() });
}

async function currentTokenVersion(userId: number): Promise<number | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.version;
  const [user] = await db.select({ v: users.tokenVersion }).from(users).where(eq(users.id, userId));
  if (!user) return null;
  cache.set(userId, { version: user.v, at: Date.now() });
  return user.v;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const token = header.slice('Bearer '.length);
  let payload: { sub?: number | string; tv?: number };
  try {
    // Algoritmo fijado: no se negocia con lo que traiga el token
    payload = jwt.verify(token, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }) as typeof payload;
  } catch {
    return res.status(401).json({ error: 'Token inválido o caducado' });
  }

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  // Un token emitido antes de la última revocación ya no sirve
  const version = await currentTokenVersion(userId);
  if (version === null || (payload.tv ?? 0) !== version) {
    return res.status(401).json({ error: 'Sesión revocada, vuelve a entrar' });
  }

  req.userId = userId;
  next();
}
