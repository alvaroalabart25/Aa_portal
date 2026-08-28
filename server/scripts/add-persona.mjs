/**
 * El módulo Persona: el diario de conocerse.
 *
 * Una fila por día, como el bloc, y por lo mismo: un día sin escribir no
 * existe. Lo que cambia es de quién es y quién puede leerlo —a Persona solo se
 * entra volviendo a pasar Face ID—, así que vive en SU PROPIA tabla y no
 * mezclado con el bloc. Aislado por construcción: si un día se cuela un fallo
 * en un filtro del bloc, el diario no puede aparecer ahí porque no está.
 *
 * `prompt` guarda la pregunta que había delante al escribir: dentro de un año,
 * una respuesta sin su pregunta no se entiende.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-persona.mjs
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

if (await existeTabla('persona_entries')) {
  console.log('· persona_entries ya existía');
} else {
  await conn.query(`
    CREATE TABLE persona_entries (
      id bigint NOT NULL AUTO_INCREMENT,
      user_id bigint NOT NULL,
      entry_date date NOT NULL,
      body text NOT NULL,
      -- la pregunta que había delante ese día, si la había
      prompt varchar(240) NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_persona_dia (user_id, entry_date)
    )
  `);
  console.log('+ persona_entries');
}

await conn.end();
console.log('listo.');
