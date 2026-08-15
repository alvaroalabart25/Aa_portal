// Las superseries también viajan entre cuentas vinculadas.
//
// gym_changes gana dos tipos (ss_alta, ss_baja) y una columna `extra` con los
// nombres e identidades de los ejercicios implicados: una superserie son DOS
// ejercicios y el campo de nombre solo lleva uno.
//
// Uso:  node scripts/add-gym-cambios-ss.mjs
// SQL directo. Idempotente.
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
  connectTimeout: 20000,
});

const [[col]] = await conn.query(
  "SELECT COLUMN_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='gym_changes' AND COLUMN_NAME='kind'",
  [BD],
);
if (col.t.includes('ss_alta')) console.log('· kind ya tenía ss_alta/ss_baja');
else {
  await conn.query("ALTER TABLE gym_changes MODIFY kind enum('alta','baja','objetivo','ss_alta','ss_baja') NOT NULL");
  console.log('✔ kind ampliado con ss_alta y ss_baja');
}

const [ya] = await conn.query(
  "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='gym_changes' AND COLUMN_NAME='extra'",
  [BD],
);
if (ya.length) console.log('· extra ya existía');
else {
  await conn.query('ALTER TABLE gym_changes ADD COLUMN extra varchar(600) NULL');
  console.log('✔ columna extra');
}
await conn.end();
