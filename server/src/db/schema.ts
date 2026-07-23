import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  date,
  decimal,
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

// Eventos importantes: fechas clave (no son tareas). Vinculados a Autónomo o
// a un espacio de Organización. Los recurrentes muestran solo su próxima
// ocurrencia (nunca se proyectan al infinito).
export const events = mysqlTable('events', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  title: varchar('title', { length: 200 }).notNull(),
  emoji: varchar('emoji', { length: 16 }).notNull().default('📌'),
  eventDate: date('event_date', { mode: 'string' }).notNull(), // fecha (o primera ocurrencia)
  recurrence: mysqlEnum('recurrence', ['none', 'monthly', 'yearly']).notNull().default('none'),
  scope: mysqlEnum('scope', ['autonomo', 'space']).notNull(),
  spaceId: bigint('space_id', { mode: 'number' }).references(() => spaces.id),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

// Rutinas: catálogo de eventos, plantilla semanal (slots) y checks diarios.
// Todo se archiva (nunca se borra) para que el historial de la cuadrícula de
// evolución quede intacto: un slot cuenta para un día pasado si ya existía
// entonces (created_at <= día < archived_at).
export const routineItems = mysqlTable('routine_items', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  title: varchar('title', { length: 120 }).notNull(),
  emoji: varchar('emoji', { length: 16 }).notNull().default('🔁'),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

export const routineSlots = mysqlTable('routine_slots', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  itemId: bigint('item_id', { mode: 'number' })
    .notNull()
    .references(() => routineItems.id),
  weekday: int('weekday').notNull(), // 0 = lunes ... 6 = domingo
  time: varchar('time', { length: 5 }).notNull().default('08:00'), // hora orientativa
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

export const routineChecks = mysqlTable('routine_checks', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  slotId: bigint('slot_id', { mode: 'number' })
    .notNull()
    .references(() => routineSlots.id),
  checkDate: date('check_date', { mode: 'string' }).notNull(),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Road Map: seguimiento de mejoras del propio portal, categorizadas por área.
export const roadmapItems = mysqlTable('roadmap_items', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  title: varchar('title', { length: 255 }).notNull(),
  category: mysqlEnum('category', ['agenda', 'organizacion', 'autonomo', 'futuros']).notNull(),
  status: mysqlEnum('status', ['pending', 'in_progress', 'done']).notNull().default('pending'),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

// ============================================================
// Módulo Autónomo: facturación
// ============================================================

// Datos fiscales del emisor (una sola fila; editable desde la UI en el futuro)
export const autonomoProfile = mysqlTable('autonomo_profile', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  fullName: varchar('full_name', { length: 160 }).notNull(),
  taxId: varchar('tax_id', { length: 20 }).notNull(),
  addressLine: varchar('address_line', { length: 200 }),
  cityLine: varchar('city_line', { length: 200 }),
  iban: varchar('iban', { length: 40 }),
  defaultVatPct: decimal('default_vat_pct', { precision: 5, scale: 2 }).notNull().default('21.00'),
  defaultIrpfPct: decimal('default_irpf_pct', { precision: 5, scale: 2 }).notNull().default('15.00'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

// Pagadores/clientes de facturación (ej: CSO Digital S.L.)
export const invoiceClients = mysqlTable('invoice_clients', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  name: varchar('name', { length: 160 }).notNull(),
  taxId: varchar('tax_id', { length: 20 }),
  addressLine: varchar('address_line', { length: 200 }),
  cityLine: varchar('city_line', { length: 200 }),
  phone: varchar('phone', { length: 40 }),
  email: varchar('email', { length: 160 }),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

// Facturas: income = emitidas (numeración correlativa YYYYNNN, alimentan
// Cuentas y Trimestrales); expense = gastos añadidos a mano.
// Los importes se calculan en servidor (céntimos, redondeo mitad-arriba) y se
// guardan congelados: una factura emitida no debe recalcularse sola.
export const invoices = mysqlTable('invoices', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  kind: mysqlEnum('kind', ['income', 'expense']).notNull(),
  // Flujo de emisión: crear (draft) -> revisar/aprobar (reviewed) -> enviar (sent).
  // Una factura enviada queda congelada (no editable).
  status: mysqlEnum('status', ['draft', 'reviewed', 'sent']).notNull().default('draft'),
  clientId: bigint('client_id', { mode: 'number' }).references(() => invoiceClients.id),
  origin: varchar('origin', { length: 200 }).notNull(), // a quién se factura / de quién es el gasto
  number: varchar('number', { length: 40 }).notNull(),
  issueDate: date('issue_date', { mode: 'string' }).notNull(),
  concept: varchar('concept', { length: 255 }),
  base: decimal('base', { precision: 12, scale: 2 }).notNull(),
  vatPct: decimal('vat_pct', { precision: 5, scale: 2 }).notNull(),
  irpfPct: decimal('irpf_pct', { precision: 5, scale: 2 }).notNull(),
  vatAmount: decimal('vat_amount', { precision: 12, scale: 2 }).notNull(),
  irpfAmount: decimal('irpf_amount', { precision: 12, scale: 2 }).notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
  emailedTo: varchar('emailed_to', { length: 160 }),
  emailedAt: datetime('emailed_at'),
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
export type AutonomoProfile = typeof autonomoProfile.$inferSelect;
export type InvoiceClient = typeof invoiceClients.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
