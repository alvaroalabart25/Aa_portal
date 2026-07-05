// Migración puntual: copia todos los datos de la MySQL de Raiola a TiDB.
// Uso: RAIOLA_PASSWORD=... node scripts/migrate-to-tidb.mjs
import 'dotenv/config';
import mysql from 'mysql2/promise';

const TABLES = ['users', 'spaces', 'projects', 'tasks']; // orden de FKs

const src = await mysql.createConnection({
  host: '178.211.133.59',
  port: 3306,
  user: 'lylomfkn_portalalvaroalabart',
  password: process.env.RAIOLA_PASSWORD,
  database: 'lylomfkn_portalalvaroalabart',
});

const dst = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
});

for (const table of TABLES) {
  const [rows] = await src.query(`SELECT * FROM \`${table}\``);
  if (rows.length === 0) {
    console.log(`- ${table}: vacía`);
    continue;
  }
  const cols = Object.keys(rows[0]);
  const placeholders = `(${cols.map(() => '?').join(',')})`;
  await dst.query(`DELETE FROM \`${table}\``); // idempotente si se relanza
  for (const row of rows) {
    await dst.query(
      `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES ${placeholders}`,
      cols.map((c) => row[c]),
    );
  }
  const [[{ n }]] = await dst.query(`SELECT COUNT(*) n FROM \`${table}\``);
  console.log(`✅ ${table}: ${rows.length} filas copiadas (destino tiene ${n})`);
}

await src.end();
await dst.end();
console.log('🎉 Migración completada');
