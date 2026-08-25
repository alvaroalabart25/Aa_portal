/**
 * El bloc de notas: lo que se apunta a vuelapluma y todavía no es nada.
 *
 * Una fila por DÍA con contenido. No hay filas vacías: si un día no escribes,
 * ese día no existe, y así el bloc no se convierte en una lista interminable de
 * días en blanco. La fila nace al escribir y se borra al vaciarla.
 *
 * La fecha es la clave —una por usuario y día—, que es lo que hace que el
 * título del día salga UNA sola vez por mucho que vuelvas a escribir.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-notas.mjs
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

if (await existeTabla('notes')) {
  console.log('· notes ya existía');
} else {
  await conn.query(`
    CREATE TABLE notes (
      id bigint NOT NULL AUTO_INCREMENT,
      user_id bigint NOT NULL,
      -- el día al que pertenece lo escrito; único por usuario
      note_date date NOT NULL,
      body text NOT NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_nota_dia (user_id, note_date)
    )
  `);
  console.log('+ notes');
}

await conn.end();
console.log('listo.');
