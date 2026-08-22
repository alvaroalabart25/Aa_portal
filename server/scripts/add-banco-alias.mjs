/**
 * El nombre que el banco le da a cada cuenta.
 *
 * De los pockets de Revolut solo se guardaba el titular, así que «Hacienda 💶» y
 * «Inversiones 🏗️» salían las dos como «Alvaro Alabart» y no había forma de
 * distinguirlas. El banco sí manda el nombre, en `details`: se guarda aquí.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-banco-alias.mjs
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

const existe = async (t, c) =>
  (
    await conn.query(
      'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
      [BD, t, c],
    )
  )[0].length > 0;

if (await existe('bank_accounts', 'alias')) {
  console.log('· alias ya existía');
} else {
  await conn.query('ALTER TABLE bank_accounts ADD COLUMN alias varchar(80) NULL');
  console.log('+ alias');
}
await conn.end();
console.log('listo.');
