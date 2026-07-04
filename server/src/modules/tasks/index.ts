import { Router } from 'express';
import { spacesRouter } from './spaces.routes';
import { projectsRouter } from './projects.routes';
import { tasksRouter } from './tasks.routes';

// Módulo "Gestor de tareas": expone /spaces, /projects y /tasks.
// Los módulos futuros (autónomo, wiki...) seguirán este mismo patrón.
export const tasksModule = Router();
tasksModule.use('/spaces', spacesRouter);
tasksModule.use('/projects', projectsRouter);
tasksModule.use('/tasks', tasksRouter);
