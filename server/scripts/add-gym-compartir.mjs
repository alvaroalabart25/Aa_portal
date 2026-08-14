// Compartir rutinas de gimnasio entre dos cuentas.
//
// Lo que se vincula NO son las rutinas, son los DÍAS. Compartir la rutina
// entera solo es la forma cómoda de crear varios vínculos de golpe: si luego
// uno borra su «Full body», ese vínculo muere y de esa sesión no llega nada
// más, mientras los demás siguen vivos.
//
// Uso:  node scripts/add-gym-compartir.mjs
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

const existeTabla = async (t) =>
  (await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [BD, t]))[0].length > 0;
const existeColumna = async (t, c) =>
  (await conn.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [BD, t, c]))[0]
    .length > 0;

async function crear(nombre, sql) {
  if (await existeTabla(nombre)) return console.log(`  · ${nombre} ya existía`);
  await conn.query(sql);
  console.log(`  ✔ ${nombre}`);
}

console.log('tablas:');

// La llave que se pasa por fuera del portal (WhatsApp), como las invitaciones:
// se guarda solo su huella, así que ni leyendo la tabla se puede canjear.
await crear(
  'gym_share_codes',
  `CREATE TABLE gym_share_codes (
    id bigint NOT NULL AUTO_INCREMENT,
    code_hash varchar(64) NOT NULL,
    created_by bigint NOT NULL,
    expires_at datetime NOT NULL,
    used_at datetime NULL,
    used_by bigint NULL,
    revoked_at datetime NULL,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_gym_share_code (code_hash),
    KEY idx_gym_share_codes_user (created_by, created_at)
  )`,
);

// El emparejamiento entre dos cuentas. user_a < user_b SIEMPRE, para que la
// pareja (3,7) y la (7,3) no puedan existir las dos a la vez.
await crear(
  'gym_pairs',
  `CREATE TABLE gym_pairs (
    id bigint NOT NULL AUTO_INCREMENT,
    user_a bigint NOT NULL,
    user_b bigint NOT NULL,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at datetime NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_gym_pair (user_a, user_b),
    KEY idx_gym_pairs_a (user_a),
    KEY idx_gym_pairs_b (user_b)
  )`,
);

// EL VÍNCULO DE VERDAD: un día tuyo atado a un día suyo, por id. Va por id y no
// por nombre para que renombrar el día no rompa nada.
await crear(
  'gym_day_links',
  `CREATE TABLE gym_day_links (
    id bigint NOT NULL AUTO_INCREMENT,
    pair_id bigint NOT NULL,
    day_a bigint NOT NULL,
    day_b bigint NOT NULL,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    broken_at datetime NULL,
    broken_reason varchar(40) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_gym_day_link (day_a, day_b),
    KEY idx_gym_day_links_a (day_a, broken_at),
    KEY idx_gym_day_links_b (day_b, broken_at)
  )`,
);

// El registro de cambios. Sin esto la notificación solo podría decir «ha
// cambiado su rutina», que no sirve para nada.
//
// `status` incluye 'sustituida': si el otro vuelve a tocar el MISMO ejercicio,
// la sugerencia vieja se sustituye por la nueva en vez de acumularse. Los
// cambios no son una bandeja de entrada.
await crear(
  'gym_changes',
  `CREATE TABLE gym_changes (
    id bigint NOT NULL AUTO_INCREMENT,
    link_id bigint NOT NULL,
    from_user bigint NOT NULL,
    to_user bigint NOT NULL,
    kind enum('alta','baja','objetivo') NOT NULL,
    exercise_name varchar(160) NOT NULL,
    exercise_kind enum('repes','tiempo') NOT NULL DEFAULT 'repes',
    parts varchar(320) NOT NULL DEFAULT '',
    target_sets int NULL,
    target_reps varchar(20) NULL,
    prev_sets int NULL,
    prev_reps varchar(20) NULL,
    status enum('pendiente','aceptada','rechazada','sustituida') NOT NULL DEFAULT 'pendiente',
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at datetime NULL,
    PRIMARY KEY (id),
    KEY idx_gym_changes_dest (to_user, status, created_at),
    KEY idx_gym_changes_link (link_id, status)
  )`,
);

// ─────────────────────────────────────────────────────────────────────────────
// Ejercicios improvisados entrenando
// ─────────────────────────────────────────────────────────────────────────────
// Se meten a mano durante la sesión, pero NO entran en el plan: al acabar se
// proponen en la pantalla Rutina y solo al aceptarlos pasan a formar parte.
console.log('gym_exercises:');
const COLUMNAS = [
  ['proposed_at', 'ADD COLUMN proposed_at datetime NULL'],
  ['proposed_from', 'ADD COLUMN proposed_from bigint NULL'],
];
for (const [nombre, sql] of COLUMNAS) {
  if (await existeColumna('gym_exercises', nombre)) console.log(`  · ${nombre} ya existía`);
  else {
    await conn.query(`ALTER TABLE gym_exercises ${sql}`);
    console.log(`  ✔ ${nombre}`);
  }
}

const [[n]] = await conn.query('SELECT COUNT(*) AS n FROM gym_exercises WHERE proposed_at IS NOT NULL');
console.log(`\nListo. Ejercicios propuestos pendientes: ${n.n}.`);
await conn.end();
