import { del, get, patch, post } from '../../lib/api';
import type { ImportantEvent } from './types';

export const eventsApi = {
  list: () => get<ImportantEvent[]>('/events'),
  create: (data: Record<string, unknown>) => post<ImportantEvent>('/events', data),
  update: (id: number, data: Record<string, unknown>) => patch<ImportantEvent>(`/events/${id}`, data),
  remove: (id: number) => del<{ archived: boolean }>(`/events/${id}`),
};
