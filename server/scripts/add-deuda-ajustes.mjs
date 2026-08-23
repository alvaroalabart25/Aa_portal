/**
 * Cuánto de un pago cuenta DE VERDAD como deuda.
 *
 * Los pagos se reconocen por el nombre del acreedor, así que todo lo que le
 * manda a su padre entra como amortización. Y no lo es: dentro de un bizum de
 * 188 € había 150 de deuda y 38 de otra cosa, y un bizum entero de 30 € era un
 * ventilador. Ningún patrón de texto puede saber eso —está en su cabeza, no en
 * el concepto—, así que se declara pago a pago.
 *
 * Se guarda **cuánto cuenta**, no cuánto se quita: 0 es «esto no era deuda» y
 * 150 es «de esos 188, deuda fueron 150». Sin fila, cuenta entero.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-deuda-ajustes.mjs
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

if (await existeTabla('commitment_payment_parts')) {
  console.log('· commitment_payment_parts ya existía');
} else {
  await conn.query(`
    CREATE TABLE commitment_payment_parts (
      id bigint NOT NULL AUTO_INCREMENT,
      user_id bigint NOT NULL,
      commitment_id bigint NOT NULL,
      transaction_id bigint NOT NULL,
      -- cuánto de ese movimiento cuenta como deuda; 0 = nada
      amount decimal(12,2) NOT NULL,
      note varchar(140) NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_parte (commitment_id, transaction_id),
      KEY idx_parte_user (user_id)
    )
  `);
  console.log('+ commitment_payment_parts');
}

await conn.end();
console.log('listo.');
