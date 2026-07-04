import { Router } from 'express';
import { ah } from '../../lib/async';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { users } from '../../db/schema';

export const authRouter = Router();

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
  const token = jwt.sign({ sub: String(user.id) }, process.env.JWT_SECRET as string, {
    expiresIn: '30d',
  });
  res.json({ token, username: user.username });
}));
