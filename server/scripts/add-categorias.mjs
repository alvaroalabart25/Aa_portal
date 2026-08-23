/**
 * Reglas de categoría: las correcciones que hace ÉL en pantalla.
 *
 * La semilla vive en el código (`categorias.ts`) y mejora en cada deploy; aquí
 * solo se guarda lo que él corrige, porque eso no puede perderse en un deploy
 * ni puede pisarlo una regla nueva mía. Por eso sus reglas se miran primero.
 *
 * La columna `bank_transactions.category` ya existía sin usar: es donde se
 * escribe el resultado, para no recalcularlo en cada consulta.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-categorias.mjs
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
const existeIndice = async (t, i) =>
  (await conn.query('SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?', [BD, t, i]))[0]
    .length > 0;

if (await existeTabla('bank_category_rules')) {
  console.log('· bank_category_rules ya existía');
} else {
  await conn.query(`
    CREATE TABLE bank_category_rules (
      id bigint NOT NULL AUTO_INCREMENT,
      user_id bigint NOT NULL,
      -- trozo de texto que tiene que aparecer en el concepto o la contraparte
      patron varchar(120) NULL,
      -- y/o el tipo del movimiento (bizum, recibo…); sin patrón vale por sí solo
      tipo varchar(30) NULL,
      category varchar(30) NOT NULL,
      -- el orden manda: gana la primera que encaja
      sort_order int NOT NULL DEFAULT 0,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_catrules_user (user_id, sort_order)
    )
  `);
  console.log('+ bank_category_rules');
}

// Filtrar por categoría es la consulta nueva más frecuente del listado
if (await existeIndice('bank_transactions', 'idx_tx_categoria')) {
  console.log('· idx_tx_categoria ya existía');
} else {
  await conn.query('CREATE INDEX idx_tx_categoria ON bank_transactions (user_id, category)');
  console.log('+ idx_tx_categoria');
}

await conn.end();
console.log('listo.');
