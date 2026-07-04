import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './core/auth/routes';
import { requireAuth } from './core/auth/middleware';
import { tasksModule } from './modules/tasks';

const app = express();

const origins = (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));
app.use(express.json());

// Passenger (cPanel) monta la app bajo /api y recorta ese prefijo del path.
// Normalizamos para que las rutas /api/... funcionen igual en dev y en producción.
app.use((req, _res, next) => {
  if (!req.url.startsWith('/api')) req.url = `/api${req.url === '/' ? '' : req.url}`;
  next();
});

// Público
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);

// Módulos (todos protegidos por login). Añadir un módulo = una línea más aquí.
app.use('/api', requireAuth, tasksModule);

// Errores no controlados -> 500 JSON
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API escuchando en http://localhost:${port}`));
