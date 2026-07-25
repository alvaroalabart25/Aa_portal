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
  remove: (id: number) => del<{ deleted: boolean }>(`/health-log/entries/${id}`),
  summary: (from: string, to: string) => get<DaySummary[]>(`/health-log/summary?from=${from}&to=${to}`),
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
  stop: () => post<{ stopped: boolean }>('/diary/stop', {}),
  create: (itemId: number, startAt: string, endAt: string) => post<DiarySession>('/diary/sessions', { itemId, startAt, endAt }),
  update: (id: number, data: Partial<{ itemId: number; startAt: string; endAt: string | null }>) =>
    patch<DiarySession>(`/diary/sessions/${id}`, data),
  remove: (id: number) => del<{ deleted: boolean }>(`/diary/sessions/${id}`),
};
