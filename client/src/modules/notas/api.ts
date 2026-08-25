import { get, put } from '../../lib/api';

/** Un día con algo escrito. Los días en blanco no existen. */
export interface Nota {
  fecha: string;
  texto: string;
  actualizado: string;
}

export interface MesDeNotas {
  hoy: string;
  mes: string;
  notas: Nota[];
}

export const notasApi = {
  mes: (mes?: string) => get<MesDeNotas>(`/notas${mes ? `?mes=${mes}` : ''}`),
  meses: () => get<{ mes: string; dias: number }[]>('/notas/meses'),
  guardar: (fecha: string, texto: string) =>
    put<{ fecha: string; texto: string; borrada: boolean }>(`/notas/${fecha}`, { texto }),
};
