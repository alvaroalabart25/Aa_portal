// La huella estable de una cuenta bancaria.
//
// Enable Banking le da a la MISMA cuenta un `uid` distinto en cada sesión, así
// que al reautorizar un banco no había forma de reconocerla: entraba otra vez
// como cuenta nueva, con su saldo contado dos veces y sus movimientos
// duplicados. Lo que sí es estable es `identification_hash`, que venía en la
// respuesta y no guardábamos.
//
// Uso:  node scripts/add-banco-huella.mjs
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  connectTimeout: 20000,
});

const [[existe]] = await conn.query(
  `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'bank_accounts' AND COLUMN_NAME = 'ident_hash'`,
  [process.env.DB_NAME],
);

if (Number(existe.n) > 0) {
  console.log('  ya estaba: bank_accounts.ident_hash');
} else {
  await conn.query('ALTER TABLE bank_accounts ADD COLUMN ident_hash varchar(120) NULL');
  await conn.query('CREATE INDEX idx_ba_huella ON bank_accounts (user_id, ident_hash)');
  console.log('  añadida: bank_accounts.ident_hash (+ índice)');
}

const [filas] = await conn.query(
  'SELECT COUNT(*) AS n, COUNT(ident_hash) AS con FROM bank_accounts WHERE archived_at IS NULL',
);
console.log(`\n  cuentas: ${filas[0].n} · con huella: ${filas[0].con}`);
console.log('  (las que faltan la cogen en la próxima autorización del banco)');

await conn.end();
