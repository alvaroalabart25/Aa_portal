// Vista Macro: melones, formaciones y libros del mes.
// Uso:  node scripts/add-macro.mjs
//
// SQL directo (drizzle-kit push se cuelga con TiDB). Idempotente.
//
// Los tres son la misma entidad con distinto `kind`: solo cambian en cuántos
// caben, si agrupan tareas y si tienen gesto diario. Así añadir «cursos» o
// «pódcast» algún día es una fila más en el enum, no una tabla nueva.
import 'dotenv/config';
import mysql from 'mysql2/promise';

const TABLAS = [
  `CREATE TABLE IF NOT EXISTS focus_items (
     id bigint NOT NULL AUTO_INCREMENT,
     user_id bigint NOT NULL,
     kind enum('melon','formacion','libro') NOT NULL,
     scope enum('trabajo','personal') NOT NULL DEFAULT 'trabajo',
     title varchar(200) NOT NULL,
     notes text,
     status enum('activo','hecho','aparcado') NOT NULL DEFAULT 'activo',
     -- mes en que se eligió (YYYY-MM). Sigue saliendo en los meses siguientes
     -- mientras no esté hecho, y se marca de dónde viene: que algo lleve tres
     -- meses abierto es información, no un detalle a esconder.
     start_month varchar(7) NOT NULL,
     done_at date DEFAULT NULL,
     -- ¿tiene gesto diario? (las formaciones sí; un libro, si quieres)
     daily int NOT NULL DEFAULT 0,
     -- enganche futuro con las Macrometas: hoy siempre NULL
     meta_id bigint DEFAULT NULL,
     sort_order int NOT NULL DEFAULT 0,
     archived_at datetime DEFAULT NULL,
     created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_user_kind (user_id, kind, status),
     KEY idx_mes (user_id, start_month)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,

  // El gesto diario. 'libre' = día libre a propósito: no rompe la racha.
  `CREATE TABLE IF NOT EXISTS focus_daily (
     id bigint NOT NULL AUTO_INCREMENT,
     user_id bigint NOT NULL,
     item_id bigint NOT NULL,
     done_date date NOT NULL,
     mark enum('hecho','libre') NOT NULL DEFAULT 'hecho',
     created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uniq_item_dia (item_id, done_date)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,

  // Un melón NO posee tareas: las señala. Siguen viviendo en su proyecto y su
  // espacio, que es justo lo que pidió el usuario (el benchmark en Mercado, la
  // landing en Desarrollo, las campañas en Campañas: un mismo objetivo).
  `CREATE TABLE IF NOT EXISTS focus_tasks (
     id bigint NOT NULL AUTO_INCREMENT,
     user_id bigint NOT NULL,
     item_id bigint NOT NULL,
     task_id bigint NOT NULL,
     created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uniq_item_tarea (item_id, task_id),
     KEY idx_tarea (task_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
];

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  connectTimeout: 20000,
});

for (const sql of TABLAS) {
  const nombre = sql.match(/IF NOT EXISTS (\w+)/)[1];
  await conn.query(sql);
  const [[f]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${nombre}\``);
  console.log(`  ✔ ${nombre.padEnd(14)} (${f.n} filas)`);
}

await conn.end();
console.log('Listo.');
