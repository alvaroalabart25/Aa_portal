import { del, get, patch, post } from '../../lib/api';

// ---------- Marcas puntuales (cigarro, peso) ----------
export type HealthKind = 'cigarro' | 'peso';

export interface HealthEntry {
  id: number;
  kind: HealthKind;
  value: number | null;
  entryDate: string;
  entryTime: string | null; // HH:MM
  createdAt: string;
}

export interface DaySummary {
  date: string;
  cigarros: number;
  peso: number | null;
  pesoTime: string | null;
}

export const healthApi = {
  day: (date?: string) => get<{ date: string; entries: HealthEntry[] }>(`/health-log/day${date ? `?date=${date}` : ''}`),
  add: (kind: HealthKind, opts: { value?: number; time?: string; date?: string } = {}) =>
    post<HealthEntry>('/health-log/entries', { kind, ...opts }),
  setTime: (id: number, time: string) => patch<HealthEntry>(`/health-log/entries/${id}`, { time }),
  remove: (id: number) => del<{ deleted: boolean }>(`/health-log/entries/${id}`),
  summary: (from: string, to: string) => get<DaySummary[]>(`/health-log/summary?from=${from}&to=${to}`),
};

// ---------- Checks del día ----------
export interface DailyCheck {
  id: number;
  title: string;
  emoji: string;
  kind: 'plain' | 'peso';
  done: boolean;
  /** «N veces por semana» o null si es de todos los días. */
  objetivoSemanal: number | null;
  /** Cuántas van esta semana (de lunes a hoy). */
  estaSemana: number;
  /** Lo que hay que mirar para saber si pide algo: hoy en los diarios, el
   *  objetivo de la semana en los semanales. */
  cumplido: boolean;
  /** Días seguidos hasta hoy. Si hoy no está hecho, la que traes de ayer. */
  racha: number;
  /** Los últimos siete días, del más antiguo a hoy. */
  semana: { dia: string; hecho: boolean }[];
  peso: { id: number; value: number | null; time: string | null } | null;
}

export const checksApi = {
  list: (date?: string) => get<{ date: string; checks: DailyCheck[] }>(`/health-log/checks${date ? `?date=${date}` : ''}`),
  create: (title: string, emoji: string, vecesPorSemana?: number | null) =>
    post<DailyCheck>('/health-log/checks', { title, emoji, vecesPorSemana: vecesPorSemana ?? null }),
  frecuencia: (id: number, vecesPorSemana: number | null) =>
    patch<{ id: number; vecesPorSemana: number | null }>(`/health-log/checks/${id}`, { vecesPorSemana }),
  remove: (id: number) => del<{ archived: boolean }>(`/health-log/checks/${id}`),
  toggle: (id: number, done: boolean, date?: string) =>
    post<{ id: number; done: boolean }>(`/health-log/checks/${id}/toggle`, { done, date }),
};

// ---------- Sesiones de actividad (la radiografía) ----------
export interface DiarySession {
  id: number;
  itemId: number;
  startAt: string; // ISO
  endAt: string | null; // null = en curso
  title: string;
  emoji: string;
}

export const diaryApi = {
  sessions: (fromIso: string, toIso: string) =>
    get<DiarySession[]>(`/diary/sessions?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`),
  current: () => get<DiarySession | null>('/diary/current'),
  start: (itemId: number) => post<DiarySession>('/diary/start', { itemId }),
  moment: (itemId: number) => post<DiarySession>('/diary/moment', { itemId }),
  stop: () => post<{ stopped: boolean }>('/diary/stop', {}),
  create: (itemId: number, startAt: string, endAt: string) => post<DiarySession>('/diary/sessions', { itemId, startAt, endAt }),
  update: (id: number, data: Partial<{ itemId: number; startAt: string; endAt: string | null }>) =>
    patch<DiarySession>(`/diary/sessions/${id}`, data),
  remove: (id: number) => del<{ deleted: boolean }>(`/diary/sessions/${id}`),
};
