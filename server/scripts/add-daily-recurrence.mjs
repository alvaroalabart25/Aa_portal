// Añade la repetición diaria a los eventos importantes.
// Uso:  node scripts/add-daily-recurrence.mjs
//
// SQL directo (drizzle-kit push se cuelga con TiDB). Idempotente: MODIFY del
// enum conservando los valores que ya existían, así los eventos guardados no
// se tocan.
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

const [[antes]] = await conn.query(
  `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'events' AND COLUMN_NAME = 'recurrence'`,
  [process.env.DB_NAME],
);
console.log(`  antes:   ${antes.t}`);

await conn.query(
  `ALTER TABLE events MODIFY COLUMN recurrence
   enum('none','daily','monthly','yearly') NOT NULL DEFAULT 'none'`,
);

const [[despues]] = await conn.query(
  `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'events' AND COLUMN_NAME = 'recurrence'`,
  [process.env.DB_NAME],
);
console.log(`  después: ${despues.t}`);

const [reparto] = await conn.query('SELECT recurrence, COUNT(*) AS n FROM events GROUP BY recurrence');
console.log('\n  eventos guardados por tipo de repetición:');
for (const r of reparto) console.log(`    ${r.recurrence.padEnd(8)} ${r.n}`);

await conn.end();
console.log('\nListo.');
