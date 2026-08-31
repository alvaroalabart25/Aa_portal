import { z } from 'zod';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color hex inválido (#rrggbb)');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');

export const spaceInput = z.object({
  name: z.string().trim().min(1).max(120),
  color: hexColor.optional(),
  notes: z.string().max(65000).nullish(),
  sortOrder: z.number().int().optional(),
});

export const projectInput = z.object({
  spaceId: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
  notes: z.string().max(65000).nullish(),
  dueDate: isoDate.nullish(),
  sortOrder: z.number().int().optional(),
});

// «1,2,3,4,5» → de lunes a viernes. Vacío → no se repite. Se valida la forma
// aquí para que a la base de datos no llegue nunca un día 9 ni un texto libre.
const diasSemana = z
  .string()
  .regex(/^([1-7](,[1-7])*)?$/, 'Días de repetición inválidos')
  .max(20);

export const taskInput = z.object({
  projectId: z.number().int().positive(),
  title: z.string().trim().min(1).max(255),
  repeatDays: diasSemana.optional(),
  status: z.enum(['backlog', 'in_progress', 'in_review', 'blocked', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  notes: z.string().max(65000).nullish(),
  dueDate: isoDate.nullish(),
  sortOrder: z.number().int().optional(),
});

// En updates todo es opcional (PATCH parcial)
export const spaceUpdate = spaceInput.partial();
export const projectUpdate = projectInput.partial();
export const taskUpdate = taskInput.partial();
