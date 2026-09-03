export type ProjectStatus = 'active' | 'completed' | 'cancelled';
export type TaskStatus = 'backlog' | 'in_progress' | 'in_review' | 'blocked' | 'completed' | 'cancelled';
export type Priority = 'low' | 'medium' | 'high';

export interface Space {
  id: number;
  name: string;
  color: string;
  notes: string | null;
  sortOrder: number;
  activeProjects?: number;
}

export interface Project {
  id: number;
  spaceId: number;
  name: string;
  status: ProjectStatus;
  notes?: string | null;
  dueDate: string | null;
  sortOrder: number;
  spaceName?: string;
  spaceColor?: string;
  totalTasks?: number;
  doneTasks?: number;
  /** señales de si se mueve o está parado (solo en el listado) */
  overdueTasks?: number;
  runningTasks?: number;
  lastActivity?: string | null;
}

export interface Task {
  id: number;
  projectId: number;
  title: string;
  status: TaskStatus;
  priority: Priority;
  notes?: string | null;
  dueDate: string | null;
  sortOrder: number;
  projectName?: string;
  spaceId?: number;
  spaceName?: string;
  spaceColor?: string;
  /** Días de la semana en los que vuelve: '1,2,3,4,5' (1 = lunes … 7 = domingo) */
  repeatDays?: string;
  /** El día que se marcó hecha por última vez (las que se repiten) */
  lastDoneAt?: string | null;
  /** Solo en la respuesta de marcar hecha una que se repite: cuándo vuelve */
  vuelveEl?: string | null;
  // Veces que se ha empujado su fecha hacia adelante
  postponedCount?: number;
  lastPostponedAt?: string | null;
  // Desde cuándo existe. Solo lo trae el detalle: es lo que pone en contexto
  // los aplazos —cuatro veces en una semana no es lo mismo que en tres meses—.
  createdAt?: string;
}

/**
 * ¿Hay que avisar de que esta tarea se ha aplazado?
 *
 * Aplazar no siempre es malo. Una tarea larga se mueve de fecha porque dura
 * varios días, no porque la estés esquivando, y marcarla en ámbar por eso es
 * ruido: enseña un problema donde solo hay trabajo en curso.
 *
 * Lo que sí dice algo es una tarea que sigue en BACKLOG y ya la has empujado:
 * ni siquiera la has empezado. Ahí se avisa desde la primera vez. Si está en
 * marcha, hace falta que sea EXAGERADO —cuatro veces— para que signifique algo.
 *
 * Cerrada no se avisa nunca: lo que costó llegar ya no cambia nada.
 */
export const AVISO_APLAZADA_EN_MARCHA = 4;

export function avisaAplazada(status: TaskStatus, veces?: number | null): boolean {
  const n = veces ?? 0;
  if (n < 1) return false;
  if (status === 'completed' || status === 'cancelled') return false;
  return status === 'backlog' ? true : n >= AVISO_APLAZADA_EN_MARCHA;
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'En progreso',
  in_review: 'En revisión',
  blocked: 'Bloqueada',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Activo',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};


// ---------------------------------------------------------------- repetición

/** Los siete días, en el orden en que se lee una semana. */
export const DIAS_SEMANA: [number, string, string][] = [
  [1, 'L', 'lunes'],
  [2, 'M', 'martes'],
  [3, 'X', 'miércoles'],
  [4, 'J', 'jueves'],
  [5, 'V', 'viernes'],
  [6, 'S', 'sábado'],
  [7, 'D', 'domingo'],
];

export const listaDias = (v?: string): number[] =>
  (v ?? '').split(',').filter(Boolean).map(Number);

/**
 * Cómo se cuenta una repetición: «todos los días», «de lunes a sábado»,
 * «los martes y jueves».
 *
 * Los días seguidos se dicen como un tramo. Enumerarlos —«los lunes, martes,
 * miércoles, jueves, viernes y sábado»— era correcto y de dos renglones.
 */
export function textoRepeticion(v?: string): string {
  const dias = listaDias(v).sort((a, b) => a - b);
  if (dias.length === 0) return 'No se repite';
  if (dias.length === 7) return 'Todos los días';
  const nombre = (d: number) => DIAS_SEMANA.find(([n]) => n === d)?.[2] ?? '';
  const seguidos = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  if (seguidos && dias.length > 2) return `De ${nombre(dias[0])} a ${nombre(dias[dias.length - 1])}`;
  const nombres = dias.map(nombre);
  if (nombres.length === 1) return `Los ${nombres[0]}`;
  return `Los ${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/** 1 = lunes … 7 = domingo, del día de una fecha ISO. */
export function diaDeSemana(iso: string): number {
  // mediodía a propósito: así ningún cambio de hora mueve el día
  const d = new Date(`${iso}T12:00:00`);
  return ((d.getDay() + 6) % 7) + 1;
}

export const esRecurrente = (t: Task): boolean => Boolean(t.repeatDays);

/**
 * ¿Esta tarea que vuelve toca HOY y está sin hacer?
 *
 * Las recurrentes NO se enseñan por su fecha de vencimiento, aunque la tengan:
 * su fecha dice cuándo vuelve, y colarla en la lista de ese día la convertía en
 * una tarea normal del viernes. Se enseñan por el día de la semana, en su
 * bloque, y solo el día que toca: marcarla hecha la quita hasta el siguiente.
 */
export function tocaHoy(t: Task, hoyIso: string): boolean {
  if (!t.repeatDays) return false;
  if (t.lastDoneAt === hoyIso) return false; // hecha hoy, vuelve el día que toque
  return listaDias(t.repeatDays).includes(diaDeSemana(hoyIso));
}

/**
 * El próximo día que le toca a una recurrente. Se CALCULA, no se guarda: una
 * tarea que vuelve no tiene fecha de vencimiento, y su verdad son sus días.
 */
export function proximaVuelta(repeatDays: string, desdeIso: string, incluirHoy = false): string | null {
  const dias = listaDias(repeatDays);
  if (dias.length === 0) return null;
  const d = new Date(`${desdeIso}T12:00:00`);
  const iso = (x: Date) => new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(x);
  const numero = (x: Date) => ((x.getDay() + 6) % 7) + 1;
  if (incluirHoy && dias.includes(numero(d))) return iso(d);
  for (let i = 0; i < 7; i++) {
    d.setDate(d.getDate() + 1);
    if (dias.includes(numero(d))) return iso(d);
  }
  return null;
}
