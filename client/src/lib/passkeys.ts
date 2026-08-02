import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api, get, post, del } from './api';
import { setToken } from './auth';

export interface Passkey {
  id: number;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** ¿Tiene este navegador Face ID / Touch ID disponible para la web? */
export function passkeysSoportadas(): boolean {
  return typeof window !== 'undefined' && Boolean(window.PublicKeyCredential);
}

export const passkeysApi = {
  lista: () => get<Passkey[]>('/auth/passkeys'),
  borrar: (id: number) => del<{ deleted: boolean }>(`/auth/passkeys/${id}`),
};

/** Registra este dispositivo. El navegador pedirá Face ID al confirmar. */
export async function registrarPasskey(nombre: string): Promise<void> {
  const { flowId, options } = await post<{ flowId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>(
    '/auth/passkeys/register/options',
    {},
  );
  const response = await startRegistration({ optionsJSON: options });
  await post('/auth/passkeys/register/verify', { flowId, response, name: nombre });
}

type OpcionesLogin = Parameters<typeof startAuthentication>[0]['optionsJSON'];

/**
 * Entrar (o desbloquear) con Face ID. Guarda la sesión nueva y la devuelve.
 *
 * `desbloqueo` cambia de dónde salen las opciones:
 *  - false (entrar sin sesión): el dispositivo ofrece las llaves que tenga y
 *    puede abrir su hoja de selección. No hay alternativa: decir qué llaves
 *    existen antes de identificarse sería filtrar información.
 *  - true (la app solo está bloqueada): la API concreta qué llave vale, así que
 *    el iPhone va directo a Face ID sin pasar por esa hoja.
 */
export async function entrarConPasskey(desbloqueo = false): Promise<string> {
  const ruta = desbloqueo ? '/auth/passkeys/unlock/options' : '/auth/passkeys/login/options';
  const { flowId, options } = await api<{ flowId: string; options: OpcionesLogin }>(ruta, {
    method: 'POST',
    body: '{}',
    skipAuthRedirect: true,
  });
  const response = await startAuthentication({ optionsJSON: options });
  const r = await api<{ token: string }>('/auth/passkeys/login/verify', {
    method: 'POST',
    body: JSON.stringify({ flowId, response }),
    skipAuthRedirect: true,
  });
  setToken(r.token);
  return r.token;
}

// ---------- Bloqueo de la app ----------
const CLAVE_BLOQUEO = 'aa_lock';
const CLAVE_ACTIVIDAD = 'aa_last_active';
export const MINUTOS_PARA_BLOQUEAR = 5;

export function bloqueoActivado(): boolean {
  return localStorage.getItem(CLAVE_BLOQUEO) === '1';
}
export function activarBloqueo(v: boolean) {
  localStorage.setItem(CLAVE_BLOQUEO, v ? '1' : '0');
}
export function marcarActividad() {
  localStorage.setItem(CLAVE_ACTIVIDAD, String(Date.now()));
}
/** ¿Ha pasado suficiente tiempo cerrada para volver a pedir Face ID? */
export function tocaBloquear(): boolean {
  if (!bloqueoActivado()) return false;
  const ultima = Number(localStorage.getItem(CLAVE_ACTIVIDAD) ?? 0);
  return Date.now() - ultima > MINUTOS_PARA_BLOQUEAR * 60_000;
}
