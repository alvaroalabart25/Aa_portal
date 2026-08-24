import { del, get, patch, post } from '../../lib/api';
import type { Task } from '../tasks/types';

export type FocusKind = 'melon' | 'formacion' | 'libro';
export type FocusScope = 'trabajo' | 'personal';
export type FocusStatus = 'activo' | 'hecho' | 'aparcado';
export type Marca = 'hecho' | 'libre';

export interface FocusItem {
  id: number;
  kind: FocusKind;
  scope: FocusScope;
  title: string;
  notes: string | null;
  status: FocusStatus;
  startMonth: string;
  /** las fechas de la plani: opcionales, un objetivo sin colocar es normal */
  startsOn: string | null;
  dueOn: string | null;
  doneAt: string | null;
  daily: number;
  metaId: number | null;
  sortOrder: number;
  /** lo hecho y lo que se está moviendo, por estados: es lo que pinta el aro */
  tareas: { hechas: number; revision: number; progreso: number; bloqueadas: number; total: number };
  /** mes del que viene, si arrastra de uno anterior */
  arrastra: string | null;
  racha: number;
  hoy: Marca | null;
  /** los últimos 7 días, del más antiguo al de hoy (vacío si no es diario) */
  semana: { date: string; mark: Marca | null }[];
}

export interface FocusMes {
  month: string;
  today: string;
  items: FocusItem[];
  limites: Record<FocusScope, { usados: number; tope: number }>;
}

/**
 * Una tarea del objetivo. Es una tarea NORMAL y corriente —vive en su proyecto,
 * aquí solo se enseña— así que se pinta con la misma tabla que la Agenda y por
 * eso comparte su tipo.
 */
export type TareaDelMelon = Task;

export interface Candidata {
  id: number;
  title: string;
  status: string;
  dueDate: string | null;
  projectId: number;
  projectName: string;
  spaceId: number;
  spaceName: string;
  spaceColor: string;
}

export interface MelonBreve {
  id: number;
  title: string;
  scope: FocusScope;
  startMonth?: string;
}

/** Un objetivo colocado en el tiempo, para la plani. */
export interface PlanItem {
  id: number;
  title: string;
  scope: FocusScope;
  status: FocusStatus;
  startMonth: string;
  startsOn: string | null;
  dueOn: string | null;
  doneAt: string | null;
  sortOrder: number;
  total: number;
  hechas: number;
  enMarcha: number;
  bloqueadas: number;
  /** lo que queda: el dato que se quiere ver sin entrar */
  pendientes: number;
}

export interface Plan {
  hoy: string;
  items: PlanItem[];
}

/** Un proyecto del objetivo: de ahí salen sus tareas. */
export interface ProyectoDelMelon {
  id: number;
  name: string;
  spaceId: number;
  spaceName: string;
  spaceColor: string;
  status: string;
}

export interface FocusDetalle extends Omit<FocusItem, 'tareas' | 'arrastra'> {
  tasks: TareaDelMelon[];
  /** de dónde salen: vincular uno no arrastra sus tareas, solo dice dónde buscar */
  projects: ProyectoDelMelon[];
  dias: { doneDate: string; mark: Marca }[];
  today: string;
}

export const focusApi = {
  mes: (month?: string) => get<FocusMes>(`/focus${month ? `?month=${month}` : ''}`),
  plan: () => get<Plan>('/focus/plan'),
  detalle: (id: number) => get<FocusDetalle>(`/focus/${id}`),
  crear: (data: {
    kind: FocusKind;
    scope?: FocusScope;
    title: string;
    daily?: boolean;
    month?: string;
    startsOn?: string | null;
    dueOn?: string | null;
  }) => post<FocusItem>('/focus', data),
  editar: (
    id: number,
    data: Partial<{
      title: string;
      notes: string | null;
      scope: FocusScope;
      status: FocusStatus;
      daily: boolean;
      startsOn: string | null;
      dueOn: string | null;
      startMonth: string;
    }>,
  ) => patch<FocusItem>(`/focus/${id}`, data),
  borrar: (id: number) => del<{ archived: boolean }>(`/focus/${id}`),

  marcarDia: (id: number, mark: Marca | 'ninguno', date?: string) =>
    post<{ date: string; mark: Marca | null; racha: number }>(`/focus/${id}/daily`, { mark, ...(date ? { date } : {}) }),

  candidatas: (id: number, filtros: { q?: string; spaceId?: number; projectId?: number } = {}) => {
    const p = new URLSearchParams();
    if (filtros.q) p.set('q', filtros.q);
    if (filtros.spaceId) p.set('spaceId', String(filtros.spaceId));
    if (filtros.projectId) p.set('projectId', String(filtros.projectId));
    const qs = p.toString();
    return get<Candidata[]>(`/focus/${id}/candidatas${qs ? `?${qs}` : ''}`);
  },

  /** Objetivos activos, para el selector de la ficha de una tarea */
  melones: () => get<MelonBreve[]>('/focus/melones'),
  /** ¿A qué objetivos está asociada esta tarea? */
  deTarea: (taskId: number) => get<MelonBreve[]>(`/focus/tarea/${taskId}`),
  asociarTarea: (id: number, taskId: number) => post<{ ok: boolean }>(`/focus/${id}/tasks`, { taskId }),
  quitarTarea: (id: number, taskId: number) => del<{ deleted: boolean }>(`/focus/${id}/tasks/${taskId}`),
  asociarProyecto: (id: number, projectId: number) =>
    post<{ ok: boolean }>(`/focus/${id}/projects`, { projectId }),
  quitarProyecto: (id: number, projectId: number) =>
    del<{ deleted: boolean }>(`/focus/${id}/projects/${projectId}`),
};

export const NOMBRE_TIPO: Record<FocusKind, { singular: string; plural: string; emoji: string }> = {
  melon: { singular: 'objetivo', plural: 'Objetivos del mes', emoji: '🎯' },
  formacion: { singular: 'formación', plural: 'Formaciones', emoji: '🎓' },
  libro: { singular: 'libro', plural: 'Libros', emoji: '📖' },
};

/** «2026-07» → «julio» */
export function nombreMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long' });
}

/** «2026-07» → «Julio». La mayúscula va aquí y no en CSS: `capitalize` se la
 *  pone a TODAS las palabras de la frase, no solo al mes. */
export function nombreMesCap(ym: string): string {
  const s = nombreMes(ym);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
