import { Router } from 'express';
import { ah } from '../../lib/async';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { users } from '../../db/schema';
import { bumpTokenVersion, requireAuth, type AuthedRequest } from './middleware';

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
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  res.json({ token: signToken(user.id, user.tokenVersion), username: user.username });
}));

// Cerrar sesión en TODOS los dispositivos: sube la versión (invalida los tokens
// emitidos) y devuelve uno nuevo para no echar al dispositivo actual.
authRouter.post('/revoke-all', requireAuth, ah(async (req: AuthedRequest, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const nextVersion = user.tokenVersion + 1;
  await db.update(users).set({ tokenVersion: nextVersion }).where(eq(users.id, user.id));
  bumpTokenVersion(user.id, nextVersion);
  res.json({ token: signToken(user.id, nextVersion) });
}));
