// Abrir el portal a varias personas.
//
// El modelo de datos ya era multiusuario (cada fila lleva su dueño). Lo que
// faltaba era: quién manda, quién puede entrar, qué módulos ve cada uno, y que
// las consultas no recorran filas ajenas.
//
// Uso:  node scripts/add-multiusuario.mjs
//
// SQL directo (drizzle-kit push se cuelga con TiDB). Idempotente.
import 'dotenv/config';
import mysql from 'mysql2/promise';

const BD = process.env.DB_NAME;
const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: BD,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  connectTimeout: 20000,
});

async function existeColumna(tabla, columna) {
  const [r] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [BD, tabla, columna],
  );
  return r.length > 0;
}

async function existeTabla(tabla) {
  const [r] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [BD, tabla],
  );
  return r.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. La cuenta: quién es, qué puede y si sigue activa
// ─────────────────────────────────────────────────────────────────────────────
const COLUMNAS_USERS = [
  // 'admin' solo administra el portal (altas y uso). NO da acceso a datos ajenos.
  ['role', `ADD COLUMN role varchar(16) NOT NULL DEFAULT 'user' AFTER username`],
  ['display_name', 'ADD COLUMN display_name varchar(80) NULL AFTER role'],
  // Lista separada por comas de ids de módulo. NULL = todavía no ha elegido.
  ['modules', 'ADD COLUMN modules varchar(255) NULL AFTER display_name'],
  // Para saber si una cuenta se usa. Es una fecha, no un rastro de actividad:
  // no se guarda QUÉ hizo, solo cuándo pasó por última vez.
  ['last_seen_at', 'ADD COLUMN last_seen_at datetime NULL'],
  // Cortar el acceso sin borrar nada: los datos siguen siendo suyos.
  ['disabled_at', 'ADD COLUMN disabled_at datetime NULL'],
];

console.log('users:');
for (const [nombre, sql] of COLUMNAS_USERS) {
  if (await existeColumna('users', nombre)) {
    console.log(`  · ${nombre} ya existía`);
  } else {
    await conn.query(`ALTER TABLE users ${sql}`);
    console.log(`  ✔ ${nombre}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Invitaciones: la única puerta de entrada
// ─────────────────────────────────────────────────────────────────────────────
// No hay registro abierto. Se crea una invitación, se pasa el enlace, y ese
// enlace caduca y se gasta una sola vez. Del token se guarda solo el hash: si
// alguien leyera la tabla, no podría usar las invitaciones pendientes.
if (await existeTabla('invites')) {
  console.log('invites: · la tabla ya existía');
} else {
  await conn.query(`
    CREATE TABLE invites (
      id bigint NOT NULL AUTO_INCREMENT,
      token_hash varchar(64) NOT NULL,
      note varchar(120) NULL,
      modules varchar(255) NULL,
      created_by bigint NOT NULL,
      expires_at datetime NOT NULL,
      used_at datetime NULL,
      used_by bigint NULL,
      revoked_at datetime NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_invites_token (token_hash),
      KEY idx_invites_created_by (created_by, created_at)
    )
  `);
  console.log('invites: ✔ tabla creada');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Índices por dueño
// ─────────────────────────────────────────────────────────────────────────────
// Con una sola persona daba igual: todas las filas eran suyas. Con cinco, una
// consulta sin índice por user_id recorre las filas de los demás para
// descartarlas. Se indexa (user_id, <lo que más se ordena o filtra>) porque un
// índice de una sola columna obliga a ordenar después.
const INDICES = [
  ['gym_sets', 'idx_gym_sets_user', '(user_id, session_id)'],
  ['gym_exercises', 'idx_gym_exercises_user', '(user_id, day_id, sort_order)'],
  ['events', 'idx_events_user', '(user_id, event_date)'],
  ['invoices', 'idx_invoices_user', '(user_id, issue_date)'],
  ['invoice_clients', 'idx_invoice_clients_user', '(user_id, name)'],
  ['autonomo_profile', 'idx_autonomo_profile_user', '(user_id)'],
  ['roadmap_items', 'idx_roadmap_items_user', '(user_id, status)'],
  ['routine_items', 'idx_routine_items_user', '(user_id, archived_at)'],
  ['routine_slots', 'idx_routine_slots_user', '(user_id, item_id)'],
  ['routine_checks', 'idx_routine_checks_user', '(user_id, check_date)'],
  ['push_subscriptions', 'idx_push_subs_user', '(user_id)'],
  ['daily_check_done', 'idx_daily_check_done_user', '(user_id, check_date)'],
  ['password_resets', 'idx_password_resets_user', '(user_id, expires_at)'],
  ['dream_images', 'idx_dream_images_user', '(user_id, dream_id)'],
  ['dream_steps', 'idx_dream_steps_user', '(user_id, dream_id)'],
  ['dream_links', 'idx_dream_links_user', '(user_id, dream_id)'],
  ['focus_daily', 'idx_focus_daily_user', '(user_id, done_date)'],
  ['focus_tasks', 'idx_focus_tasks_user', '(user_id, item_id)'],
];

console.log('índices por dueño:');
for (const [tabla, nombre, columnas] of INDICES) {
  if (!(await existeTabla(tabla))) {
    console.log(`  · ${tabla} no existe, se salta`);
    continue;
  }
  const [ya] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [BD, tabla, nombre],
  );
  if (ya.length) {
    console.log(`  · ${tabla}.${nombre} ya existía`);
    continue;
  }
  // Si alguna columna del índice no existe en esta base, mejor saltar que
  // reventar a medio script: el resto de índices sí deben aplicarse.
  const pedidas = columnas.replace(/[()]/g, '').split(',').map((c) => c.trim());
  const faltan = [];
  for (const c of pedidas) if (!(await existeColumna(tabla, c))) faltan.push(c);
  if (faltan.length) {
    console.log(`  ! ${tabla}: no existe ${faltan.join(', ')}, se salta`);
    continue;
  }
  await conn.query(`CREATE INDEX ${nombre} ON ${tabla} ${columnas}`);
  console.log(`  ✔ ${tabla} ${columnas}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. El primer usuario es el administrador
// ─────────────────────────────────────────────────────────────────────────────
// Y con todos los módulos: es quien ya tenía datos en todos ellos.
const [usuarios] = await conn.query('SELECT id, username, role FROM users ORDER BY id');
if (!usuarios.length) {
  console.log('admin: · no hay usuarios todavía');
} else {
  const primero = usuarios[0];
  if (primero.role === 'admin') {
    console.log(`admin: · ${primero.username} ya lo era`);
  } else {
    await conn.query('UPDATE users SET role = ? WHERE id = ?', ['admin', primero.id]);
    console.log(`admin: ✔ ${primero.username}`);
  }
  const [r] = await conn.query('UPDATE users SET modules = ? WHERE id = ? AND modules IS NULL', [
    // Los seis, Road Map incluido: se pinta aparte del menú pero se enciende
    // como cualquier otro, y él lo usa.
    'agenda,suenos,salud,org,autonomo,roadmap',
    primero.id,
  ]);
  if (r.affectedRows) console.log('  ✔ módulos del admin: todos');
}

const [[n]] = await conn.query('SELECT COUNT(*) AS n FROM users');
console.log(`\nListo. ${n.n} usuario(s) en el portal.`);
await conn.end();
