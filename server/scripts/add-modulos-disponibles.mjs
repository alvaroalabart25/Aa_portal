/**
 * Módulos DISPONIBLES por cuenta (users.modules_allowed).
 *
 * Dos capas que no se pisan: qué módulos PUEDE usar una cuenta lo decide el
 * admin (esta columna; NULL = todos, el comportamiento de siempre), y cuáles
 * de esos tiene encendidos lo sigue decidiendo cada uno desde su
 * Configuración. Nace para quitarle Finanzas a una cuenta sin tocar su
 * elección de módulos ni, por supuesto, su contenido.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-modulos-disponibles.mjs
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

const [ya] = await conn.query(
  'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
  [BD, 'users', 'modules_allowed'],
);
if (ya.length > 0) {
  console.log('· users.modules_allowed ya existía');
} else {
  await conn.query('ALTER TABLE users ADD COLUMN modules_allowed varchar(255) NULL');
  console.log('✔ users.modules_allowed (NULL = todos, como hasta ahora)');
}

await conn.end();
console.log('hecho.');
