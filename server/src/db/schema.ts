import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  date,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * Modelo de datos del portal.
 *
 * Jerarquía estricta: Espacio -> Proyecto -> Tarea (todo cuelga de algo).
 * `spaces` es entidad CORE compartida: los módulos futuros (Autónomo/facturas,
 * Wiki) la referenciarán. Crecer = añadir tablas o columnas NULL (aditivo);
 * nunca renombrar ni cambiar tipos.
 *
 * Nada se borra: completar/cancelar oculta (por estado + archived_at).
 */

export const users = mysqlTable('users', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  username: varchar('username', { length: 64 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Espacio: contexto/área/cliente. Ej: CSO, Autónomos, Alex Havard.
export const spaces = mysqlTable('spaces', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  name: varchar('name', { length: 120 }).notNull(),
  color: varchar('color', { length: 7 }).notNull().default('#0a0a0a'), // hex
  notes: text('notes'), // markdown
  sortOrder: int('sort_order').notNull().default(0),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

// Proyecto: siempre dentro de un Espacio. Ej: "Residencia Condes de Val · Web".
export const projects = mysqlTable('projects', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  spaceId: bigint('space_id', { mode: 'number' })
    .notNull()
    .references(() => spaces.id),
  name: varchar('name', { length: 200 }).notNull(),
  status: mysqlEnum('status', ['active', 'completed', 'cancelled']).notNull().default('active'),
  notes: text('notes'), // markdown
  dueDate: date('due_date', { mode: 'string' }),
  sortOrder: int('sort_order').notNull().default(0),
  completedAt: datetime('completed_at'),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

// Tarea: siempre dentro de un Proyecto. Ej: "Desarrollo home".
export const tasks = mysqlTable('tasks', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  projectId: bigint('project_id', { mode: 'number' })
    .notNull()
    .references(() => projects.id),
  title: varchar('title', { length: 255 }).notNull(),
  status: mysqlEnum('status', ['backlog', 'in_progress', 'blocked', 'completed', 'cancelled'])
    .notNull()
    .default('backlog'),
  priority: mysqlEnum('priority', ['low', 'medium', 'high']).notNull().default('medium'),
  notes: text('notes'), // markdown
  dueDate: date('due_date', { mode: 'string' }),
  sortOrder: int('sort_order').notNull().default(0),
  completedAt: datetime('completed_at'),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
