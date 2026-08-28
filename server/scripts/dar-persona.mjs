/**
 * Enciende el módulo Persona en una cuenta.
 *
 * Los módulos activos se guardan por usuario, así que un módulo nuevo no
 * aparece solo: hay que añadirlo a quien lo va a usar. Aquí, solo al usuario 1
 * —Persona es el diario de conocerse y no se le da a nadie sin pedirlo—.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/dar-persona.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
});

const USUARIO = 1;
const [[u]] = await conn.query('SELECT id, modules, modules_allowed FROM users WHERE id = ?', [USUARIO]);
if (!u) {
  console.log('no existe el usuario', USUARIO);
} else {
  const con = (txt) => {
    const l = String(txt ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return l.includes('persona') ? l : [...l, 'persona'];
  };
  const activos = con(u.modules);
  // `modules_allowed` en null significa «todos», así que solo se toca si tiene lista
  const permitidos = u.modules_allowed == null ? null : con(u.modules_allowed);
  await conn.query('UPDATE users SET modules = ?, modules_allowed = ? WHERE id = ?', [
    activos.join(','),
    permitidos == null ? null : permitidos.join(','),
    USUARIO,
  ]);
  console.log('módulos:', activos.join(', '));
  console.log('permitidos:', permitidos == null ? '(todos)' : permitidos.join(', '));
}
await conn.end();
