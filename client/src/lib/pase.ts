import { startAuthentication } from '@simplewebauthn/browser';
import { api } from './api';

/**
 * El pase: la segunda puerta, en el navegador.
 *
 * Hay partes del portal donde tener la sesión abierta no basta —el diario de
 * Persona, el dinero— y hay que volver a firmar con Face ID. Lo que se consigue
 * al firmar es un pase corto que el servidor exige en cada llamada.
 *
 * Vive AQUÍ, en memoria, y en ningún sitio más: ni localStorage ni cookie. Al
 * recargar la pestaña o volver mañana, la puerta está cerrada otra vez. Es lo
 * que hace que «cerrado» quiera decir cerrado.
 */
export type Ambito = 'persona' | 'finanzas';

/** Qué caminos de la API cubre cada ámbito. */
const RUTAS: Record<Ambito, string> = { persona: '/persona', finanzas: '/autonomo' };

const pases = new Map<Ambito, string>();
const oyentes = new Set<() => void>();

export function hayPase(a: Ambito): boolean {
  return pases.has(a);
}

export function cerrar(a: Ambito) {
  pases.delete(a);
  oyentes.forEach((f) => f());
}

/** Para que la pantalla se entere si el pase se cae (por ejemplo, al caducar). */
export function alCambiar(f: () => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

/** El pase que le toca a una ruta de la API, si es que le toca alguno. */
export function paseDe(path: string): string | null {
  for (const [ambito, prefijo] of Object.entries(RUTAS) as [Ambito, string][]) {
    if (path.startsWith(prefijo)) return pases.get(ambito) ?? null;
  }
  return null;
}

/**
 * Pide Face ID y guarda el pase si la firma es buena.
 *
 * `otroDispositivo` es para el ordenador que no tiene la llave en su llavero:
 * pide las opciones sin atarlas a este aparato y el navegador saca el código QR
 * para firmar con el iPhone.
 */
export async function abrir(a: Ambito, otroDispositivo = false): Promise<void> {
  const base = RUTAS[a];
  const { flowId, options } = await api<{
    flowId: string;
    options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
  }>(`${base}/llave/opciones`, { method: 'POST', body: JSON.stringify({ otro: otroDispositivo }) });

  const response = await startAuthentication({ optionsJSON: options });
  const r = await api<{ pase: string }>(`${base}/llave/abrir`, {
    method: 'POST',
    body: JSON.stringify({ flowId, response }),
  });
  pases.set(a, r.pase);
  oyentes.forEach((f) => f());
}
