import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  datetime,
  date,
  decimal,
  double,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  varchar,
  type AnyMySqlColumn,
} from 'drizzle-orm/mysql-core';

// LONGBLOB: bytes de imagen tal cual. mysql2 los entrega como Buffer.
const longblob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'longblob';
  },
});

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
  // 'admin' administra el portal (dar de alta y ver el uso). NO da acceso a los
  // datos de nadie: no hay una sola consulta que lea contenido ajeno.
  role: varchar('role', { length: 16 }).notNull().default('user'),
  displayName: varchar('display_name', { length: 80 }),
  // Módulos activos, separados por comas (ids de client/src/shell/modules.tsx).
  // NULL = cuenta recién creada que aún no ha elegido.
  modules: varchar('modules', { length: 255 }),
  // Módulos DISPONIBLES para la cuenta (los decide el admin; NULL = todos).
  // De los disponibles, cada uno enciende los suyos en `modules`.
  modulesAllowed: varchar('modules_allowed', { length: 255 }),
  // Pantallas cuya guía de primera vez ya se ha visto (ids del cliente, csv).
  // En el servidor a propósito: reinstalar la PWA no repite el tour.
  guidedSeen: varchar('guided_seen', { length: 600 }).notNull().default(''),
  lastSeenAt: datetime('last_seen_at'), // solo cuándo, nunca qué
  // Cuánto se usa la cuenta: veces que ha entrado (una cada 15 min como mucho)
  // y días distintos en los que ha entrado. `visitsSince` dice desde cuándo se
  // cuenta, porque no hay histórico anterior que recuperar.
  visits: int('visits').notNull().default(0),
  activeDays: int('active_days').notNull().default(0),
  visitsSince: date('visits_since', { mode: 'string' }),
  disabledAt: datetime('disabled_at'), // cortar el acceso sin borrar sus datos
  email: varchar('email', { length: 190 }), // destino de la recuperación de contraseña
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  trackSecret: varchar('track_secret', { length: 64 }), // token del control remoto (Atajos iOS)
  tokenVersion: int('token_version').notNull().default(0), // subirlo invalida todas las sesiones
  totpSecret: varchar('totp_secret', { length: 64 }), // segundo factor (app autenticadora)
  totpEnabled: int('totp_enabled').notNull().default(0),
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
  status: mysqlEnum('status', ['backlog', 'in_progress', 'in_review', 'blocked', 'completed', 'cancelled'])
    .notNull()
    .default('backlog'),
  priority: mysqlEnum('priority', ['low', 'medium', 'high']).notNull().default('medium'),
  notes: text('notes'), // markdown
  dueDate: date('due_date', { mode: 'string' }),
  sortOrder: int('sort_order').notNull().default(0),
  // Cuántas veces se ha empujado la fecha hacia adelante. Adelantarla no cuenta:
  // lo que interesa es ver qué se atasca, no cada vez que se toca la tarea.
  postponedCount: int('postponed_count').notNull().default(0),
  lastPostponedAt: datetime('last_postponed_at'),
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
  eventTime: varchar('event_time', { length: 5 }), // HH:MM opcional (se pinta en el Diario)
  recurrence: mysqlEnum('recurrence', ['none', 'daily', 'monthly', 'yearly']).notNull().default('none'),
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
  isFavorite: int('is_favorite').notNull().default(0), // sale en el menú del control remoto
  isInstant: int('is_instant').notNull().default(0), // puntual (sin duración): Levantarme, Pesarme...
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
  durationMin: int('duration_min').notNull().default(60), // duración del bloque en minutos
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

// Notificaciones push: suscripciones de dispositivos (Web Push) y
// preferencias por tipo de aviso (el configurador).
export const pushSubscriptions = mysqlTable('push_subscriptions', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  endpoint: varchar('endpoint', { length: 500 }).notNull().unique(),
  p256dh: varchar('p256dh', { length: 255 }).notNull(),
  auth: varchar('auth', { length: 255 }).notNull(),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const notificationPrefs = mysqlTable('notification_prefs', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  type: varchar('type', { length: 40 }).notNull(),
  enabled: int('enabled').notNull().default(1),
  sendTime: varchar('send_time', { length: 5 }).notNull().default('09:00'),
  lastSent: date('last_sent', { mode: 'string' }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

// Road Map: seguimiento de mejoras del propio portal, categorizadas por área.
export const roadmapItems = mysqlTable('roadmap_items', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  title: varchar('title', { length: 255 }).notNull(),
  notes: text('notes'), // qué implica la mejora, o su lista de submejoras
  category: mysqlEnum('category', [
    'agenda',
    'organizacion',
    'autonomo',
    'futuros',
    'salud',
    'suenos',
    'seguridad',
    'portal',
  ]).notNull(),
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

// Salud · Diario: marcas puntuales del día (cigarro con su hora, peso en kg)
export const healthEntries = mysqlTable('health_entries', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  kind: varchar('kind', { length: 20 }).notNull(), // cigarro | peso
  value: double('value'), // peso en kg; null para marcas
  entryDate: date('entry_date', { mode: 'string' }).notNull(),
  entryTime: varchar('entry_time', { length: 5 }), // HH:MM hora de Madrid
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Salud · Diario: checks del día (cosas que se repiten a diario y se marcan).
// El catálogo se archiva; lo hecho vive por (check, fecha) y se reinicia solo
// cada día. El check de tipo 'peso' no se marca: se cumple al registrar el kg.
export const dailyChecks = mysqlTable('daily_checks', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  title: varchar('title', { length: 120 }).notNull(),
  emoji: varchar('emoji', { length: 16 }).notNull().default('✅'),
  kind: varchar('kind', { length: 12 }).notNull().default('plain'), // plain | peso
  sortOrder: int('sort_order').notNull().default(0),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dailyCheckDone = mysqlTable('daily_check_done', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  checkId: bigint('check_id', { mode: 'number' })
    .notNull()
    .references(() => dailyChecks.id),
  checkDate: date('check_date', { mode: 'string' }).notNull(),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Salud · Diario: la radiografía del día. Actividades exclusivas y
// secuenciales: empezar una cierra la anterior (end_at). Solo puede haber
// una sesión abierta (end_at NULL). Comparte catálogo con Rutina (routine_items).
export const diarySessions = mysqlTable('diary_sessions', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  itemId: bigint('item_id', { mode: 'number' })
    .notNull()
    .references(() => routineItems.id),
  startAt: datetime('start_at').notNull(),
  endAt: datetime('end_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Recuperación de contraseña: del enlace enviado por correo solo se guarda su
// huella, así que ni con la base delante se puede usar. Un uso y caduca.
export const passwordResets = mysqlTable('password_resets', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  ip: varchar('ip', { length: 64 }),
  expiresAt: datetime('expires_at').notNull(),
  usedAt: datetime('used_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Códigos de recuperación del segundo factor: la salida de emergencia si se
 * pierde el móvil con la app autenticadora.
 *
 * Hacen falta porque el correo de «olvidé mi contraseña» NO quita el segundo
 * factor: sin estos códigos, perder la app dejaría fuera del portal para
 * siempre. Se guarda solo su huella y cada uno sirve una vez.
 */
export const totpRecoveryCodes = mysqlTable('totp_recovery_codes', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  codeHash: varchar('code_hash', { length: 64 }).notNull(),
  usedAt: datetime('used_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Passkeys (Face ID / Touch ID): llaves públicas registradas por dispositivo.
// La privada nunca sale del móvil, así que aquí no hay nada que robar.
export const webauthnCredentials = mysqlTable('webauthn_credentials', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  credentialId: varchar('credential_id', { length: 255 }).notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull().default(0),
  transports: varchar('transports', { length: 120 }),
  deviceName: varchar('device_name', { length: 80 }).notNull().default('Dispositivo'),
  lastUsedAt: datetime('last_used_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Seguridad: bitácora de lo anómalo (accesos fallidos, tokens inválidos,
// límites de tráfico...). De aquí salen los avisos por correo.
export const securityEvents = mysqlTable('security_events', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  kind: varchar('kind', { length: 40 }).notNull(),
  severity: varchar('severity', { length: 10 }).notNull(),
  ip: varchar('ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 255 }),
  detail: varchar('detail', { length: 500 }),
  notified: int('notified').notNull().default(0),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Huella del front publicado: si el HTML en producción cambia sin que haya
// habido un despliegue nuestro, alguien ha tocado los ficheros del servidor.
export const frontIntegrity = mysqlTable('front_integrity', {
  id: int('id').primaryKey(),
  expectedHash: varchar('expected_hash', { length: 64 }).notNull(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// Vista Macro: melones, formaciones y libros del mes
// ============================================================

/**
 * Lo que tengo entre manos este mes. Los tres tipos son la MISMA entidad porque
 * solo cambian en tres detalles: cuántos caben, si agrupan tareas y si tienen
 * gesto diario. Añadir «cursos» o «pódcast» algún día es ampliar el enum.
 *
 * `startMonth` es el mes en que se eligió, no el mes en que se muestra: un
 * melón sigue saliendo mientras no esté hecho, marcando de dónde viene. Que
 * algo lleve tres meses abierto es información.
 */
export const focusItems = mysqlTable('focus_items', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  kind: mysqlEnum('kind', ['melon', 'formacion', 'libro']).notNull(),
  scope: mysqlEnum('scope', ['trabajo', 'personal']).notNull().default('trabajo'),
  title: varchar('title', { length: 200 }).notNull(),
  notes: text('notes'),
  status: mysqlEnum('status', ['activo', 'hecho', 'aparcado']).notNull().default('activo'),
  startMonth: varchar('start_month', { length: 7 }).notNull(), // YYYY-MM
  // Las fechas de la plani. Opcionales a propósito: un objetivo sin fecha no es
  // un error, es uno que todavía no has colocado. `startsOn` solo hace falta en
  // lo que dura semanas —entonces se dibuja como barra en vez de como hito—.
  startsOn: date('starts_on', { mode: 'string' }),
  dueOn: date('due_on', { mode: 'string' }),
  doneAt: date('done_at', { mode: 'string' }),
  daily: int('daily').notNull().default(0), // ¿tiene gesto diario?
  metaId: bigint('meta_id', { mode: 'number' }), // enganche futuro con las Macrometas; hoy NULL
  sortOrder: int('sort_order').notNull().default(0),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

// El gesto diario. `libre` = día libre a propósito: cuenta como cumplido para
// la racha, porque saltarse un día adrede no es abandonar.
export const focusDaily = mysqlTable('focus_daily', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  itemId: bigint('item_id', { mode: 'number' })
    .notNull()
    .references(() => focusItems.id),
  doneDate: date('done_date', { mode: 'string' }).notNull(),
  mark: mysqlEnum('mark', ['hecho', 'libre']).notNull().default('hecho'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Un melón NO posee tareas: las señala. Es el primer agrupador que cruza la
 * jerarquía Espacio→Proyecto→Tarea, y por eso es una tabla puente y no una
 * columna en `tasks`: una tarea sigue viviendo en su proyecto y su espacio.
 * Ejemplo del usuario: el benchmark en Mercado, la landing en Desarrollo y las
 * creatividades en Campañas, con un mismo objetivo.
 */
export const focusTasks = mysqlTable('focus_tasks', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  itemId: bigint('item_id', { mode: 'number' })
    .notNull()
    .references(() => focusItems.id),
  taskId: bigint('task_id', { mode: 'number' })
    .notNull()
    .references(() => tasks.id),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Los proyectos de un objetivo: de dónde salen sus tareas.
 *
 * No sustituye a `focusTasks`, que sigue siendo lo que manda —no todas las
 * tareas de un proyecto son de este objetivo—. Los proyectos dicen dónde
 * buscar, y dónde crear una tarea nueva desde la ficha del objetivo.
 */
export const focusProjects = mysqlTable('focus_projects', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  itemId: bigint('item_id', { mode: 'number' }).notNull(),
  projectId: bigint('project_id', { mode: 'number' }).notNull(),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// Módulo Sueños: macro (sueños de vida), micro (concretos) y lista de deseos
// ============================================================

// Categorías compartidas por los tres apartados del módulo (Viajes, Casa, Deporte...)
export const dreamCategories = mysqlTable('dream_categories', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  name: varchar('name', { length: 80 }).notNull(),
  color: varchar('color', { length: 7 }).notNull().default('#0a0a0a'), // hex
  sortOrder: int('sort_order').notNull().default(0),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Sueños. `kind` separa los dos tableros: macro son sueños de vida, micro son
 * concretos y alcanzables. Un micro PUEDE colgar de un macro (parent_id) o ir
 * suelto: la relación es opcional a propósito.
 *
 * `sort_order` es la prioridad: se ordena arrastrando las tarjetas, así que el
 * orden es un dato del usuario, no algo derivado de la fecha.
 *
 * Los cumplidos NO se ocultan (se quieren ver), por eso `status` y
 * `achieved_at` son datos de primera clase y no un archivado.
 */
export const dreams = mysqlTable('dreams', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  kind: mysqlEnum('kind', ['macro', 'micro']).notNull(),
  // solo para micros: el macro del que cuelgan (NULL = suelto)
  parentId: bigint('parent_id', { mode: 'number' }).references((): AnyMySqlColumn => dreams.id),
  categoryId: bigint('category_id', { mode: 'number' }).references(() => dreamCategories.id),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'), // texto plano con saltos de línea
  status: mysqlEnum('status', ['sonando', 'en_marcha', 'cumplido', 'aparcado']).notNull().default('sonando'),
  targetDate: date('target_date', { mode: 'string' }), // para cuándo lo quieres
  achievedAt: date('achieved_at', { mode: 'string' }), // cuándo lo conseguiste
  costEstimated: decimal('cost_estimated', { precision: 12, scale: 2 }),
  costSaved: decimal('cost_saved', { precision: 12, scale: 2 }),
  sortOrder: int('sort_order').notNull().default(0), // prioridad manual
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

// Ficha de cada imagen. Los bytes viven aparte (dream_image_data) para que
// listar la galería no arrastre megas sin querer. La destacada es la primera
// por sort_order: así no hace falta una referencia cruzada entre tablas.
export const dreamImages = mysqlTable('dream_images', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  dreamId: bigint('dream_id', { mode: 'number' })
    .notNull()
    .references(() => dreams.id),
  mime: varchar('mime', { length: 40 }).notNull().default('image/webp'),
  bytes: int('bytes').notNull().default(0), // tamaño de la versión grande
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Dos tamaños por imagen: miniatura para la rejilla, grande para el detalle.
// El navegador las reduce antes de subirlas, aquí no se procesa nada.
export const dreamImageData = mysqlTable('dream_image_data', {
  imageId: bigint('image_id', { mode: 'number' }).primaryKey(),
  thumb: longblob('thumb').notNull(),
  full: longblob('full').notNull(),
});

// Pasos o hitos para conseguir el sueño (la lista de países de «Viajar»)
export const dreamSteps = mysqlTable('dream_steps', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  dreamId: bigint('dream_id', { mode: 'number' })
    .notNull()
    .references(() => dreams.id),
  title: varchar('title', { length: 255 }).notNull(),
  done: int('done').notNull().default(0),
  doneAt: datetime('done_at'),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Enlaces de referencia e inspiración, con una nota opcional
export const dreamLinks = mysqlTable('dream_links', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  dreamId: bigint('dream_id', { mode: 'number' })
    .notNull()
    .references(() => dreams.id),
  label: varchar('label', { length: 120 }).notNull(),
  url: varchar('url', { length: 500 }).notNull(),
  note: varchar('note', { length: 300 }),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Lista de deseos: cosas que solo te separa el dinero (AirPods, un móvil).
 * Deliberadamente pobre en campos: si algo necesita plan, imágenes o pasos, es
 * un microsueño y se asciende con el botón de convertir.
 */
export const wishlistItems = mysqlTable('wishlist_items', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  title: varchar('title', { length: 200 }).notNull(),
  price: decimal('price', { precision: 12, scale: 2 }),
  url: varchar('url', { length: 500 }),
  categoryId: bigint('category_id', { mode: 'number' }).references(() => dreamCategories.id),
  sortOrder: int('sort_order').notNull().default(0),
  boughtAt: date('bought_at', { mode: 'string' }), // comprado -> pasa al histórico
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

/**
 * Invitaciones: la única puerta de entrada al portal.
 *
 * No hay registro abierto. El administrador crea una invitación, pasa el
 * enlace, y ese enlace caduca y se gasta una sola vez. De la clave se guarda
 * solo el hash: quien leyera esta tabla no podría usar las que estén pendientes.
 */
export const invites = mysqlTable('invites', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  note: varchar('note', { length: 120 }), // para quién es, lo escribe quien invita
  modules: varchar('modules', { length: 255 }), // módulos sugeridos al entrar
  createdBy: bigint('created_by', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  expiresAt: datetime('expires_at').notNull(),
  usedAt: datetime('used_at'),
  usedBy: bigint('used_by', { mode: 'number' }),
  revokedAt: datetime('revoked_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type User = typeof users.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type AutonomoProfile = typeof autonomoProfile.$inferSelect;
export type InvoiceClient = typeof invoiceClients.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;

/**
 * El escaneo de una factura: la foto del móvil.
 *
 * Mismo esquema que las imágenes de Metas: metadatos aquí y bytes aparte, para
 * que listar facturas no arrastre megas de fotos en cada consulta.
 */
export const invoiceImages = mysqlTable('invoice_images', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  invoiceId: bigint('invoice_id', { mode: 'number' }).notNull(),
  mime: varchar('mime', { length: 40 }).notNull().default('image/webp'),
  bytes: int('bytes').notNull().default(0),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const invoiceImageData = mysqlTable('invoice_image_data', {
  imageId: bigint('image_id', { mode: 'number' }).primaryKey(),
  thumb: longblob('thumb').notNull(),
  full: longblob('full').notNull(),
});
export type Dream = typeof dreams.$inferSelect;
export type DreamCategory = typeof dreamCategories.$inferSelect;
export type DreamStep = typeof dreamSteps.$inferSelect;
export type DreamLink = typeof dreamLinks.$inferSelect;
export type WishlistItem = typeof wishlistItems.$inferSelect;

// ============================================================
// Gimnasio: la rutina y lo que de verdad levantas
// ============================================================

/**
 * Un día de la rutina (empuje, tirón, pierna…). Son pocos y fijos: se editan,
 * no se crean y se borran cada semana.
 *
 * No tienen día de la semana a propósito: la rotación siempre es la misma pero
 * los días no, así que lo que toca se deduce del orden y de la última vez que
 * se hizo cada uno, no del calendario.
 */
export const gymDays = mysqlTable('gym_days', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  name: varchar('name', { length: 120 }).notNull(),
  // (sin uso desde que las categorías se derivan de los ejercicios)
  muscles: varchar('muscles', { length: 240 }).notNull().default(''),
  // El OBJETIVO declarado de la sesión, por grupos grandes (partes.ts GRUPOS):
  // lo principal se entrena a fondo y la cobertura lo exige entero; lo
  // secundario acompaña («mi pierna diaria») y solo exige presencia.
  goalMain: varchar('goal_main', { length: 240 }).notNull().default(''),
  goalSide: varchar('goal_side', { length: 240 }).notNull().default(''),
  notes: text('notes'),
  sortOrder: int('sort_order').notNull().default(0),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

/** Un ejercicio dentro de un día, con su objetivo. Lo que TOCA hacer. */
export const gymExercises = mysqlTable('gym_exercises', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  dayId: bigint('day_id', { mode: 'number' })
    .notNull()
    .references(() => gymDays.id),
  // Lista cerrada separada por comas: «cuadriceps,gluteo». Cerrada a propósito,
  // porque con texto libre se puede pintar la etiqueta pero no contar qué
  // bloque muscular se está quedando sin trabajar.
  muscles: varchar('muscles', { length: 240 }).notNull().default(''),
  // Partes dentro del bloque: «pecho» no dice si trabajas el superior o solo el
  // medio, y esa es justo la pregunta. `muscles` se deriva de aquí (solo de las
  // PRINCIPALES: el objetivo de la sesión no incluye lo que trabaja de rebote).
  parts: varchar('parts', { length: 320 }).notNull().default(''),
  // Lo colateral: el bíceps en un jalón, el tríceps en un press. Cuenta como
  // trabajo que existe, pero no crea expectativas de cobertura.
  partsSecondary: varchar('parts_secondary', { length: 320 }).notNull().default(''),
  name: varchar('name', { length: 160 }).notNull(),
  // Una plancha no se mide en repeticiones, se mide en segundos
  kind: mysqlEnum('kind', ['repes', 'tiempo']).notNull().default('repes'),
  targetSets: int('target_sets').notNull().default(4),
  // texto y no número: «8-10» y «al fallo» son objetivos igual de válidos
  targetReps: varchar('target_reps', { length: 20 }).notNull().default('8-10'),
  // en barra, POR UN LADO (ver `barKg`); en lo demás, el peso tal cual
  targetWeight: decimal('target_weight', { precision: 6, scale: 2 }),
  // copia de la del catálogo, como el nombre y el tipo: cambiar el catálogo no
  // puede reescribir un histórico que ya está apuntado
  barKg: decimal('bar_kg', { precision: 5, scale: 2 }),
  restSeconds: int('rest_seconds'),
  notes: text('notes'), // técnica: «codos pegados», «banco a 30°»
  // Identidad en el catálogo: es lo que hace que quitar un ejercicio y volverlo
  // a meter en marzo siga siendo EL MISMO ejercicio para el histórico y el PR.
  catalogId: bigint('catalog_id', { mode: 'number' }),
  // Superserie: los ejercicios del día que comparten este id se hacen
  // alternados (X1, Y1, X2, Y2…). Cada uno conserva sus pesos y sus series.
  supersetId: bigint('superset_id', { mode: 'number' }),
  sortOrder: int('sort_order').notNull().default(0),
  // Improvisado durante un entrenamiento: existe para poder apuntarle series,
  // pero NO forma parte del plan. Al acabar se propone en la pantalla Rutina y
  // solo al aceptarlo se vuelve un ejercicio de verdad (proposedAt a null).
  proposedAt: datetime('proposed_at'),
  proposedFrom: bigint('proposed_from', { mode: 'number' }), // la sesión donde salió
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

/** Una ida al gimnasio. Abierta mientras `endedAt` sea null. */
export const gymSessions = mysqlTable('gym_sessions', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  dayId: bigint('day_id', { mode: 'number' })
    .notNull()
    .references(() => gymDays.id),
  sessionDate: date('session_date', { mode: 'string' }).notNull(),
  startedAt: datetime('started_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  endedAt: datetime('ended_at'),
  // Cómo se vio, del 1 al 5. Dos ejes porque no son lo mismo: se puede acabar
  // reventado y contento, o fresco y de bajón. Un solo número los taparía.
  energy: int('energy'),
  feeling: int('feeling'),
  // cuándo se avisó de «¿has acabado?», para no repetirlo cada hora
  nudgedAt: datetime('nudged_at'),
  notes: text('notes'),
});

/**
 * Una serie hecha, con el peso y las repes DE VERDAD.
 *
 * Guardar cada serie y no un resumen por ejercicio es lo que permite ver que la
 * cuarta serie se cae siempre: un solo número por ejercicio lo escondería.
 * El ejercicio se guarda también por nombre porque la rutina cambia y el
 * histórico no puede quedarse sin saber qué se levantó.
 */
export const gymSets = mysqlTable('gym_sets', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  sessionId: bigint('session_id', { mode: 'number' })
    .notNull()
    .references(() => gymSessions.id),
  exerciseId: bigint('exercise_id', { mode: 'number' })
    .notNull()
    .references(() => gymExercises.id),
  exerciseName: varchar('exercise_name', { length: 160 }).notNull(),
  setNumber: int('set_number').notNull(),
  // Los tiempos de verdad: lo que se descansó ANTES de esta serie y lo que duró
  // la serie. Son la materia prima del descanso adaptativo, y sin medirlos no
  // hay forma de saber que hoy necesitas el doble que el martes.
  restBefore: int('rest_before'),
  duration: int('duration'),
  reps: int('reps'),
  // lo que ibas a hacer: la diferencia con `reps` es lo que dispara el castigo
  plannedReps: int('planned_reps'),
  seconds: int('seconds'),
  weight: decimal('weight', { precision: 6, scale: 2 }),
  punishment: int('punishment').notNull().default(0),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type GymDay = typeof gymDays.$inferSelect;
export type GymExercise = typeof gymExercises.$inferSelect;
export type GymSession = typeof gymSessions.$inferSelect;
export type GymSet = typeof gymSets.$inferSelect;

/**
 * Objetivo del gimnasio: la fase en la que estás («hipertrofia») y las metas
 * medibles («llegar a 80 kg», «sentadilla a 50»).
 *
 * El peso corporal NO se guarda aquí: ya vive en health_entries (Salud ·
 * Diario). Esta meta solo apunta a dónde quieres llegar; el dato de hoy se lee
 * de allí. Dos sitios para apuntar el mismo kilo acaban en dos verdades.
 */
export const gymGoals = mysqlTable('gym_goals', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  kind: mysqlEnum('kind', ['fase', 'peso', 'ejercicio', 'libre']).notNull().default('libre'),
  title: varchar('title', { length: 160 }).notNull(),
  exerciseId: bigint('exercise_id', { mode: 'number' }),
  startValue: decimal('start_value', { precision: 7, scale: 2 }),
  targetValue: decimal('target_value', { precision: 7, scale: 2 }),
  unit: varchar('unit', { length: 10 }),
  deadline: date('deadline', { mode: 'string' }),
  status: mysqlEnum('status', ['activo', 'logrado', 'aparcado']).notNull().default('activo'),
  achievedAt: date('achieved_at', { mode: 'string' }),
  notes: text('notes'),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

export type GymGoal = typeof gymGoals.$inferSelect;

/**
 * Condicionantes del cuerpo: lesiones y limitaciones con las que se convive.
 *
 * Aparte de los objetivos a propósito: un objetivo es algo a conseguir y esto
 * es algo con lo que se entrena. Lleva los músculos afectados para poder avisar
 * en el propio ejercicio, que es donde sirve de algo.
 */
export const gymConditions = mysqlTable('gym_conditions', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  title: varchar('title', { length: 160 }).notNull(),
  side: mysqlEnum('side', ['izquierdo', 'derecho', 'ambos', 'na']).notNull().default('na'),
  muscles: varchar('muscles', { length: 240 }).notNull().default(''),
  severity: mysqlEnum('severity', ['cuidado', 'evitar']).notNull().default('cuidado'),
  advice: text('advice'),
  notes: text('notes'),
  since: date('since', { mode: 'string' }),
  status: mysqlEnum('status', ['activo', 'superado']).notNull().default('activo'),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

export type GymCondition = typeof gymConditions.$inferSelect;

// ============================================================
// Gimnasio compartido: dos cuentas que se pasan la rutina
// ============================================================
//
// LO QUE SE VINCULA SON LOS DÍAS, NO LAS RUTINAS. Compartir la rutina entera
// solo crea varios vínculos de golpe. Si uno borra su «Full body», ese vínculo
// muere y de esa sesión no llega nada más; los demás siguen vivos. Por eso el
// vínculo va por id de día y no por nombre: renombrar no rompe nada.

/** La llave que se pasa por fuera del portal. Solo se guarda su huella. */
export const gymShareCodes = mysqlTable('gym_share_codes', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  codeHash: varchar('code_hash', { length: 64 }).notNull().unique(),
  createdBy: bigint('created_by', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  expiresAt: datetime('expires_at').notNull(),
  usedAt: datetime('used_at'),
  usedBy: bigint('used_by', { mode: 'number' }),
  revokedAt: datetime('revoked_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** Dos cuentas emparejadas. `userA` < `userB` siempre: así (3,7) y (7,3) no
 *  pueden coexistir. Una cuenta puede tener varias parejas. */
export const gymPairs = mysqlTable('gym_pairs', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userA: bigint('user_a', { mode: 'number' }).notNull(),
  userB: bigint('user_b', { mode: 'number' }).notNull(),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  revokedAt: datetime('revoked_at'),
});

/** Un día tuyo atado a un día suyo. Es la unidad de lo compartido. */
export const gymDayLinks = mysqlTable('gym_day_links', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  pairId: bigint('pair_id', { mode: 'number' }).notNull(),
  dayA: bigint('day_a', { mode: 'number' }).notNull(),
  dayB: bigint('day_b', { mode: 'number' }).notNull(),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  brokenAt: datetime('broken_at'),
  brokenReason: varchar('broken_reason', { length: 40 }),
});

/**
 * Un cambio concreto propagado al otro lado.
 *
 * Existe para que el aviso pueda decir «ha añadido Curl martillo» y no «ha
 * cambiado su rutina». `sustituida` es la regla de que NO se acumulan: si el
 * otro vuelve a tocar el mismo ejercicio, la sugerencia vieja se sustituye por
 * la nueva. Rechazar algo no significa que vuelva a aparecer el histórico.
 *
 * Nunca lleva kilos ni notas: los kilos de otro no sirven, y en las notas está
 * lo que cada uno tenga apuntado de su cuerpo.
 */
export const gymChanges = mysqlTable('gym_changes', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  linkId: bigint('link_id', { mode: 'number' }).notNull(),
  fromUser: bigint('from_user', { mode: 'number' }).notNull(),
  toUser: bigint('to_user', { mode: 'number' }).notNull(),
  kind: mysqlEnum('kind', ['alta', 'baja', 'objetivo', 'ss_alta', 'ss_baja']).notNull(),
  exerciseName: varchar('exercise_name', { length: 160 }).notNull(),
  exerciseKind: mysqlEnum('exercise_kind', ['repes', 'tiempo']).notNull().default('repes'),
  parts: varchar('parts', { length: 320 }).notNull().default(''),
  targetSets: int('target_sets'),
  targetReps: varchar('target_reps', { length: 20 }),
  prevSets: int('prev_sets'),
  prevReps: varchar('prev_reps', { length: 20 }),
  catalogId: bigint('catalog_id', { mode: 'number' }), // para casar exacto, no por nombre
  // Para las superseries: JSON con los nombres e identidades de los DOS (o más)
  // ejercicios implicados. El campo de nombre solo lleva uno.
  extra: varchar('extra', { length: 600 }),
  status: mysqlEnum('status', ['pendiente', 'aceptada', 'rechazada', 'sustituida']).notNull().default('pendiente'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: datetime('resolved_at'),
});

export type GymPair = typeof gymPairs.$inferSelect;
export type GymDayLink = typeof gymDayLinks.$inferSelect;
export type GymChange = typeof gymChanges.$inferSelect;

/**
 * El catálogo de ejercicios: el vocabulario del gimnasio.
 *
 * Dos capas con reglas distintas:
 *  - `createdBy` NULL: ejercicio POR DEFECTO, común a todas las cuentas. Existe
 *    para que casi nunca haga falta crear nada y para que dos cuentas hablen
 *    del mismo ejercicio con la misma identidad.
 *  - `createdBy` = una cuenta: ejercicio PRIVADO. Nadie más lo ve.
 */
export const gymCatalog = mysqlTable('gym_catalog', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  name: varchar('name', { length: 160 }).notNull(),
  // principales: lo que el ejercicio ENTRENA. Colaterales: lo que trabaja de
  // rebote (bíceps en un jalón). La cobertura solo exige por las principales.
  parts: varchar('parts', { length: 320 }).notNull().default(''),
  partsSecondary: varchar('parts_secondary', { length: 320 }).notNull().default(''),
  kind: mysqlEnum('kind', ['repes', 'tiempo']).notNull().default('repes'),
  // Con valor: el peso se apunta POR UN LADO y esto es lo que pesa la barra, así
  // que el real son peso × 2 + barra. NULL: el peso apuntado es el total
  // (mancuernas, máquinas, poleas).
  barKg: decimal('bar_kg', { precision: 5, scale: 2 }),
  // explicación genérica del ejercicio (cómo se hace), no notas personales
  explainText: text('explain_text'),
  createdBy: bigint('created_by', { mode: 'number' }),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

/** Tu relación con un ejercicio del catálogo: «lo dejé por el hombro». Es
 *  personal y sobrevive a cualquier cambio de rutina. */
export const gymCatalogNotes = mysqlTable('gym_catalog_notes', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  catalogId: bigint('catalog_id', { mode: 'number' }).notNull(),
  note: text('note').notNull(),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

export type GymCatalogItem = typeof gymCatalog.$inferSelect;

// ---------------------------------------------------------------- el banco
/**
 * Lectura del banco (PSD2, vía Enable Banking). Solo entra lo que el banco
 * deja LEER: cuentas, saldos y movimientos.
 *
 * Aquí NO hay credenciales bancarias y no puede haberlas: quien te identifica
 * es tu propio banco, en su web, y lo único que vuelve es un identificador de
 * sesión que caduca solo (~180 días) y se puede revocar.
 */
export const bankConnections = mysqlTable('bank_connections', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  aspspName: varchar('aspsp_name', { length: 120 }).notNull(),
  aspspCountry: varchar('aspsp_country', { length: 2 }).notNull().default('ES'),
  sessionId: varchar('session_id', { length: 120 }),
  authState: varchar('auth_state', { length: 80 }),
  status: mysqlEnum('status', ['pendiente', 'activa', 'caducada', 'revocada']).notNull().default('pendiente'),
  validUntil: datetime('valid_until'),
  lastSyncAt: datetime('last_sync_at'),
  lastError: varchar('last_error', { length: 300 }),
  // Hasta cuándo no vale la pena volver a preguntar: PSD2 limita las consultas
  // sin el usuario delante, y la pantalla esconde el botón mientras tanto.
  retryAfter: datetime('retry_after'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

/** Una cuenta dentro de una conexión. Del IBAN se guardan solo los últimos
 *  dígitos: el completo no hace falta para nada de lo que hace el portal. */
export const bankAccounts = mysqlTable('bank_accounts', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  connectionId: bigint('connection_id', { mode: 'number' }).notNull(),
  accountUid: varchar('account_uid', { length: 120 }).notNull(),
  name: varchar('name', { length: 160 }),
  ibanTail: varchar('iban_tail', { length: 8 }),
  // Cómo llama el BANCO a esta cuenta: es lo que distingue «Hacienda 💶» de
  // «Inversiones 🏗️», porque de los pockets solo llega el titular en `name`.
  alias: varchar('alias', { length: 80 }),
  // Esta cuenta guarda dinero que NO es suyo: el pocket de Hacienda tiene el IVA
  // de cada factura, que se debe y solo está en depósito. No suma al patrimonio.
  escrow: boolean('escrow').notNull().default(false),
  currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
  balance: decimal('balance', { precision: 14, scale: 2 }),
  balanceAt: datetime('balance_at'),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

/** Los movimientos. `entry_reference` es la referencia del propio banco y por
 *  eso es única por cuenta: sincronizar dos veces no duplica nada. */
export const bankTransactions = mysqlTable('bank_transactions', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  accountId: bigint('account_id', { mode: 'number' }).notNull(),
  entryReference: varchar('entry_reference', { length: 140 }).notNull(),
  bookingDate: date('booking_date', { mode: 'string' }),
  valueDate: date('value_date', { mode: 'string' }),
  amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
  direction: mysqlEnum('direction', ['CRDT', 'DBIT']).notNull(),
  counterparty: varchar('counterparty', { length: 200 }),
  concept: varchar('concept', { length: 500 }),
  status: varchar('status', { length: 8 }).notNull().default('BOOK'),
  invoiceId: bigint('invoice_id', { mode: 'number' }),
  category: varchar('category', { length: 60 }),
  // El código que manda el banco tal cual (Revolut lo manda siempre): la señal
  // más fiable para saber de qué clase es el movimiento.
  bankCode: varchar('bank_code', { length: 40 }),
  // La clase que calcula el portal, del código o del concepto. Ver `tipos.ts`.
  tipo: varchar('tipo', { length: 30 }),
  // El otro lado de un traspaso propio: sale de un banco y entra en otro, así
  // que no es ni ingreso ni gasto.
  pairId: bigint('pair_id', { mode: 'number' }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Compromisos declarados: lo que debes y el banco no puede saber solo.
 *
 * Una deuda con una persona son bizums sueltos en el extracto. Se declara una
 * vez —total, cuota, desde cuándo y cómo reconocer los pagos— y a partir de ahí
 * el portal la sigue contra los movimientos reales.
 */
export const financialCommitments = mysqlTable('financial_commitments', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  kind: varchar('kind', { length: 20 }).notNull().default('deuda'),
  name: varchar('name', { length: 120 }).notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
  monthly: decimal('monthly', { precision: 12, scale: 2 }).notNull(),
  startedOn: date('started_on', { mode: 'string' }).notNull(),
  // lo ya pagado cuando se declaró: el banco solo da 90 días hacia atrás
  paidBefore: decimal('paid_before', { precision: 12, scale: 2 }).notNull().default('0'),
  declaredOn: date('declared_on', { mode: 'string' }).notNull(),
  matcher: varchar('matcher', { length: 120 }),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

export type FinancialCommitment = typeof financialCommitments.$inferSelect;

/**
 * Cuánto de un pago cuenta como deuda de verdad.
 *
 * Los pagos se reconocen por el nombre del acreedor, así que TODO lo que le
 * manda entra como amortización, y no siempre lo es: dentro de un bizum de 188 €
 * había 150 de deuda y 38 de otra cosa. Eso no está en el concepto, está en su
 * cabeza, así que se declara. Se guarda cuánto CUENTA, no cuánto se descuenta.
 */
export const commitmentPaymentParts = mysqlTable('commitment_payment_parts', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  commitmentId: bigint('commitment_id', { mode: 'number' }).notNull(),
  transactionId: bigint('transaction_id', { mode: 'number' }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  note: varchar('note', { length: 140 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});
export type CommitmentPaymentPart = typeof commitmentPaymentParts.$inferSelect;

/**
 * Lo que hace que una deuda cambie de tamaño.
 *
 * El total declarado es lo que se debía el día que se declaró. Si luego le
 * pides más, la deuda es otra — y el número no puede cambiar sin dejar rastro
 * de por qué. Positivo, la deuda crece; negativo, te la rebajan.
 */
export const commitmentChanges = mysqlTable('commitment_changes', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  commitmentId: bigint('commitment_id', { mode: 'number' }).notNull(),
  changeDate: date('change_date', { mode: 'string' }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  note: varchar('note', { length: 160 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
export type CommitmentChange = typeof commitmentChanges.$inferSelect;

/**
 * Objetivos de ahorro. Cada uno apunta a una cuenta real, así que su progreso
 * es el SALDO leído del banco y no un número declarado que hay que mantener: si
 * un día sacas dinero del colchón, el objetivo retrocede solo.
 */
export const financialGoals = mysqlTable('financial_goals', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  name: varchar('name', { length: 120 }).notNull(),
  target: decimal('target', { precision: 12, scale: 2 }).notNull(),
  monthly: decimal('monthly', { precision: 12, scale: 2 }).notNull().default('0'),
  accountId: bigint('account_id', { mode: 'number' }),
  // lo que vive fuera del banco (una inversión que PSD2 no deja leer)
  declared: decimal('declared', { precision: 12, scale: 2 }).notNull().default('0'),
  sortOrder: int('sort_order').notNull().default(0),
  archivedAt: datetime('archived_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

export type FinancialGoal = typeof financialGoals.$inferSelect;

/**
 * La foto diaria del patrimonio.
 *
 * `bank_accounts.balance` guarda el saldo de HOY y lo pisa en cada
 * sincronización. La curva se puede reconstruir hacia atrás restando los
 * movimientos, pero solo hasta donde llegan —PSD2 da 90 días—. Esto no caduca.
 */
export const bankBalanceDaily = mysqlTable('bank_balance_daily', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  onDate: date('on_date', { mode: 'string' }).notNull(),
  total: decimal('total', { precision: 14, scale: 2 }).notNull(),
  escrow: decimal('escrow', { precision: 14, scale: 2 }).notNull().default('0'),
  accounts: int('accounts').notNull().default(0),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

export type BankConnection = typeof bankConnections.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type BankTransaction = typeof bankTransactions.$inferSelect;

/**
 * Las reglas de categoría QUE ÉL CORRIGE. La semilla vive en el código; aquí
 * solo lo suyo, que manda sobre la semilla y no se puede perder en un deploy.
 */
export const bankCategoryRules = mysqlTable('bank_category_rules', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  patron: varchar('patron', { length: 120 }),
  tipo: varchar('tipo', { length: 30 }),
  category: varchar('category', { length: 30 }).notNull(),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
export type BankCategoryRule = typeof bankCategoryRules.$inferSelect;

/**
 * El bloc de notas: una fila por DÍA con contenido.
 *
 * No hay filas vacías. Si un día no escribes, ese día no existe —el bloc no
 * puede ser una lista interminable de días en blanco—, así que la fila nace al
 * escribir y se borra al vaciarla. La fecha es única por usuario, y eso es lo
 * que hace que el título del día salga una sola vez por mucho que vuelvas.
 */
export const notes = mysqlTable('notes', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  noteDate: date('note_date', { mode: 'string' }).notNull(),
  body: text('body').notNull(),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});
export type Note = typeof notes.$inferSelect;
