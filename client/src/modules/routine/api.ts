import { del, get, patch, post } from '../../lib/api';

export interface RoutineItem {
  id: number;
  title: string;
  emoji: string;
}

export interface RoutineSlot {
  id: number;
  itemId: number;
  weekday: number; // 0 = lunes ... 6 = domingo
  time: string; // HH:MM orientativa
  title: string;
  emoji: string;
}

export interface TodayItem {
  slotId: number;
  time: string;
  title: string;
  emoji: string;
  checked: boolean;
}

export interface DayStat {
  date: string;
  scheduled: number;
  checked: number;
}

export const routineApi = {
  items: () => get<RoutineItem[]>('/routine/items'),
  createItem: (data: { title: string; emoji: string }) => post<RoutineItem>('/routine/items', data),
  updateItem: (id: number, data: Partial<{ title: string; emoji: string }>) => patch<RoutineItem>(`/routine/items/${id}`, data),
  removeItem: (id: number) => del<{ archived: boolean }>(`/routine/items/${id}`),

  slots: () => get<RoutineSlot[]>('/routine/slots'),
  createSlot: (data: { itemId: number; weekday: number; time: string }) => post<RoutineSlot>('/routine/slots', data),
  moveSlot: (id: number, data: Partial<{ weekday: number; time: string }>) => patch<RoutineSlot>(`/routine/slots/${id}`, data),
  removeSlot: (id: number) => del<{ archived: boolean }>(`/routine/slots/${id}`),

  today: () => get<{ date: string; items: TodayItem[] }>('/routine/today'),
  check: (slotId: number, checked: boolean) => post<{ slotId: number; checked: boolean }>('/routine/check', { slotId, checked }),

  stats: (from: string, to: string) => get<DayStat[]>(`/routine/stats?from=${from}&to=${to}`),
};
