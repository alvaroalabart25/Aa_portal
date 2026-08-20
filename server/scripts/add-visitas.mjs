/**
 * Cuántas veces entra cada cuenta en el portal.
 *
 * Hasta ahora solo se guardaba la ÚLTIMA visita, así que no hay histórico que
 * recuperar: el contador empieza a contar desde hoy y por eso se guarda también
 * desde cuándo cuenta (`visits_since`), para que el panel pueda decirlo en vez
 * de dar a entender que ese número es de toda la vida.
 *
 * Dos medidas, porque miden cosas distintas:
 *  - `visits`: veces que ha entrado (una cada 15 min como mucho, el mismo
 *    intervalo que ya usaba el registro de visitas).
 *  - `active_days`: días distintos en los que ha entrado. Es la medida honesta
 *    de «usa el portal»: abrir la app seis veces en una mañana no son seis días.
 *
 * Sigue sin guardarse NADA de lo que hacen dentro: cuándo y cuánto, nunca qué.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-visitas.mjs
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

const tiene = async (c) =>
  (await conn.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [BD, 'users', c]))[0]
    .length > 0;

console.log('columnas:');
const nuevas = [
  ['visits', 'ADD COLUMN visits int NOT NULL DEFAULT 0'],
  ['active_days', 'ADD COLUMN active_days int NOT NULL DEFAULT 0'],
  ['visits_since', 'ADD COLUMN visits_since date NULL'],
];
let creadas = 0;
for (const [col, sql] of nuevas) {
  if (await tiene(col)) {
    console.log(`  · users.${col} ya existía`);
  } else {
    await conn.query(`ALTER TABLE users ${sql}`);
    console.log(`  ✔ users.${col}`);
    creadas += 1;
  }
}

// Solo la primera vez: quien ya ha entrado alguna vez arranca en 1, no en 0
// (un 0 en una cuenta que usas a diario parece un contador roto), y se apunta
// desde cuándo se cuenta.
if (creadas > 0) {
  const [r] = await conn.query(`
    UPDATE users
       SET visits_since = curdate(),
           visits = IF(last_seen_at IS NULL, 0, 1),
           active_days = IF(last_seen_at IS NULL, 0, 1)
     WHERE visits_since IS NULL
  `);
  console.log(`  ✔ ${r.affectedRows} cuentas inicializadas (cuentan desde hoy)`);
}

await conn.end();
console.log('hecho.');
