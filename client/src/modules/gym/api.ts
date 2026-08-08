import { del, get, patch, post } from '../../lib/api';

export type Musculo =
  | 'pecho'
  | 'espalda'
  | 'hombro'
  | 'trapecio'
  | 'biceps'
  | 'triceps'
  | 'antebrazo'
  | 'core'
  | 'cuadriceps'
  | 'isquios'
  | 'gluteo'
  | 'aductores'
  | 'gemelo';

/**
 * Los bloques, en el orden en que se miran: primero el tren superior, luego el
 * inferior. La etiqueta lleva tilde; el valor guardado no, para no depender de
 * cómo se escriba.
 */
export const MUSCULOS: { id: Musculo; label: string; zona: 'Tren superior' | 'Core' | 'Tren inferior' }[] = [
  { id: 'pecho', label: 'Pecho', zona: 'Tren superior' },
  { id: 'espalda', label: 'Espalda', zona: 'Tren superior' },
  { id: 'hombro', label: 'Hombro', zona: 'Tren superior' },
  { id: 'trapecio', label: 'Trapecio', zona: 'Tren superior' },
  { id: 'biceps', label: 'Bíceps', zona: 'Tren superior' },
  { id: 'triceps', label: 'Tríceps', zona: 'Tren superior' },
  { id: 'antebrazo', label: 'Antebrazo', zona: 'Tren superior' },
  { id: 'core', label: 'Core', zona: 'Core' },
  { id: 'cuadriceps', label: 'Cuádriceps', zona: 'Tren inferior' },
  { id: 'isquios', label: 'Isquios', zona: 'Tren inferior' },
  { id: 'gluteo', label: 'Glúteo', zona: 'Tren inferior' },
  { id: 'aductores', label: 'Aductores', zona: 'Tren inferior' },
  { id: 'gemelo', label: 'Gemelo', zona: 'Tren inferior' },
];

export const nombreMusculo = (id: string) => MUSCULOS.find((m) => m.id === id)?.label ?? id;
export const listaMusculos = (v: string) => (v ? v.split(',').filter(Boolean) : []);

export interface Parte {
  id: string;
  label: string;
  muscle: Musculo;
  ideas: string[];
}

export interface Condicionante {
  id: number;
  title: string;
  side: 'izquierdo' | 'derecho' | 'ambos' | 'na';
  muscles: string;
  severity: 'cuidado' | 'evitar';
  advice: string | null;
  notes: string | null;
  since: string | null;
  status: 'activo' | 'superado';
  sortOrder: number;
}

export interface Ejercicio {
  id: number;
  dayId: number;
  muscles: string;
  /** partes concretas del bloque; el bloque se deriva de aquí */
  parts: string;
  name: string;
  kind: 'repes' | 'tiempo';
  targetSets: number;
  targetReps: string;
  targetWeight: string | null;
  restSeconds: number | null;
  notes: string | null;
  sortOrder: number;
}

export interface DiaRutina {
  id: number;
  name: string;
  notes: string | null;
  sortOrder: number;
  /** última vez que se terminó, en ISO; null si nunca */
  lastDone: string | null;
  sessions: number;
  exercises: Ejercicio[];
}

export interface Rutina {
  today: string;
  days: DiaRutina[];
}

export interface Serie {
  id: number;
  exerciseId: number;
  setNumber: number;
  reps: number | null;
  seconds: number | null;
  weight: string | null;
}

export interface Sesion {
  id: number;
  dayId: number;
  sessionDate: string;
  startedAt: string;
  endedAt: string | null;
  /** cómo se vio, del 1 al 5; dos ejes distintos */
  energy: number | null;
  feeling: number | null;
  notes: string | null;
}

export interface EjercicioEnSesion extends Ejercicio {
  done: Serie[];
  previous: { date: string | null; sets: Omit<Serie, 'id'>[] };
}

export interface SesionDetalle {
  session: Sesion;
  day: { id: number; name: string } | null;
  exercises: EjercicioEnSesion[];
}

export interface SesionHistorial {
  id: number;
  dayId: number;
  dayName: string;
  sessionDate: string;
  startedAt: string;
  endedAt: string | null;
  energy: number | null;
  feeling: number | null;
  notes: string | null;
  sets: number;
  volume: string | null;
}

export type TipoMeta = 'fase' | 'peso' | 'ejercicio' | 'libre';

export interface MetaGym {
  id: number;
  kind: TipoMeta;
  title: string;
  exerciseId: number | null;
  startValue: string | null;
  targetValue: string | null;
  unit: string | null;
  deadline: string | null;
  status: 'activo' | 'logrado' | 'aparcado';
  achievedAt: string | null;
  notes: string | null;
  sortOrder: number;
  /** valor de hoy, calculado en el servidor (peso corporal o tope del ejercicio) */
  current: number | null;
  currentDate: string | null;
}

export const gymApi = {
  rutina: () => get<Rutina>('/gym/rutina'),
  // el catálogo vive en el servidor: copiarlo aquí acabaría en dos versiones
  partes: () => get<Parte[]>('/gym/partes'),

  crearDia: (data: { name: string; notes?: string | null }) => post<DiaRutina>('/gym/dias', data),
  editarDia: (id: number, data: Partial<{ name: string; notes: string | null }>) =>
    patch<DiaRutina>(`/gym/dias/${id}`, data),
  borrarDia: (id: number) => del<{ archived: boolean }>(`/gym/dias/${id}`),

  // el peso viaja como número aunque vuelva como cadena: la base guarda decimal
  crearEjercicio: (data: Record<string, unknown> & { dayId: number; name: string }) =>
    post<Ejercicio>('/gym/ejercicios', data),
  editarEjercicio: (id: number, data: Record<string, unknown>) => patch<Ejercicio>(`/gym/ejercicios/${id}`, data),
  borrarEjercicio: (id: number) => del<{ archived: boolean }>(`/gym/ejercicios/${id}`),
  reordenar: (que: 'dias' | 'ejercicios', ids: number[]) => post<{ ok: true }>('/gym/orden', { que, ids }),

  sesionAbierta: () => get<Sesion | null>('/gym/sesion/abierta'),
  empezar: (dayId: number) => post<Sesion>('/gym/sesiones', { dayId }),
  sesion: (id: number) => get<SesionDetalle>(`/gym/sesiones/${id}`),
  cambiarDia: (id: number, dayId: number) => patch<Sesion>(`/gym/sesiones/${id}`, { dayId }),
  marcarSerie: (
    id: number,
    data: { exerciseId: number; setNumber: number; reps?: number | null; seconds?: number | null; weight?: number | null },
  ) => post<Serie>(`/gym/sesiones/${id}/series`, data),
  borrarSerie: (id: number, serieId: number) => del<{ deleted: boolean }>(`/gym/sesiones/${id}/series/${serieId}`),
  cerrar: (id: number, encuesta: { notes?: string | null; energy?: number; feeling?: number } = {}) =>
    post<Sesion>(`/gym/sesiones/${id}/cerrar`, encuesta),
  tirar: (id: number) => del<{ deleted: boolean }>(`/gym/sesiones/${id}`),
  historial: (limit = 30) => get<SesionHistorial[]>(`/gym/historial?limit=${limit}`),

  condicionantes: () => get<Condicionante[]>('/gym/condicionantes'),
  crearCondicionante: (data: Record<string, unknown>) => post<Condicionante>('/gym/condicionantes', data),
  editarCondicionante: (id: number, data: Record<string, unknown>) =>
    patch<Condicionante>(`/gym/condicionantes/${id}`, data),
  borrarCondicionante: (id: number) => del<{ deleted: boolean }>(`/gym/condicionantes/${id}`),

  objetivos: () => get<MetaGym[]>('/gym/objetivos'),
  crearObjetivo: (data: Record<string, unknown>) => post<MetaGym>('/gym/objetivos', data),
  editarObjetivo: (id: number, data: Record<string, unknown>) => patch<MetaGym>(`/gym/objetivos/${id}`, data),
  borrarObjetivo: (id: number) => del<{ deleted: boolean }>(`/gym/objetivos/${id}`),
};

/** «hace 3 días», «hoy», «ayer». Null = nunca. */
export function hace(iso: string | null): string {
  if (!iso) return 'nunca';
  const dias = Math.round((Date.now() - new Date(`${iso}T12:00:00`).getTime()) / 86400000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  return `hace ${dias} días`;
}

/** «50.00» → «50», «22.50» → «22,5». Para meterlo en un campo de texto. */
export function numTxt(v: string | number | null | undefined): string {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return (n % 1 === 0 ? String(n) : String(n)).replace('.', ',');
}

export const kg = (v: string | number | null | undefined) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return `${n % 1 === 0 ? n : n.toFixed(1).replace('.', ',')} kg`;
};
