import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './core/auth/routes';
import { requireAuth } from './core/auth/middleware';
import { tasksModule } from './modules/tasks';
import { autonomoModule } from './modules/autonomo';
import { eventsModule } from './modules/events';

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
app.use('/api/autonomo', requireAuth, autonomoModule);
app.use('/api/events', requireAuth, eventsModule);

// Errores no controlados -> 500 JSON
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API escuchando en http://localhost:${port}`));

// Despertador interno (Render free se duerme a los ~15 min sin tráfico):
// la propia API se hace ping cada 10 min. Siesta 1:00-6:00 en hora de Madrid
// (robusto ante cambios de horario). GitHub Actions hace de alarma de las 6:00.
const selfPingUrl = process.env.SELF_PING_URL;
if (selfPingUrl) {
  setInterval(() => {
    const hour = Number(
      new Intl.DateTimeFormat('es-ES', { hour: 'numeric', hour12: false, timeZone: 'Europe/Madrid' }).format(new Date()),
    );
    if (hour >= 1 && hour < 6) return; // siesta nocturna
    fetch(selfPingUrl).catch(() => {});
  }, 10 * 60 * 1000);
  console.log('Despertador interno activo (siesta 1:00-6:00 Madrid)');
}
