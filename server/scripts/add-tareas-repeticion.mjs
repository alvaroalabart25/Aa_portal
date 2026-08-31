// Tareas que vuelven: los días de la semana en los que toca y cuándo se hizo
// por última vez.
//
// Uso:  node scripts/add-tareas-repeticion.mjs
//
// SQL directo (drizzle-kit push se cuelga con TiDB) e idempotente: comprueba
// si la columna existe antes de añadirla.
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

async function existe(tabla, columna) {
  const [[fila]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [process.env.DB_NAME, tabla, columna],
  );
  return Number(fila.n) > 0;
}

const COLUMNAS = [
  // '1,2,3,4,5' → lunes a viernes. Vacío → no se repite. Lista y no máscara
  // para poder leerla de un vistazo en la base de datos.
  ['repeat_days', "varchar(20) NOT NULL DEFAULT ''"],
  // El día que se marcó por última vez. Sirve para decir «hecha hoy» sin
  // tener que mirar la fecha de vencimiento, que ya apunta a la próxima.
  ['last_done_at', 'date NULL'],
];

for (const [columna, tipo] of COLUMNAS) {
  if (await existe('tasks', columna)) {
    console.log(`  ya estaba: tasks.${columna}`);
    continue;
  }
  await conn.query(`ALTER TABLE tasks ADD COLUMN ${columna} ${tipo}`);
  console.log(`  añadida:   tasks.${columna}`);
}

const [[cuantas]] = await conn.query(
  "SELECT COUNT(*) AS n FROM tasks WHERE repeat_days <> '' AND archived_at IS NULL",
);
console.log(`\n  tareas que se repiten ahora mismo: ${cuantas.n}`);

await conn.end();
