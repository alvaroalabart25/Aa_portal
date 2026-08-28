import { get, put } from '../../lib/api';

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

export const personaApi = {
  // El pase lo pone `lib/api` a partir de la ruta: aquí no hay que acordarse.
  mes: (mes?: string) => get<MesDePersona>(`/persona${mes ? `?mes=${mes}` : ''}`),
  meses: () => get<{ mes: string; dias: number }[]>('/persona/meses'),
  guardar: (fecha: string, texto: string, pregunta: string | null) =>
    put<{ fecha: string; texto: string; borrada: boolean }>(`/persona/${fecha}`, { texto, pregunta }),
};
