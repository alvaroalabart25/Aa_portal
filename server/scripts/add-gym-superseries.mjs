// Superseries y categorías de sesión.
//
// - gym_days.muscles: los bloques generales que trabaja esa sesión («Espalda y
//   pierna» = espalda,cuadriceps,…). Los pone el usuario y el selector de
//   ejercicios se abre filtrado por ellos. Se siembran derivándolos de los
//   ejercicios que ya hay, para no obligar a nadie a rellenarlos.
// - gym_exercises.superset_id: ejercicios del mismo día que comparten grupo se
//   hacen alternados (X1, Y1, X2, Y2…). Cada uno mantiene sus pesos y sus
//   series: la superserie es cómo se ejecutan, no qué son.
//
// Uso:  node scripts/add-gym-superseries.mjs
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

const existeColumna = async (t, c) =>
  (await conn.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [BD, t, c]))[0]
    .length > 0;

console.log('columnas:');
for (const [tabla, col, sql] of [
  ['gym_days', 'muscles', "ADD COLUMN muscles varchar(240) NOT NULL DEFAULT ''"],
  ['gym_exercises', 'superset_id', 'ADD COLUMN superset_id bigint NULL'],
]) {
  if (await existeColumna(tabla, col)) console.log(`  · ${tabla}.${col} ya existía`);
  else {
    await conn.query(`ALTER TABLE ${tabla} ${sql}`);
    console.log(`  ✔ ${tabla}.${col}`);
  }
}

// Sembrar las categorías de cada sesión con lo que ya trabaja
const [dias] = await conn.query("SELECT id FROM gym_days WHERE archived_at IS NULL AND muscles = ''");
let sembrados = 0;
for (const d of dias) {
  const [ej] = await conn.query(
    'SELECT muscles FROM gym_exercises WHERE day_id = ? AND archived_at IS NULL AND proposed_at IS NULL',
    [d.id],
  );
  const set = new Set();
  for (const e of ej) for (const m of String(e.muscles ?? '').split(',')) if (m.trim()) set.add(m.trim());
  if (set.size) {
    await conn.query('UPDATE gym_days SET muscles = ? WHERE id = ?', [[...set].join(','), d.id]);
    sembrados += 1;
  }
}
console.log(`sesiones categorizadas a partir de sus ejercicios: ${sembrados}`);
await conn.end();
