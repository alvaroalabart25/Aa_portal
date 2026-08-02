// Road Map: descripción por mejora y categorías de los módulos nuevos.
// Uso:  node scripts/add-roadmap-notes.mjs
//
// SQL directo (drizzle-kit push se cuelga con TiDB). Idempotente: comprueba
// antes de tocar, así que ejecutarlo dos veces no rompe nada.
import 'dotenv/config';
import mysql from 'mysql2/promise';

const CATEGORIAS = ['agenda', 'organizacion', 'autonomo', 'futuros', 'salud', 'suenos', 'seguridad', 'portal'];

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  connectTimeout: 20000,
});

// 1) columna de descripción
const [cols] = await conn.query(
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'roadmap_items' AND COLUMN_NAME = 'notes'`,
  [process.env.DB_NAME],
);
if (cols.length) {
  console.log('  · la columna notes ya existía');
} else {
  await conn.query('ALTER TABLE roadmap_items ADD COLUMN notes text NULL AFTER title');
  console.log('  ✔ columna notes añadida');
}

// 2) categorías nuevas en el enum, conservando las que ya había
const lista = CATEGORIAS.map((c) => `'${c}'`).join(',');
await conn.query(`ALTER TABLE roadmap_items MODIFY COLUMN category enum(${lista}) NOT NULL`);
console.log(`  ✔ categorías: ${CATEGORIAS.join(', ')}`);

const [[f]] = await conn.query('SELECT COUNT(*) AS n FROM roadmap_items');
const [reparto] = await conn.query('SELECT category, COUNT(*) AS n FROM roadmap_items GROUP BY category');
console.log(`\n  ${f.n} mejoras guardadas:`);
for (const r of reparto) console.log(`    ${r.category.padEnd(14)} ${r.n}`);

await conn.end();
console.log('\nListo.');
