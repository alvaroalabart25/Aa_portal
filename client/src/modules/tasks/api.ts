import { del, get, patch, post } from '../../lib/api';
import type { Project, Space, Task } from './types';

export const spacesApi = {
  list: () => get<Space[]>('/spaces'),
  one: (id: number) => get<Space>(`/spaces/${id}`),
  create: (data: Partial<Space>) => post<Space>('/spaces', data),
  update: (id: number, data: Partial<Space>) => patch<Space>(`/spaces/${id}`, data),
  archive: (id: number) => del<{ archived: boolean }>(`/spaces/${id}`),
};

export const projectsApi = {
  list: (params: { spaceId?: number; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.spaceId) q.set('spaceId', String(params.spaceId));
    if (params.status) q.set('status', params.status);
    return get<Project[]>(`/projects?${q}`);
  },
  one: (id: number) => get<Project>(`/projects/${id}`),
  create: (data: Partial<Project>) => post<Project>('/projects', data),
  update: (id: number, data: Partial<Project>) => patch<Project>(`/projects/${id}`, data),
  archive: (id: number) => del<{ archived: boolean }>(`/projects/${id}`),
};

export const tasksApi = {
  list: (params: { projectId?: number; spaceId?: number; status?: string; view?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.projectId) q.set('projectId', String(params.projectId));
    if (params.spaceId) q.set('spaceId', String(params.spaceId));
    if (params.status) q.set('status', params.status);
    if (params.view) q.set('view', params.view);
    return get<Task[]>(`/tasks?${q}`);
  },
  one: (id: number) => get<Task>(`/tasks/${id}`),
  create: (data: Partial<Task>) => post<Task>('/tasks', data),
  update: (id: number, data: Partial<Task>) => patch<Task>(`/tasks/${id}`, data),
  archive: (id: number) => del<{ archived: boolean }>(`/tasks/${id}`),
};
