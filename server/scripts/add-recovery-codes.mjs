// Códigos de recuperación del segundo factor.
// Uso:  node scripts/add-recovery-codes.mjs
//
// Sin ellos, perder el móvil con la app autenticadora deja fuera del portal:
// el correo de «olvidé mi contraseña» cambia la contraseña pero NO quita el
// segundo factor, así que el único rescate era entrar a la base a mano.
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

await conn.query(`CREATE TABLE IF NOT EXISTS totp_recovery_codes (
  id bigint NOT NULL AUTO_INCREMENT,
  user_id bigint NOT NULL,
  code_hash varchar(64) NOT NULL,
  used_at datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user (user_id, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);

const [[f]] = await conn.query('SELECT COUNT(*) AS n FROM totp_recovery_codes');
console.log(`  ✔ totp_recovery_codes (${f.n} filas)`);
await conn.end();
console.log('Listo.');
