import { api, get, put } from '../../lib/api';
import { startAuthentication } from '@simplewebauthn/browser';

/** Un día con algo escrito. Los días en blanco no existen. */
export interface EntradaPersona {
  fecha: string;
  texto: string;
  pregunta: string | null;
}

export interface MesDePersona {
  hoy: string;
  mes: string;
  pregunta: string;
  entradas: EntradaPersona[];
}

/**
 * El pase de Persona vive AQUÍ, en memoria, y en ningún sitio más.
 *
 * Ni en localStorage ni en una cookie: al recargar la pestaña o al volver
 * mañana, la puerta está cerrada otra vez. Es lo que hace que «cerrado» quiera
 * decir cerrado de verdad y no «cerrado hasta que alguien mire el navegador».
 */
let pase: string | null = null;

export const hayPase = () => pase !== null;
export const cerrarPersona = () => {
  pase = null;
};

/**
 * Pide Face ID y guarda el pase si la firma es buena.
 *
 * `otroDispositivo` es para el ordenador que no tiene la llave en su llavero:
 * pide las opciones sin atarlas a este aparato y el navegador saca el código QR
 * para firmar con el iPhone. Sin eso, el Mac dice «no tienes llaves de acceso»
 * y no hay por dónde salir.
 */
export async function abrirPersona(otroDispositivo = false): Promise<void> {
  const { flowId, options } = await api<{
    flowId: string;
    options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
  }>('/persona/llave/opciones', { method: 'POST', body: JSON.stringify({ otro: otroDispositivo }) });

  const response = await startAuthentication({ optionsJSON: options });
  const r = await api<{ pase: string }>('/persona/llave/abrir', {
    method: 'POST',
    body: JSON.stringify({ flowId, response }),
  });
  pase = r.pase;
}

/** Toda llamada al diario lleva el pase; sin él el servidor responde 423. */
const conPase = () => ({ headers: { 'X-Persona': pase ?? '' } });

export const personaApi = {
  mes: (mes?: string) => get<MesDePersona>(`/persona${mes ? `?mes=${mes}` : ''}`, conPase()),
  meses: () => get<{ mes: string; dias: number }[]>('/persona/meses', conPase()),
  guardar: (fecha: string, texto: string, pregunta: string | null) =>
    put<{ fecha: string; texto: string; borrada: boolean }>(`/persona/${fecha}`, { texto, pregunta }, conPase()),
};
