/**
 * Compromisos declarados: lo que debes y el banco no puede saber solo.
 *
 * Una deuda con una persona son bizums sueltos: el portal ve 188 € y 30 €, pero
 * no sabe que forman parte de 6.090 € que empezaron en septiembre del 25. Eso se
 * declara UNA vez —total, cuota, desde cuándo y cómo reconocer los pagos— y a
 * partir de ahí se sigue contra los movimientos reales.
 *
 * `paid_before` existe por una limitación real: el banco solo da 90 días, así
 * que lo pagado antes de la primera sincronización no se puede contar, hay que
 * decirlo.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-compromisos.mjs
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

if (await existeTabla('financial_commitments')) {
  console.log('· financial_commitments ya existía');
} else {
  await conn.query(`
    CREATE TABLE financial_commitments (
      id bigint NOT NULL AUTO_INCREMENT,
      user_id bigint NOT NULL,
      kind varchar(20) NOT NULL DEFAULT 'deuda',
      name varchar(120) NOT NULL,
      -- lo que se debe en total y lo que se paga cada mes
      total decimal(12,2) NOT NULL,
      monthly decimal(12,2) NOT NULL,
      started_on date NOT NULL,
      -- lo ya pagado cuando se declaró: el banco no llega tan atrás
      paid_before decimal(12,2) NOT NULL DEFAULT 0,
      declared_on date NOT NULL,
      -- con qué texto se reconocen los pagos en el banco
      matcher varchar(120),
      archived_at datetime NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_commitments_user (user_id)
    )
  `);
  console.log('+ financial_commitments');
}
await conn.end();
console.log('listo.');
