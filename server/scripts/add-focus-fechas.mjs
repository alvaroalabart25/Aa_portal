/**
 * Los objetivos con fecha: cuándo se empieza y cuándo se saca.
 *
 * Hasta ahora un objetivo solo sabía de qué MES era, y eso vale para «lo que
 * tengo entre manos» pero no para planificar: «las campañas las saco la primera
 * semana de septiembre y la resi esta misma semana» son dos cosas distintas
 * dentro del mismo mes, y sin día no se pueden dibujar una al lado de la otra.
 *
 * Las dos son opcionales a propósito. Un objetivo sin fecha no es un error: es
 * uno que todavía no has colocado, y la plani lo enseña aparte para que se vea.
 *
 * `starts_on` es cuándo se arranca y `due_on` cuándo se entrega. Con solo la de
 * entrega ya se puede planificar; la de inicio es para lo que dura semanas —el
 * MVP de entrenadores va de septiembre a mediados de octubre— y se dibuja como
 * una barra en vez de como un hito.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-focus-fechas.mjs
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

const existeCol = async (col) =>
  (
    await conn.query(
      'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
      [BD, 'focus_items', col],
    )
  )[0].length > 0;

for (const col of ['starts_on', 'due_on']) {
  if (await existeCol(col)) {
    console.log(`· focus_items.${col} ya existía`);
  } else {
    await conn.query(`ALTER TABLE focus_items ADD COLUMN ${col} date NULL`);
    console.log(`+ focus_items.${col}`);
  }
}

await conn.end();
console.log('listo.');
