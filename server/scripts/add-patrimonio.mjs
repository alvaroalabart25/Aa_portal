/**
 * La foto diaria del patrimonio.
 *
 * El portal guarda el saldo de cada cuenta y lo PISA en cada sincronización, así
 * que sin esto no hay histórico que dibujar. La curva se puede reconstruir hacia
 * atrás restando los movimientos, pero solo hasta donde llegan: PSD2 da 90 días
 * y ahí se acaba. Una foto guardada no caduca.
 *
 * Una fila por día y por cuenta del portal, con lo suyo y lo que solo guarda
 * (el IVA) separados, porque son cosas distintas.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-patrimonio.mjs
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

if (await existeTabla('bank_balance_daily')) {
  console.log('· bank_balance_daily ya existía');
} else {
  await conn.query(`
    CREATE TABLE bank_balance_daily (
      id bigint NOT NULL AUTO_INCREMENT,
      user_id bigint NOT NULL,
      on_date date NOT NULL,
      -- lo suyo
      total decimal(14,2) NOT NULL,
      -- lo que solo guarda (el IVA del pocket de Hacienda)
      escrow decimal(14,2) NOT NULL DEFAULT 0,
      accounts int NOT NULL DEFAULT 0,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_saldo_dia (user_id, on_date)
    )
  `);
  console.log('+ bank_balance_daily');
}
await conn.end();
console.log('listo.');
