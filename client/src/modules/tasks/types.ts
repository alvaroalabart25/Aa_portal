export type ProjectStatus = 'active' | 'completed' | 'cancelled';
export type TaskStatus = 'backlog' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
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
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'En progreso',
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
