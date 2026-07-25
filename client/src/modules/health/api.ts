import { del, get, post } from '../../lib/api';

export type HealthKind = 'cig_pausa' | 'cig_trabajo' | 'peso';

export interface HealthEntry {
  id: number;
  kind: HealthKind;
  value: number | null;
  entryDate: string;
  createdAt: string;
}

export interface DaySummary {
  date: string;
  cigPausa: number;
  cigTrabajo: number;
  peso: number | null;
}

export const healthApi = {
  day: (date?: string) => get<{ date: string; entries: HealthEntry[] }>(`/health-log/day${date ? `?date=${date}` : ''}`),
  add: (kind: HealthKind, value?: number) => post<HealthEntry>('/health-log/entries', { kind, value }),
  remove: (id: number) => del<{ deleted: boolean }>(`/health-log/entries/${id}`),
  summary: (from: string, to: string) => get<DaySummary[]>(`/health-log/summary?from=${from}&to=${to}`),
};
