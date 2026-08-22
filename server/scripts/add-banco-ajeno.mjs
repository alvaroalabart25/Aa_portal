/**
 * Cuentas que guardan dinero que NO es suyo.
 *
 * El pocket de Hacienda guarda el IVA de cada factura: es dinero que se debe y
 * que solo está en depósito hasta el día 20 del trimestre. Sumarlo al patrimonio
 * es mentir —hoy inflaba el total en 565 €—, así que se marca y se enseña aparte.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-banco-ajeno.mjs
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

if (await existe('bank_accounts', 'escrow')) {
  console.log('· escrow ya existía');
} else {
  await conn.query('ALTER TABLE bank_accounts ADD COLUMN escrow tinyint(1) NOT NULL DEFAULT 0');
  console.log('+ escrow');
}

// Las cuentas cuyo nombre en el banco dice que guardan impuestos. Se hace por
// nombre una sola vez; a partir de aquí la marca es de la cuenta, no del nombre.
const [r] = await conn.query(
  "UPDATE bank_accounts SET escrow = 1 WHERE escrow = 0 AND (alias LIKE '%Hacienda%' OR alias LIKE '%IVA%')",
);
console.log(`  marcadas como ajenas: ${r.affectedRows}`);
const [q] = await conn.query('SELECT id, alias, balance, escrow FROM bank_accounts ORDER BY id');
console.table(q);
await conn.end();
