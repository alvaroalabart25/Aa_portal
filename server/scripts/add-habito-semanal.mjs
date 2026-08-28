/**
 * Hábitos que no son de todos los días.
 *
 * «Pasear a Chencho lo hago dos veces por semana, y no siempre en fin de
 * semana». Atarlo a los sábados sería mentira y pedirlo a diario, también:
 * saldría rojo cinco días de siete por hacer justo lo que tocaba.
 *
 * Así que un hábito puede tener OBJETIVO SEMANAL: `weekly_target = 2` quiere
 * decir «dos veces por semana, los días que sean». NULL sigue siendo lo de
 * antes: todos los días.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-habito-semanal.mjs
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

const existeCol = async (t, col) =>
  (
    await conn.query(
      'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
      [BD, t, col],
    )
  )[0].length > 0;

if (await existeCol('daily_checks', 'weekly_target')) {
  console.log('· daily_checks.weekly_target ya existía');
} else {
  await conn.query('ALTER TABLE daily_checks ADD COLUMN weekly_target int NULL AFTER kind');
  console.log('+ daily_checks.weekly_target');
}

await conn.end();
console.log('listo.');
