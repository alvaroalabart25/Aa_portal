import { api, del, get, patch, post } from '../../lib/api';

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
  /** los del mismo grupo se hacen alternados (X1, Y1, X2, Y2…) */
  supersetId?: number | null;
  /** identidad en el catálogo: por ella viven el PR y el historial */
  catalogId?: number | null;
  id: number;
  dayId: number;
  muscles: string;
  /** partes PRINCIPALES (lo que el ejercicio entrena); el bloque se deriva de aquí */
  parts: string;
  /** partes colaterales: trabajan de rebote, no crean expectativas de cobertura */
  partsSecondary: string;
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
  /** Los bloques generales de la sesión: filtran el selector de ejercicios. */
  muscles: string;
  sortOrder: number;
  /** última vez que se terminó, en ISO; null si nunca */
  lastDone: string | null;
  sessions: number;
  exercises: Ejercicio[];
  /** Improvisados entrenando: todavía NO son parte del plan. */
  proposed?: Ejercicio[];
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
  plannedReps: number | null;
  seconds: number | null;
  weight: string | null;
  /** segundos descansados ANTES de esta serie, y lo que duró la serie */
  restBefore: number | null;
  duration: number | null;
  punishment: number;
  createdAt: string;
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
  /** lo que sueles descansar en este ejercicio, en segundos */
  restAvg: number | null;
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
  /** la duración honesta va de aquí a aquí, no de abrir a cerrar */
  firstSet: string | null;
  lastSet: string | null;
}

export interface SesionOlvidada {
  id: number;
  dayId: number;
  dayName: string;
  sessionDate: string;
  startedAt: string;
  sets: number;
  lastSet: string;
  minutos: number;
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

export interface SesionBreve {
  id: number;
  dayName: string;
  sessionDate: string;
  energy: number | null;
  sets: number;
  volume: number | null;
}

export interface SemanaGym {
  today: string;
  weekStart: string;
  target: number;
  week: SesionBreve[];
  last: SesionBreve | null;
  /** media de kilos movidos en las últimas sesiones, para comparar */
  avgVolume: number | null;
}

/** Un ejercicio del catálogo, con TUS números al lado. */
export interface CatalogoItem {
  id: number;
  name: string;
  parts: string;
  partsSecondary: string;
  kind: 'repes' | 'tiempo';
  explain: string | null;
  mine: boolean;
  pr: string | null;
  lastDone: string | null;
  sets: number;
  hasNote: boolean;
  inRoutine: boolean;
}

export interface FichaCatalogo {
  id: number;
  name: string;
  parts: string;
  partsSecondary: string;
  kind: 'repes' | 'tiempo';
  explain: string | null;
  mine: boolean;
  note: string | null;
  history: { fecha: string; sets: number; mejorPeso: number | null; mejorReps: number | null; mejorSegs: number | null }[];
}

/** Con quién comparto y qué sesiones. */
export interface Compartido {
  pairId: number;
  con: string;
  desde: string;
  sesiones: { linkId: number; dayId: number; name: string }[];
}

/** Un cambio del otro lado esperando a que decidas. Solo altas y bajas: el
 *  objetivo, el peso y las notas son de cada uno y no viajan. */
export interface Sugerencia {
  id: number;
  /** false = el ejercicio no está en tu listado: la decisión es doble */
  enTuListado: boolean;
  kind: 'alta' | 'baja' | 'ss_alta' | 'ss_baja';
  name: string;
  exerciseKind: 'repes' | 'tiempo';
  parts: string;
  /** superseries: JSON con los nombres implicados */
  extra?: string | null;
  de: string;
  dayId: number;
  dayName: string;
  createdAt: string;
}

/** Superseries juntas, el resto suelto, respetando el orden de la lista. */
export function agruparSuperseries<T extends { id: number; supersetId?: number | null }>(ejercicios: T[]): T[][] {
  const grupos: T[][] = [];
  const vistos = new Set<number>();
  for (const e of ejercicios) {
    if (vistos.has(e.id)) continue;
    if (e.supersetId != null) {
      const grupo = ejercicios.filter((x) => x.supersetId === e.supersetId);
      grupo.forEach((x) => vistos.add(x.id));
      grupos.push(grupo);
    } else {
      vistos.add(e.id);
      grupos.push([e]);
    }
  }
  return grupos;
}

export const gymApi = {
  semana: () => get<SemanaGym>('/gym/semana'),
  rutina: () => get<Rutina>('/gym/rutina'),
  // el catálogo vive en el servidor: copiarlo aquí acabaría en dos versiones
  partes: () => get<Parte[]>('/gym/partes'),

  crearDia: (data: { name: string; notes?: string | null }) => post<DiaRutina>('/gym/dias', data),
  editarDia: (id: number, data: Partial<{ name: string; notes: string | null; muscles: string[] }>) =>
    patch<DiaRutina>(`/gym/dias/${id}`, data),
  borrarDia: (id: number) => del<{ archived: boolean }>(`/gym/dias/${id}`),

  // el peso viaja como número aunque vuelva como cadena: la base guarda decimal
  crearEjercicio: (data: Record<string, unknown> & { dayId: number; name: string }) =>
    post<Ejercicio>('/gym/ejercicios', data),
  editarEjercicio: (id: number, data: Record<string, unknown>) => patch<Ejercicio>(`/gym/ejercicios/${id}`, data),
  borrarEjercicio: (id: number) => del<{ archived: boolean }>(`/gym/ejercicios/${id}`),
  reordenar: (que: 'dias' | 'ejercicios', ids: number[]) => post<{ ok: true }>('/gym/orden', { que, ids }),
  superserie: (id: number, withId: number | null) =>
    patch<{ ok: true; supersetId?: number }>(`/gym/ejercicios/${id}/superserie`, { withId }),
  sustituir: (id: number, data: { catalogId?: number; name: string }) =>
    post<Ejercicio>(`/gym/ejercicios/${id}/sustituir`, data),

  // Compartir con otra cuenta. La key se enseña UNA vez: solo se guarda su huella.
  compartido: () => get<Compartido[]>('/gym/compartir'),
  crearKey: () => post<{ code: string; expiresAt: string }>('/gym/compartir/key', {}),
  canjearKey: (code: string) =>
    post<{ pairId: number; dias: number; ejercicios: number; con: string }>('/gym/compartir/canjear', { code }),
  dejarDeCompartir: (pairId: number) => del<{ ok: true }>(`/gym/compartir/${pairId}`),

  sugerencias: () => get<Sugerencia[]>('/gym/sugerencias'),
  soloAlListado: (id: number) => post<{ ok: true; name: string }>(`/gym/sugerencias/${id}/solo-listado`, {}),

  // El catálogo: la lista común más los tuyos, con tu PR al lado.
  catalogo: () => get<CatalogoItem[]>('/gym/catalogo'),
  fichaCatalogo: (id: number) => get<FichaCatalogo>(`/gym/catalogo/${id}`),
  crearEnCatalogo: (data: { name: string; parts?: string; kind?: 'repes' | 'tiempo' }) =>
    post<{ id: number; name: string }>('/gym/catalogo', data),
  explicarEjercicio: (id: number, explain: string | null) => patch<{ ok: true }>(`/gym/catalogo/${id}`, { explain }),
  notaDeEjercicio: (id: number, note: string) => api<{ ok: true }>(`/gym/catalogo/${id}/nota`, { method: 'PUT', body: JSON.stringify({ note }) }),
  aceptarSugerencia: (id: number) => post<{ ok: true; aviso: string | null }>(`/gym/sugerencias/${id}/aceptar`, {}),
  rechazarSugerencia: (id: number) => post<{ ok: true }>(`/gym/sugerencias/${id}/rechazar`, {}),

  // Improvisar entrenando: se apunta ahora, se decide al acabar.
  improvisar: (sessionId: number, data: { catalogId?: number; name: string; parts?: string; kind?: 'repes' | 'tiempo'; targetSets?: number; targetReps?: string }) =>
    post<Ejercicio>(`/gym/sesiones/${sessionId}/improvisar`, data),
  aceptarPropuesta: (id: number) => post<{ ok: true }>(`/gym/propuestas/${id}/aceptar`, {}),
  descartarPropuesta: (id: number) => post<{ ok: true }>(`/gym/propuestas/${id}/descartar`, {}),

  sesionAbierta: () => get<Sesion | null>('/gym/sesion/abierta'),
  sesionOlvidada: () => get<SesionOlvidada | null>('/gym/sesion/olvidada'),
  empezar: (dayId: number) => post<Sesion>('/gym/sesiones', { dayId }),
  sesion: (id: number) => get<SesionDetalle>(`/gym/sesiones/${id}`),
  cambiarDia: (id: number, dayId: number) => patch<Sesion>(`/gym/sesiones/${id}`, { dayId }),
  marcarSerie: (
    id: number,
    data: {
      exerciseId: number;
      setNumber: number;
      reps?: number | null;
      plannedReps?: number | null;
      seconds?: number | null;
      weight?: number | null;
      restBefore?: number | null;
      duration?: number | null;
      punishment?: boolean;
    },
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


/**
 * El descanso que se propone para la siguiente serie.
 *
 * Mezcla lo que descansaste hace un momento (pesa más: es la fatiga de HOY) con
 * lo que sueles descansar en ese ejercicio, y añade un margen porque la fatiga
 * sube según avanza la sesión. Si te pasaste mucho del propuesto, el margen es
 * mayor: te está diciendo que hoy necesitas más.
 */
export function descansoSugerido({
  ultimoReal,
  ultimoSugerido,
  media,
  objetivo,
}: {
  ultimoReal: number | null;
  ultimoSugerido: number | null;
  media: number | null;
  objetivo: number | null;
}): number {
  const base = objetivo || 90;
  if (!ultimoReal) return Math.round(media ? 0.5 * media + 0.5 * base : base);
  const mezcla = media ? 0.65 * ultimoReal + 0.35 * media : ultimoReal;
  // ¿te pasaste del propuesto? cuánto, marca cuánto margen darte
  const exceso = ultimoSugerido ? ultimoReal / ultimoSugerido : 1;
  const margen = exceso > 1.5 ? 60 : exceso > 1.15 ? 30 : 15;
  return Math.min(360, Math.max(30, Math.round((mezcla + margen) / 5) * 5));
}
