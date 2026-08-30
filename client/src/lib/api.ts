import { clearToken, getToken } from './auth';
import { paseDe } from './pase';

// En dev queda vacío (el proxy de Vite manda /api al Express local).
// En producción, VITE_API_URL apunta a la API en Render.
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

// Cliente API base: token automático y manejo de sesión caducada.
export async function api<T>(
  path: string,
  options: RequestInit & { skipAuthRedirect?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  // Las partes cerradas con Face ID llevan además su pase. Se pone aquí y no en
  // cada llamada: si hubiera que acordarse en cada sitio, el día que se olvide
  // una la pantalla se rompe en vez de pedir la cara.
  const pase = paseDe(path);
  if (pase) headers['X-Pase'] = pase;

  const res = await fetch(`${API_BASE}/api${path}`, { ...options, headers });

  if (res.status === 401 && !options.skipAuthRedirect) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Sesión caducada');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; need2fa?: boolean };
    // el login necesita distinguir "falta el código" de "credenciales mal"
    const err = Object.assign(new Error(body.error ?? `Error ${res.status}`), { need2fa: body.need2fa });
    throw err;
  }
  return res.json();
}

// Descarga un binario autenticado (ej. PDF) y lo abre en una pestaña nueva.
export async function openBlob(path: string) {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  // El pase, igual que en `api()`. Se olvidó al cerrar Finanzas con Face ID y
  // el PDF de las facturas empezó a contestar 423: la sesión estaba bien, lo
  // que faltaba era la cara.
  const pase = paseDe(path);
  if (pase) headers['X-Pase'] = pase;

  const res = await fetch(`${API_BASE}/api${path}`, { headers });
  // 423 no es «se ha roto»: es que esta parte está cerrada y hay que volver a
  // pasar Face ID. Decirlo con el número no ayuda a nadie.
  if (res.status === 423) {
    throw new Error('Esta parte se ha cerrado. Vuelve a entrar con Face ID y lo abres.');
  }
  if (!res.ok) throw new Error(`Error ${res.status} generando el documento`);
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// `extra` es para cabeceras propias de un módulo —el pase de Persona— sin
// tener que duplicar el cliente entero.
export const get = <T>(path: string, extra: RequestInit = {}) => api<T>(path, extra);
export const post = <T>(path: string, data: unknown, extra: RequestInit = {}) =>
  api<T>(path, { ...extra, method: 'POST', body: JSON.stringify(data) });
export const patch = <T>(path: string, data: unknown, extra: RequestInit = {}) =>
  api<T>(path, { ...extra, method: 'PATCH', body: JSON.stringify(data) });
export const put = <T>(path: string, data: unknown, extra: RequestInit = {}) =>
  api<T>(path, { ...extra, method: 'PUT', body: JSON.stringify(data) });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
