/**
 * El escaneo de una factura: la foto que se hace con el móvil.
 *
 * Mismo esquema que las imágenes de Metas, que ya funciona: los metadatos en
 * una tabla y los bytes en otra, para que listar facturas no arrastre megas de
 * fotos en cada consulta. El navegador reduce la foto antes de subirla —una de
 * móvil pesa 3-6 MB y de aquí salen decenas de kilobytes—, así que al servidor
 * nunca le llega el original.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-factura-imagenes.mjs
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

if (await existeTabla('invoice_images')) {
  console.log('· invoice_images ya existía');
} else {
  await conn.query(`
    CREATE TABLE invoice_images (
      id bigint NOT NULL AUTO_INCREMENT,
      user_id bigint NOT NULL,
      invoice_id bigint NOT NULL,
      mime varchar(40) NOT NULL DEFAULT 'image/webp',
      bytes int NOT NULL DEFAULT 0,
      sort_order int NOT NULL DEFAULT 0,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_img_factura (invoice_id, sort_order)
    )
  `);
  console.log('+ invoice_images');
}

if (await existeTabla('invoice_image_data')) {
  console.log('· invoice_image_data ya existía');
} else {
  await conn.query(`
    CREATE TABLE invoice_image_data (
      image_id bigint NOT NULL,
      thumb longblob NOT NULL,
      full longblob NOT NULL,
      PRIMARY KEY (image_id)
    )
  `);
  console.log('+ invoice_image_data');
}

await conn.end();
console.log('listo.');
