// Contador de aplazamientos por tarea: cuántas veces se ha empujado su fecha
// hacia adelante y cuándo fue la última. Sirve para ver qué se atasca.
// Uso:  node scripts/add-aplazamientos.mjs
//
// SQL directo (drizzle-kit push se cuelga con TiDB). Idempotente.
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

const COLUMNAS = [
  ['postponed_count', 'ADD COLUMN postponed_count int NOT NULL DEFAULT 0 AFTER sort_order'],
  ['last_postponed_at', 'ADD COLUMN last_postponed_at datetime NULL AFTER postponed_count'],
];

for (const [nombre, sql] of COLUMNAS) {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tasks' AND COLUMN_NAME = ?`,
    [process.env.DB_NAME, nombre],
  );
  if (cols.length) {
    console.log(`  · la columna ${nombre} ya existía`);
  } else {
    await conn.query(`ALTER TABLE tasks ${sql}`);
    console.log(`  ✔ columna ${nombre} añadida`);
  }
}

// Las tareas que ya existen arrancan a cero: no hay histórico de fechas del que
// deducir cuántas veces se movieron, y adivinarlo sería inventar el dato.
const [[t]] = await conn.query('SELECT COUNT(*) AS n FROM tasks');
console.log(`\n${t.n} tareas, todas a 0 aplazamientos. A partir de ahora se cuentan.`);

await conn.end();
