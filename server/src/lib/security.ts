import type { Request } from 'express';
import { correoConfigurado, enviarCorreo } from './mail';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db';
import { securityEvents } from '../db/schema';

// Avisos de seguridad: todo lo raro queda registrado en la base y, según su
// gravedad, se avisa por correo. Dos reglas que importan:
//  - Nunca un correo por evento: un atacante machacando el login llenaría el
//    buzón (y gastaría la cuota SMTP). Hay enfriamiento por tipo y tope diario.
//  - En el correo nunca van datos personales del portal, solo el hecho, la IP
//    y el navegador.

export type EventKind =
  | 'login_fallido'
  | 'login_nuevo_origen'
  | 'token_invalido'
  | 'sesion_revocada_uso'
  | 'track_token_invalido'
  | 'cron_secreto_invalido'
  | 'limite_trafico'
  | 'origen_no_permitido'
  | 'error_servidor'
  | 'sesiones_revocadas'
  | 'front_modificado'
  | 'contrasena_cambiada'
  | '2fa_activado'
  | '2fa_desactivado'
  | 'passkey_registrada'
  | 'passkey_borrada'
  | 'recuperacion_solicitada'
  | 'contrasena_restablecida'
  | 'codigo_recuperacion_usado'
  | 'codigos_recuperacion_nuevos'
  | 'cuenta_desactivada_uso'
  | 'acceso_admin_denegado'
  | 'invitacion_creada'
  | 'invitacion_invalida'
  | 'cuenta_creada';

interface Regla {
  severidad: 'alta' | 'media' | 'baja';
  // avisa cuando haya N eventos de este tipo en la ventana (1 = al primero)
  umbral: number;
  ventanaMin: number;
  // no repetir aviso del mismo tipo antes de este tiempo
  enfriamientoMin: number;
  asunto: string;
}

const REGLAS: Record<EventKind, Regla> = {
  login_fallido: { severidad: 'media', umbral: 5, ventanaMin: 15, enfriamientoMin: 30, asunto: 'Intentos de acceso fallidos' },
  login_nuevo_origen: { severidad: 'alta', umbral: 1, ventanaMin: 1, enfriamientoMin: 0, asunto: 'Nuevo acceso a tu portal' },
  token_invalido: { severidad: 'media', umbral: 10, ventanaMin: 15, enfriamientoMin: 60, asunto: 'Tokens inválidos contra la API' },
  sesion_revocada_uso: { severidad: 'alta', umbral: 1, ventanaMin: 5, enfriamientoMin: 60, asunto: 'Se ha usado una sesión revocada' },
  track_token_invalido: { severidad: 'alta', umbral: 1, ventanaMin: 5, enfriamientoMin: 60, asunto: 'Token del control remoto incorrecto' },
  cron_secreto_invalido: { severidad: 'alta', umbral: 1, ventanaMin: 5, enfriamientoMin: 60, asunto: 'Secreto del disparador incorrecto' },
  limite_trafico: { severidad: 'media', umbral: 3, ventanaMin: 15, enfriamientoMin: 60, asunto: 'Límite de tráfico alcanzado' },
  origen_no_permitido: { severidad: 'media', umbral: 3, ventanaMin: 15, enfriamientoMin: 60, asunto: 'Peticiones desde un origen no permitido' },
  error_servidor: { severidad: 'baja', umbral: 10, ventanaMin: 15, enfriamientoMin: 120, asunto: 'Errores repetidos en la API' },
  sesiones_revocadas: { severidad: 'alta', umbral: 1, ventanaMin: 1, enfriamientoMin: 0, asunto: 'Se han cerrado todas las sesiones' },
  front_modificado: { severidad: 'alta', umbral: 1, ventanaMin: 1, enfriamientoMin: 60, asunto: 'El portal ha cambiado sin despliegue' },
  contrasena_cambiada: { severidad: 'alta', umbral: 1, ventanaMin: 1, enfriamientoMin: 0, asunto: 'Tu contraseña ha cambiado' },
  '2fa_activado': { severidad: 'alta', umbral: 1, ventanaMin: 1, enfriamientoMin: 0, asunto: 'Segundo factor activado' },
  '2fa_desactivado': { severidad: 'alta', umbral: 1, ventanaMin: 1, enfriamientoMin: 0, asunto: 'Segundo factor DESACTIVADO' },
  passkey_registrada: { severidad: 'alta', umbral: 1, ventanaMin: 1, enfriamientoMin: 0, asunto: 'Nueva llave de acceso (Face ID) registrada' },
  passkey_borrada: { severidad: 'alta', umbral: 1, ventanaMin: 1, enfriamientoMin: 0, asunto: 'Llave de acceso eliminada' },
  recuperacion_solicitada: { severidad: 'alta', umbral: 1, ventanaMin: 1, enfriamientoMin: 0, asunto: 'Alguien ha pedido restablecer tu contraseña' },
  contrasena_restablecida: { severidad: 'alta', umbral: 1, ventanaMin: 1, enfriamientoMin: 0, asunto: 'Tu contraseña se ha restablecido por correo' },
  codigo_recuperacion_usado: { severidad: 'alta', umbral: 1, ventanaMin: 1, enfriamientoMin: 0, asunto: 'Se ha entrado con un código de recuperación' },
  codigos_recuperacion_nuevos: { severidad: 'alta', umbral: 1, ventanaMin: 1, enfriamientoMin: 0, asunto: 'Códigos de recuperación nuevos' },
  cuenta_desactivada_uso: { severidad: 'media', umbral: 3, ventanaMin: 60, enfriamientoMin: 120, asunto: 'Una cuenta desactivada sigue intentando entrar' },
  acceso_admin_denegado: { severidad: 'alta', umbral: 1, ventanaMin: 5, enfriamientoMin: 60, asunto: 'Alguien ha llamado a la administración sin serlo' },
  invitacion_creada: { severidad: 'alta', umbral: 1, ventanaMin: 1, enfriamientoMin: 0, asunto: 'Se ha creado una invitación al portal' },
  invitacion_invalida: { severidad: 'media', umbral: 5, ventanaMin: 30, enfriamientoMin: 60, asunto: 'Invitaciones inválidas probadas' },
  cuenta_creada: { severidad: 'alta', umbral: 1, ventanaMin: 1, enfriamientoMin: 0, asunto: 'Cuenta nueva en el portal' },
};

const ultimoAviso = new Map<EventKind, number>();
// Cerrojo por tipo: varias peticiones simultáneas evaluaban el aviso a la vez
// y mandaban correos duplicados (el enfriamiento se marcaba demasiado tarde).
const evaluando = new Set<EventKind>();
let enviadosHoy = 0;
let diaContador = '';
const TOPE_DIARIO = 25;

function hoyMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', dateStyle: 'short' }).format(new Date());
}

export function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : (fwd ?? req.socket.remoteAddress ?? '');
  return String(raw).split(',')[0].trim().slice(0, 64);
}

function userAgent(req: Request): string {
  return String(req.headers['user-agent'] ?? '').slice(0, 255);
}

async function enviarAviso(asunto: string, cuerpo: string) {
  const to = process.env.SECURITY_ALERT_TO;
  if (!to || !correoConfigurado()) return;

  const dia = hoyMadrid();
  if (dia !== diaContador) {
    diaContador = dia;
    enviadosHoy = 0;
  }
  if (enviadosHoy >= TOPE_DIARIO) return; // cortafuegos anti-inundación
  enviadosHoy += 1;

  await enviarCorreo({ to, subject: `🔐 Aa Portal · ${asunto}`, text: cuerpo, fromName: 'Aa Portal · Seguridad' });
  console.log(`[seguridad] aviso enviado por correo: ${asunto} (${enviadosHoy}/${TOPE_DIARIO} hoy)`);
}

/**
 * Registra un evento y avisa si toca. Nunca lanza: un fallo al avisar no debe
 * tumbar la petición que lo provocó.
 */
export async function logSecurityEvent(
  kind: EventKind,
  req: Request | null,
  detail = '',
): Promise<void> {
  try {
    const regla = REGLAS[kind];
    const ip = req ? clientIp(req) : '';
    const ua = req ? userAgent(req) : '';

    await db.insert(securityEvents).values({
      kind,
      severity: regla.severidad,
      ip: ip || null,
      userAgent: ua || null,
      detail: detail.slice(0, 500) || null,
    });

    // ¿toca avisar? primero el enfriamiento, luego el umbral en la ventana
    const ahora = Date.now();
    const ultimo = ultimoAviso.get(kind) ?? 0;
    if (regla.enfriamientoMin > 0 && ahora - ultimo < regla.enfriamientoMin * 60_000) return;
    if (evaluando.has(kind)) return; // otra petición ya está decidiendo por este tipo
    evaluando.add(kind);

    let n: number | string;
    try {
      const desde = new Date(ahora - regla.ventanaMin * 60_000);
      const [fila] = await db
        .select({ n: sql<number>`count(*)` })
        .from(securityEvents)
        .where(and(eq(securityEvents.kind, kind), gte(securityEvents.createdAt, desde)));
      n = fila.n;
      if (Number(n) < regla.umbral) return;
      ultimoAviso.set(kind, ahora);
    } finally {
      evaluando.delete(kind);
    }

    const cuerpo = [
      regla.asunto,
      '',
      `Tipo: ${kind} (gravedad ${regla.severidad})`,
      `Veces en los últimos ${regla.ventanaMin} min: ${n}`,
      ip ? `IP: ${ip}` : null,
      ua ? `Navegador: ${ua}` : null,
      detail ? `Detalle: ${detail}` : null,
      `Hora (Madrid): ${new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'medium' }).format(new Date())}`,
      '',
      'Si has sido tú, ignora este correo. Si no:',
      '1. Entra en el portal y pulsa «Cerrar en todos» (invalida cualquier sesión ajena).',
      '2. Cambia tu contraseña.',
      '',
      'Este aviso se envía como máximo una vez cada ' + regla.enfriamientoMin + ' min por tipo.',
    ]
      .filter((l) => l !== null)
      .join('\n');

    await enviarAviso(regla.asunto, cuerpo);
  } catch (e) {
    console.error(`[seguridad] no se pudo registrar/avisar ${kind}: ${(e as Error).message.slice(0, 120)}`);
  }
}

/** ¿Es la primera vez que se entra con éxito desde esta IP? */
export async function esOrigenNuevo(ip: string): Promise<boolean> {
  if (!ip) return false;
  const [previo] = await db
    .select({ id: securityEvents.id })
    .from(securityEvents)
    .where(and(eq(securityEvents.kind, 'login_nuevo_origen'), eq(securityEvents.ip, ip)))
    .orderBy(desc(securityEvents.id))
    .limit(1);
  return !previo;
}
