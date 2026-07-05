import 'dotenv/config';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema';

// keepAlive + idleTimeout: los MySQL gestionados cortan conexiones inactivas;
// sin esto el pool entrega conexiones muertas (ECONNRESET).
// DB_SSL=true -> TLS obligatorio (TiDB Cloud lo exige).
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  connectionLimit: 5,
  maxIdle: 2,
  idleTimeout: 55_000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
});

export const db = drizzle(pool, { schema, mode: 'default' });
export { pool };
