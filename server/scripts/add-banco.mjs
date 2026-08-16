/**
 * El banco en el portal: conexiones, cuentas y movimientos.
 *
 * Tres tablas y una regla que las gobierna: aquí solo entra lo que el banco
 * deja LEER (saldos y movimientos). No hay sitio para credenciales bancarias
 * porque nunca las vemos: la autorización se hace en la web del propio banco y
 * lo único que se guarda es el identificador de sesión que devuelve Enable
 * Banking, que caduca solo.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-banco.mjs
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
  (await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [BD, t]))[0].length > 0;

console.log('tablas:');

// 1. La conexión con un banco concreto. Una por banco y cuenta de portal.
if (await existeTabla('bank_connections')) {
  console.log('  · bank_connections ya existía');
} else {
  await conn.query(`
    CREATE TABLE bank_connections (
      id bigint NOT NULL AUTO_INCREMENT,
      user_id bigint NOT NULL,
      -- el banco, tal y como lo nombra Enable Banking
      aspsp_name varchar(120) NOT NULL,
      aspsp_country varchar(2) NOT NULL DEFAULT 'ES',
      -- lo que devuelve el canje del consentimiento; NO es una credencial del
      -- banco: es un identificador de sesión que caduca y se puede revocar
      session_id varchar(120),
      -- mientras se está autorizando, para casar la vuelta del banco
      auth_state varchar(80),
      status enum('pendiente','activa','caducada','revocada') NOT NULL DEFAULT 'pendiente',
      -- hasta cuándo vale el consentimiento (~180 días); luego hay que renovar
      valid_until datetime,
      last_sync_at datetime,
      last_error varchar(300),
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_bc_user (user_id, status),
      KEY idx_bc_state (auth_state)
    )
  `);
  console.log('  ✔ bank_connections');
}

// 2. Cada cuenta dentro de esa conexión (una corriente, otra en otra divisa…).
if (await existeTabla('bank_accounts')) {
  console.log('  · bank_accounts ya existía');
} else {
  await conn.query(`
    CREATE TABLE bank_accounts (
      id bigint NOT NULL AUTO_INCREMENT,
      user_id bigint NOT NULL,
      connection_id bigint NOT NULL,
      -- identificador de la cuenta para pedirle datos a la API
      account_uid varchar(120) NOT NULL,
      name varchar(160),
      -- solo los cuatro últimos: el IBAN completo no hace falta para nada de
      -- lo que hace el portal, y no guardarlo es una preocupación menos
      iban_tail varchar(8),
      currency varchar(3) NOT NULL DEFAULT 'EUR',
      balance decimal(14,2),
      balance_at datetime,
      archived_at datetime,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_ba_user (user_id, archived_at),
      UNIQUE KEY uniq_ba_cuenta (connection_id, account_uid)
    )
  `);
  console.log('  ✔ bank_accounts');
}

// 3. Los movimientos. La clave única por (cuenta, referencia del banco) es lo
//    que hace que sincronizar dos veces no duplique nada.
if (await existeTabla('bank_transactions')) {
  console.log('  · bank_transactions ya existía');
} else {
  await conn.query(`
    CREATE TABLE bank_transactions (
      id bigint NOT NULL AUTO_INCREMENT,
      user_id bigint NOT NULL,
      account_id bigint NOT NULL,
      -- la referencia del propio banco: la ancla de la idempotencia
      entry_reference varchar(140) NOT NULL,
      booking_date date,
      value_date date,
      amount decimal(14,2) NOT NULL,
      currency varchar(3) NOT NULL DEFAULT 'EUR',
      -- CRDT = entra dinero, DBIT = sale
      direction enum('CRDT','DBIT') NOT NULL,
      counterparty varchar(200),
      concept varchar(500),
      -- BOOK contabilizado, PEND pendiente, FUTU futuro
      status varchar(8) NOT NULL DEFAULT 'BOOK',
      -- para la conciliación con facturas, más adelante
      invoice_id bigint,
      category varchar(60),
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_bt_ref (account_id, entry_reference),
      KEY idx_bt_user_fecha (user_id, booking_date),
      KEY idx_bt_cuenta (account_id, booking_date)
    )
  `);
  console.log('  ✔ bank_transactions');
}

await conn.end();
console.log('hecho.');
