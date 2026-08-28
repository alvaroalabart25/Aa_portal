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

/** Los apuntes de una tarea o de un proyecto. */
export interface NotasDeFicha {
  hoy: string;
  notas: Nota[];
}

export type TipoDeFicha = 'tarea' | 'proyecto';

export const notasApi = {
  mes: (mes?: string) => get<MesDeNotas>(`/notas${mes ? `?mes=${mes}` : ''}`),
  meses: () => get<{ mes: string; dias: number }[]>('/notas/meses'),
  guardar: (fecha: string, texto: string) =>
    put<{ fecha: string; texto: string; borrada: boolean }>(`/notas/${fecha}`, { texto }),

  ficha: (tipo: TipoDeFicha, id: number) => get<NotasDeFicha>(`/notas/ficha/${tipo}/${id}`),
  guardarFicha: (tipo: TipoDeFicha, id: number, fecha: string, texto: string) =>
    put<{ fecha: string; texto: string; borrada: boolean }>(`/notas/ficha/${tipo}/${id}/${fecha}`, { texto }),
};
