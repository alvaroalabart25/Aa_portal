// Crea las tablas del módulo Sueños.  Uso:  node scripts/add-dreams.mjs
//
// Por qué SQL directo y no drizzle-kit: `push` se queda colgado contra TiDB
// Cloud. Las tablas se crean sin claves foráneas (solo índices), igual que el
// resto del esquema, porque así se crearon las anteriores.
//
// Es idempotente (IF NOT EXISTS): ejecutarlo dos veces no rompe nada.
import 'dotenv/config';
import mysql from 'mysql2/promise';

const TABLAS = [
  `CREATE TABLE IF NOT EXISTS dream_categories (
     id bigint NOT NULL AUTO_INCREMENT,
     user_id bigint NOT NULL,
     name varchar(80) NOT NULL,
     color varchar(7) NOT NULL DEFAULT '#0a0a0a',
     sort_order int NOT NULL DEFAULT 0,
     archived_at datetime DEFAULT NULL,
     created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_user (user_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,

  `CREATE TABLE IF NOT EXISTS dreams (
     id bigint NOT NULL AUTO_INCREMENT,
     user_id bigint NOT NULL,
     kind enum('macro','micro') NOT NULL,
     parent_id bigint DEFAULT NULL,
     category_id bigint DEFAULT NULL,
     title varchar(200) NOT NULL,
     description text,
     status enum('sonando','en_marcha','cumplido','aparcado') NOT NULL DEFAULT 'sonando',
     target_date date DEFAULT NULL,
     achieved_at date DEFAULT NULL,
     cost_estimated decimal(12,2) DEFAULT NULL,
     cost_saved decimal(12,2) DEFAULT NULL,
     sort_order int NOT NULL DEFAULT 0,
     archived_at datetime DEFAULT NULL,
     created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_user_kind (user_id, kind, sort_order),
     KEY idx_parent (parent_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,

  `CREATE TABLE IF NOT EXISTS dream_images (
     id bigint NOT NULL AUTO_INCREMENT,
     user_id bigint NOT NULL,
     dream_id bigint NOT NULL,
     mime varchar(40) NOT NULL DEFAULT 'image/webp',
     bytes int NOT NULL DEFAULT 0,
     sort_order int NOT NULL DEFAULT 0,
     created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_dream (dream_id, sort_order)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,

  // Los bytes, aparte de la ficha: listar la galería no debe traer megas
  `CREATE TABLE IF NOT EXISTS dream_image_data (
     image_id bigint NOT NULL,
     thumb longblob NOT NULL,
     full longblob NOT NULL,
     PRIMARY KEY (image_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,

  `CREATE TABLE IF NOT EXISTS dream_steps (
     id bigint NOT NULL AUTO_INCREMENT,
     user_id bigint NOT NULL,
     dream_id bigint NOT NULL,
     title varchar(255) NOT NULL,
     done int NOT NULL DEFAULT 0,
     done_at datetime DEFAULT NULL,
     sort_order int NOT NULL DEFAULT 0,
     created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_dream (dream_id, sort_order)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,

  `CREATE TABLE IF NOT EXISTS dream_links (
     id bigint NOT NULL AUTO_INCREMENT,
     user_id bigint NOT NULL,
     dream_id bigint NOT NULL,
     label varchar(120) NOT NULL,
     url varchar(500) NOT NULL,
     note varchar(300) DEFAULT NULL,
     sort_order int NOT NULL DEFAULT 0,
     created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_dream (dream_id, sort_order)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,

  `CREATE TABLE IF NOT EXISTS wishlist_items (
     id bigint NOT NULL AUTO_INCREMENT,
     user_id bigint NOT NULL,
     title varchar(200) NOT NULL,
     price decimal(12,2) DEFAULT NULL,
     url varchar(500) DEFAULT NULL,
     category_id bigint DEFAULT NULL,
     sort_order int NOT NULL DEFAULT 0,
     bought_at date DEFAULT NULL,
     archived_at datetime DEFAULT NULL,
     created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_user (user_id, sort_order)
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

console.log(`Base: ${process.env.DB_NAME} · usuario: ${String(process.env.DB_USER).split('.')[0]}.…`);

for (const sql of TABLAS) {
  const nombre = sql.match(/IF NOT EXISTS (\w+)/)[1];
  await conn.query(sql);
  const [[fila]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${nombre}\``);
  console.log(`  ✔ ${nombre.padEnd(20)} (${fila.n} filas)`);
}

await conn.end();
console.log('Listo.');
