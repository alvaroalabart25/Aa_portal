// Gimnasio: la rutina (días y ejercicios) y lo que de verdad se levanta.
// Uso:  node scripts/add-gym.mjs
//
// SQL directo (drizzle-kit push se cuelga con TiDB). Idempotente: comprueba
// antes de tocar, así que ejecutarlo dos veces no rompe nada.
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  connectTimeout: 20000,
});

const TABLAS = [
  [
    'gym_days',
    `CREATE TABLE gym_days (
      id bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id bigint NOT NULL,
      name varchar(120) NOT NULL,
      notes text NULL,
      sort_order int NOT NULL DEFAULT 0,
      archived_at datetime NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_gym_days_user (user_id, sort_order)
    )`,
  ],
  [
    'gym_exercises',
    `CREATE TABLE gym_exercises (
      id bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id bigint NOT NULL,
      day_id bigint NOT NULL,
      name varchar(160) NOT NULL,
      target_sets int NOT NULL DEFAULT 4,
      target_reps varchar(20) NOT NULL DEFAULT '8-10',
      target_weight decimal(6,2) NULL,
      rest_seconds int NULL,
      notes text NULL,
      sort_order int NOT NULL DEFAULT 0,
      archived_at datetime NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_gym_ex_day (day_id, sort_order)
    )`,
  ],
  [
    'gym_sessions',
    `CREATE TABLE gym_sessions (
      id bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id bigint NOT NULL,
      day_id bigint NOT NULL,
      session_date date NOT NULL,
      started_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at datetime NULL,
      notes text NULL,
      KEY idx_gym_ses_user (user_id, session_date),
      KEY idx_gym_ses_day (day_id, session_date)
    )`,
  ],
  [
    'gym_sets',
    `CREATE TABLE gym_sets (
      id bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id bigint NOT NULL,
      session_id bigint NOT NULL,
      exercise_id bigint NOT NULL,
      exercise_name varchar(160) NOT NULL,
      set_number int NOT NULL,
      reps int NOT NULL,
      weight decimal(6,2) NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_gym_sets_ses (session_id),
      KEY idx_gym_sets_ex (exercise_id, created_at)
    )`,
  ],
];

for (const [nombre, ddl] of TABLAS) {
  const [hay] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [process.env.DB_NAME, nombre],
  );
  if (hay.length) {
    console.log(`  · ${nombre} ya existía`);
  } else {
    await conn.query(ddl);
    console.log(`  ✔ ${nombre} creada`);
  }
}

// Columnas que salieron al ver la rutina de verdad: el grupo muscular con el
// que la tiene organizada, y los ejercicios que se miden en tiempo (planchas)
// en vez de en repeticiones.
const COLUMNAS = [
  // Músculos en lista cerrada y separados por comas («cuadriceps,gluteo»): con
  // texto libre se puede enseñar la etiqueta, pero no contar qué bloque queda
  // sin tocar, que es justo lo que hay que saber.
  ['gym_exercises', 'muscles', "ADD COLUMN muscles varchar(240) NOT NULL DEFAULT '' AFTER day_id"],
  ['gym_exercises', 'kind', "ADD COLUMN kind enum('repes','tiempo') NOT NULL DEFAULT 'repes' AFTER name"],
  ['gym_sets', 'seconds', 'ADD COLUMN seconds int NULL AFTER reps'],
  // Partes dentro del bloque: «pecho» no dice si trabajas el superior o solo el
  // medio. `muscles` se calcula a partir de aquí, no se escribe a mano.
  ['gym_exercises', 'parts', "ADD COLUMN parts varchar(320) NOT NULL DEFAULT '' AFTER muscles"],
];
for (const [tabla, columna, ddl] of COLUMNAS) {
  const [hay] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [process.env.DB_NAME, tabla, columna],
  );
  if (hay.length) console.log(`  · ${tabla}.${columna} ya existía`);
  else {
    await conn.query(`ALTER TABLE ${tabla} ${ddl}`);
    console.log(`  ✔ ${tabla}.${columna} añadida`);
  }
}

// Una plancha no tiene repeticiones: el hueco tiene que poder quedarse vacío
await conn.query('ALTER TABLE gym_sets MODIFY COLUMN reps int NULL');

// muscle_group era texto libre y duraba una hora: lo sustituye `muscles`
const [sobra] = await conn.query(
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'gym_exercises' AND COLUMN_NAME = 'muscle_group'`,
  [process.env.DB_NAME],
);
if (sobra.length) {
  await conn.query('ALTER TABLE gym_exercises DROP COLUMN muscle_group');
  console.log('  ✔ muscle_group retirada (la sustituye muscles)');
}

// Objetivos del gimnasio: la fase en la que estás y las metas medibles.
// El peso corporal NO se guarda aquí: ya vive en health_entries (Salud · Diario)
// y tener dos sitios donde apuntar el mismo kilo acaba en dos verdades.
const [hayMetas] = await conn.query(
  `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'gym_goals'`,
  [process.env.DB_NAME],
);
if (hayMetas.length) {
  console.log('  · gym_goals ya existía');
} else {
  await conn.query(`CREATE TABLE gym_goals (
    id bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id bigint NOT NULL,
    kind enum('fase','peso','ejercicio','libre') NOT NULL DEFAULT 'libre',
    title varchar(160) NOT NULL,
    exercise_id bigint NULL,
    start_value decimal(7,2) NULL,
    target_value decimal(7,2) NULL,
    unit varchar(10) NULL,
    deadline date NULL,
    status enum('activo','logrado','aparcado') NOT NULL DEFAULT 'activo',
    achieved_at date NULL,
    notes text NULL,
    sort_order int NOT NULL DEFAULT 0,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_gym_goals_user (user_id, status, sort_order)
  )`);
  console.log('  ✔ gym_goals creada');
}

// Condicionantes del cuerpo: lesiones y limitaciones que cambian cómo entrenas.
// Van aparte de los objetivos porque no son algo a conseguir, son algo con lo
// que se convive, y tienen que poder avisar en la pantalla de entrenar.
const [hayCond] = await conn.query(
  `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'gym_conditions'`,
  [process.env.DB_NAME],
);
if (hayCond.length) {
  console.log('  · gym_conditions ya existía');
} else {
  await conn.query(`CREATE TABLE gym_conditions (
    id bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id bigint NOT NULL,
    title varchar(160) NOT NULL,
    side enum('izquierdo','derecho','ambos','na') NOT NULL DEFAULT 'na',
    muscles varchar(240) NOT NULL DEFAULT '',
    severity enum('cuidado','evitar') NOT NULL DEFAULT 'cuidado',
    advice text NULL,
    notes text NULL,
    since date NULL,
    status enum('activo','superado') NOT NULL DEFAULT 'activo',
    sort_order int NOT NULL DEFAULT 0,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_gym_cond_user (user_id, status)
  )`);
  console.log('  ✔ gym_conditions creada');
}

// Cuatro días de salida, para no empezar delante de una pantalla vacía. Los
// nombres son de relleno: se renombran en la propia pantalla de Rutina.
const [[u]] = await conn.query('SELECT id FROM users ORDER BY id LIMIT 1');
const [[n]] = await conn.query('SELECT COUNT(*) AS n FROM gym_days WHERE user_id = ?', [u.id]);
if (n.n === 0) {
  const dias = ['Día A', 'Día B', 'Día C', 'Día D'];
  for (let i = 0; i < dias.length; i += 1) {
    await conn.query('INSERT INTO gym_days (user_id, name, sort_order) VALUES (?, ?, ?)', [u.id, dias[i], i]);
  }
  console.log(`  ✔ ${dias.length} días de rutina creados (renómbralos desde el portal)`);
} else {
  console.log(`  · ya había ${n.n} días de rutina`);
}

await conn.end();
