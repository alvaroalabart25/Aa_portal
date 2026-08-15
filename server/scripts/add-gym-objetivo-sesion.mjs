/**
 * El OBJETIVO declarado de cada sesión (gym_days.goal_main / goal_side).
 *
 * Al crear una sesión se declara qué se quiere entrenar (grupos grandes:
 * pecho, espalda, hombros, brazos, pierna, core). Lo principal la cobertura
 * lo exige entero; lo secundario («mi pierna de todos los días») solo pide
 * presencia. Los días existentes quedan sin objetivo: se declara con un toque
 * y, mientras tanto, la cobertura se deriva de los ejercicios como hasta ahora.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-gym-objetivo-sesion.mjs
 */
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
});

const tieneColumna = async (t, c) =>
  (await conn.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [BD, t, c]))[0]
    .length > 0;

console.log('columnas:');
for (const c of ['goal_main', 'goal_side']) {
  if (await tieneColumna('gym_days', c)) {
    console.log(`  · gym_days.${c} ya existía`);
  } else {
    await conn.query(`ALTER TABLE gym_days ADD COLUMN ${c} varchar(240) NOT NULL DEFAULT ''`);
    console.log(`  ✔ gym_days.${c}`);
  }
}

await conn.end();
console.log('hecho.');
