/**
 * Objetivos de ahorro: a dónde va el dinero que no se gasta.
 *
 * Cada objetivo apunta a una cuenta real del banco, así que su progreso no es
 * un número declarado que hay que ir actualizando: es el saldo, leído. Si un día
 * sacas 200 € del colchón, el objetivo retrocede solo.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-objetivos.mjs
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

if (await existeTabla('financial_goals')) {
  console.log('· financial_goals ya existía');
} else {
  await conn.query(`
    CREATE TABLE financial_goals (
      id bigint NOT NULL AUTO_INCREMENT,
      user_id bigint NOT NULL,
      name varchar(120) NOT NULL,
      -- a cuánto se quiere llegar
      target decimal(12,2) NOT NULL,
      -- cuánto se mete cada ciclo
      monthly decimal(12,2) NOT NULL DEFAULT 0,
      -- la cuenta real que lo sostiene: el progreso es su saldo, no un apunte
      account_id bigint NULL,
      -- lo que hay fuera del banco (una inversión que no se puede leer)
      declared decimal(12,2) NOT NULL DEFAULT 0,
      sort_order int NOT NULL DEFAULT 0,
      archived_at datetime NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_goals_user (user_id)
    )
  `);
  console.log('+ financial_goals');
}

// El colchón: 3.000 €, decisión suya («un par de salarios»), sostenido por el
// pocket que Revolut llama «Inversiones».
const [[colchon]] = await conn.query(
  "SELECT id FROM bank_accounts WHERE user_id = 1 AND alias LIKE '%Inversiones%' LIMIT 1",
);
const [ya] = await conn.query("SELECT id FROM financial_goals WHERE user_id = 1 AND name = 'Colchón'");
if (ya.length) {
  console.log('  · el colchón ya estaba');
} else {
  await conn.query(
    'INSERT INTO financial_goals (user_id, name, target, monthly, account_id, sort_order) VALUES (1, ?, ?, ?, ?, 0)',
    ['Colchón', 3000, 430, colchon?.id ?? null],
  );
  console.log('  + colchón 3.000 € sobre la cuenta', colchon?.id ?? '(ninguna)');
}
console.table((await conn.query('SELECT id, name, target, monthly, account_id FROM financial_goals'))[0]);
await conn.end();
