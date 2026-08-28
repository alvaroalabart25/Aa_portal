import 'dotenv/config';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
const conn = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
});
const [r] = await conn.query('SELECT id, token_version FROM users ORDER BY id LIMIT 1');
console.log('TOKEN=' + jwt.sign({ sub: String(r[0].id), tv: r[0].token_version ?? 0 }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '25m' }));
await conn.end();
