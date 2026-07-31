import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { authRouter } from './core/auth/routes';
import { requireAuth } from './core/auth/middleware';
import { tasksModule } from './modules/tasks';
import { autonomoModule } from './modules/autonomo';
import { eventsModule } from './modules/events';
import { roadmapModule } from './modules/roadmap';
import { routineModule } from './modules/routine';
import { healthModule } from './modules/health';
import { diaryModule } from './modules/diary';
import { pushModule, pushRunner } from './modules/push';
import { trackModule, trackSetup } from './modules/track';

const app = express();

// Render va detrás de proxy: sin esto el límite de intentos vería una sola IP
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Cabeceras de seguridad. La API solo devuelve JSON, así que la política de
// contenido puede ser máximamente restrictiva.
app.use(
  helmet({
    contentSecurityPolicy: { directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    frameguard: { action: 'deny' },
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'no-referrer' },
  }),
);

// CORS cerrado: si falta la variable en producción, la API no arranca en lugar
// de aceptar peticiones de cualquier origen sin avisar.
const origins = (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!origins.length) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CORS_ORIGIN es obligatorio en producción: sin él la API quedaría abierta a cualquier origen');
  }
  origins.push('http://localhost:5173');
}
app.use(cors({ origin: origins }));
app.use(express.json({ limit: '256kb' }));

// Límites de tráfico: el del login frena la fuerza bruta (es la puerta de
// entrada más probable); el general es un tope de abuso para el resto.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos. Prueba de nuevo en unos minutos.' },
});
const trackLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
const generalLimiter = rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false });
app.use(generalLimiter);

// Passenger (cPanel) monta la app bajo /api y recorta ese prefijo del path.
// Normalizamos para que las rutas /api/... funcionen igual en dev y en producción.
app.use((req, _res, next) => {
  if (!req.url.startsWith('/api')) req.url = `/api${req.url === '/' ? '' : req.url}`;
  next();
});

// Público
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRouter);

// Disparador de notificaciones y control remoto (Atajos iOS): van con secreto
// propio (sin JWT), por eso se montan antes que los módulos protegidos.
app.use('/api/push', pushRunner);
app.use('/api', trackLimiter, trackModule);

// Módulos (todos protegidos por login). Añadir un módulo = una línea más aquí.
app.use('/api', requireAuth, trackSetup);
app.use('/api', requireAuth, tasksModule);
app.use('/api/autonomo', requireAuth, autonomoModule);
app.use('/api/events', requireAuth, eventsModule);
app.use('/api/roadmap', requireAuth, roadmapModule);
app.use('/api/routine', requireAuth, routineModule);
app.use('/api/health-log', requireAuth, healthModule);
app.use('/api/diary', requireAuth, diaryModule);
app.use('/api/push', requireAuth, pushModule);

// Errores no controlados -> 500 JSON
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Solo tipo y mensaje: los errores de mysql2 arrastran la consulta con sus
  // valores, y eso no debe acabar en los logs de la plataforma.
  console.error(`[${req.method} ${req.path}] ${err.name}: ${String(err.message).slice(0, 200)}`);
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
