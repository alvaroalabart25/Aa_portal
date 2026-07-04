import 'dotenv/config';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema';

// keepAlive + idleTimeout: el MySQL compartido de Raiola corta conexiones
// inactivas; sin esto el pool entrega conexiones muertas (ECONNRESET).
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 5,
  maxIdle: 2,
  idleTimeout: 55_000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
});

export const db = drizzle(pool, { schema, mode: 'default' });
export { pool };
