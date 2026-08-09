import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { users } from '../../db/schema';
import { logSecurityEvent } from '../../lib/security';

export interface AuthedRequest extends Request {
  userId?: number;
  userRole?: string;
}

// Versión de sesión en caché: comprobarla contra la base en cada petición
// costaría un viaje extra, así que se guarda 30 s. Al revocar se actualiza al
// instante, de modo que "cerrar en todos los dispositivos" es inmediato.
const CACHE_MS = 30_000;
interface Estado {
  version: number;
  role: string;
  activo: boolean;
  at: number;
}
const cache = new Map<number, Estado>();

export function bumpTokenVersion(userId: number, version: number) {
  const previo = cache.get(userId);
  cache.set(userId, { role: previo?.role ?? 'user', activo: previo?.activo ?? true, version, at: Date.now() });
}

/** Al desactivar o reactivar una cuenta, que surta efecto sin esperar 30 s. */
export function olvidarUsuario(userId: number) {
  cache.delete(userId);
}

async function estadoDeCuenta(userId: number): Promise<Estado | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const [user] = await db
    .select({ v: users.tokenVersion, role: users.role, disabled: users.disabledAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;
  const estado: Estado = { version: user.v, role: user.role, activo: !user.disabled, at: Date.now() };
  cache.set(userId, estado);
  return estado;
}

// Última visita: sirve para saber si una cuenta se usa, no para seguir a nadie.
// Se guarda la fecha y nada más —ni la ruta, ni qué miró— y como mucho una vez
// cada 15 min por persona, para no meter una escritura en cada petición.
const VISITA_MS = 15 * 60 * 1000;
const ultimaVisita = new Map<number, number>();

function anotarVisita(userId: number) {
  const ahora = Date.now();
  if (ahora - (ultimaVisita.get(userId) ?? 0) < VISITA_MS) return;
  ultimaVisita.set(userId, ahora);
  void db
    .update(users)
    .set({ lastSeenAt: new Date() })
    .where(eq(users.id, userId))
    .catch(() => {}); // que no tumbe la petición: es un dato de intendencia
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
  } catch (e) {
    // Un token caducado es normal; una firma inválida es un intento de forjarlo
    const motivo = (e as Error).name === 'TokenExpiredError' ? 'caducado' : 'firma inválida';
    if (motivo !== 'caducado') void logSecurityEvent('token_invalido', req, `token rechazado: ${motivo}`);
    return res.status(401).json({ error: 'Token inválido o caducado' });
  }

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  // Un token emitido antes de la última revocación ya no sirve
  const estado = await estadoDeCuenta(userId);
  if (estado === null || (payload.tv ?? 0) !== estado.version) {
    void logSecurityEvent('sesion_revocada_uso', req, 'se ha usado un token de una sesión ya invalidada');
    return res.status(401).json({ error: 'Sesión revocada, vuelve a entrar' });
  }

  // Cuenta desactivada: el token sigue siendo válido, pero la puerta no.
  if (!estado.activo) {
    void logSecurityEvent('cuenta_desactivada_uso', req, 'petición de una cuenta desactivada');
    return res.status(403).json({ error: 'Esta cuenta está desactivada' });
  }

  req.userId = userId;
  req.userRole = estado.role;
  anotarVisita(userId);
  next();
}

/**
 * Solo el administrador del portal.
 *
 * Administrar es dar de alta y ver CUÁNTO se usa cada cuenta. No es ver los
 * datos de nadie: ninguna ruta detrás de esto lee contenido ajeno, y esa es la
 * regla, no una casualidad de la implementación de hoy.
 */
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.userRole !== 'admin') {
    void logSecurityEvent('acceso_admin_denegado', req, `${req.method} ${req.path} sin ser administrador`);
    return res.status(403).json({ error: 'No autorizado' });
  }
  next();
}
