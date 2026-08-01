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

/**
 * Entrar (o desbloquear) con Face ID. Guarda la sesión nueva y la devuelve.
 * Se usa igual desde la pantalla de entrada y desde el bloqueo de la app.
 */
export async function entrarConPasskey(): Promise<string> {
  const { flowId, options } = await api<{ flowId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>(
    '/auth/passkeys/login/options',
    { method: 'POST', body: '{}', skipAuthRedirect: true },
  );
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
