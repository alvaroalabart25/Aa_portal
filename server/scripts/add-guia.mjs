/**
 * Guía contextual: qué pantallas ha visto ya cada cuenta.
 *
 * La primera vez que alguien entra en una pantalla, un aviso corto le cuenta
 * qué puede hacer ahí; al tocar «Entendido» la pantalla se apunta aquí y no
 * vuelve a salir. Se guarda POR USUARIO en el servidor (no en el navegador):
 * reinstalar la PWA o cambiar de móvil no repite el tour.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-guia.mjs
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

const [ya] = await conn.query(
  'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
  [BD, 'users', 'guided_seen'],
);
if (ya.length > 0) {
  console.log('· users.guided_seen ya existía');
} else {
  await conn.query("ALTER TABLE users ADD COLUMN guided_seen varchar(600) NOT NULL DEFAULT ''");
  console.log('✔ users.guided_seen');
}

await conn.end();
console.log('hecho.');
