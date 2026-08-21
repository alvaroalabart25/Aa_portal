/**
 * El cimiento de Finanzas: de qué CLASE es cada movimiento.
 *
 * Tres columnas nuevas en bank_transactions y ninguna tabla más:
 *
 *   bank_code  el código que manda el banco tal cual (Revolut lo manda en el
 *              100% de los movimientos: TRANSFER, CARD_PAYMENT, TOPUP…). Es la
 *              señal más fiable que hay y se estaba tirando a la basura.
 *   tipo       la clase que calcula el portal, del código o del concepto.
 *   pair_id    el OTRO movimiento con el que hace pareja cuando el dinero solo
 *              cambia de bolsillo (sale de Santander, entra en Revolut). Sin
 *              esto, 2.140 € de traspasos se cuentan como gasto y como ingreso.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-banco-tipos.mjs
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

const existeColumna = async (t, c) =>
  (
    await conn.query(
      'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
      [BD, t, c],
    )
  )[0].length > 0;

const existeIndice = async (t, i) =>
  (
    await conn.query('SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?', [
      BD,
      t,
      i,
    ])
  )[0].length > 0;

console.log('columnas:');
for (const [col, tipo] of [
  ['bank_code', 'varchar(40) NULL'],
  ['tipo', 'varchar(30) NULL'],
  ['pair_id', 'bigint NULL'],
]) {
  if (await existeColumna('bank_transactions', col)) {
    console.log(`  · ${col} ya existía`);
  } else {
    await conn.query(`ALTER TABLE bank_transactions ADD COLUMN ${col} ${tipo}`);
    console.log(`  + ${col}`);
  }
}

// El resumen del mes filtra por dueño y rango de fechas: sin este índice son
// 344 filas hoy y una lectura completa el año que viene.
console.log('índices:');
if (await existeIndice('bank_transactions', 'idx_bank_tx_user_fecha')) {
  console.log('  · idx_bank_tx_user_fecha ya existía');
} else {
  await conn.query('CREATE INDEX idx_bank_tx_user_fecha ON bank_transactions (user_id, booking_date)');
  console.log('  + idx_bank_tx_user_fecha');
}

await conn.end();
console.log('listo.');
