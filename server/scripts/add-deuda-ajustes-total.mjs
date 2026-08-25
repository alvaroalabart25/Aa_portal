/**
 * Una deuda no es un número fijo: crece.
 *
 * El total declarado es lo que se debía el día que se declaró. Si luego le
 * pides 700 € más para arreglar el coche, la deuda es otra — y lo que no puede
 * pasar es que el número cambie sin dejar rastro de por qué. Así que cada
 * subida (o rebaja) se apunta con su fecha y su concepto, y el total sale de
 * sumar el declarado más lo apuntado.
 *
 * Es lo mismo que ya se hace con los pagos: el dato crudo no se toca, se
 * guarda la lectura que lo explica.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-deuda-ajustes-total.mjs
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

const existeTabla = async (t) =>
  (await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [BD, t]))[0]
    .length > 0;

if (await existeTabla('commitment_changes')) {
  console.log('· commitment_changes ya existía');
} else {
  await conn.query(`
    CREATE TABLE commitment_changes (
      id bigint NOT NULL AUTO_INCREMENT,
      user_id bigint NOT NULL,
      commitment_id bigint NOT NULL,
      change_date date NOT NULL,
      -- positivo, la deuda crece; negativo, te la perdonan o te la rebajan
      amount decimal(12,2) NOT NULL,
      note varchar(160),
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_cambio_deuda (commitment_id, change_date)
    )
  `);
  console.log('+ commitment_changes');
}

await conn.end();
console.log('listo.');
