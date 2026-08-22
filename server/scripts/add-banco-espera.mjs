/**
 * Cuándo se puede volver a sincronizar un banco.
 *
 * PSD2 limita las consultas que se pueden hacer sin el usuario delante (unas
 * pocas al día por consentimiento). Cuando el banco dice basta, se apunta aquí
 * hasta cuándo esperar, y la pantalla esconde el botón mientras tanto: enseñar
 * un botón que se sabe que va a fallar no tiene sentido.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-banco-espera.mjs
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

if (await existe('bank_connections', 'retry_after')) {
  console.log('· retry_after ya existía');
} else {
  await conn.query('ALTER TABLE bank_connections ADD COLUMN retry_after datetime NULL');
  console.log('+ retry_after');
}
await conn.end();
console.log('listo.');
