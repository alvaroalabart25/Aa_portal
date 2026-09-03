// Las tareas que vuelven se quedan sin fecha de vencimiento.
//
// Su fecha no significaba «para cuándo es» sino «cuándo vuelve», y encima se
// podía tocar a mano, así que se contradecía con sus días. Los días son la
// única verdad y el día que toca se calcula.
//
// De un solo uso. En seco por defecto:
//   node scripts/quitar-fecha-recurrentes.mjs
//   node scripts/quitar-fecha-recurrentes.mjs --va
import 'dotenv/config';
import mysql from 'mysql2/promise';

const VA = process.argv.includes('--va');

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  connectTimeout: 20000,
});

const [antes] = await conn.query(
  `SELECT id, user_id, title, repeat_days, DATE_FORMAT(due_date, '%d/%m/%Y') AS vence
     FROM tasks WHERE repeat_days <> '' AND due_date IS NOT NULL`,
);
console.table(antes);

if (!antes.length) {
  console.log('  no hay recurrentes con fecha: nada que hacer');
} else if (VA) {
  const [r] = await conn.query("UPDATE tasks SET due_date = NULL WHERE repeat_days <> '' AND due_date IS NOT NULL");
  console.log(`  fecha quitada a ${r.affectedRows} tareas`);
} else {
  console.log(`\n  EN SECO. Se les quitaría la fecha a ${antes.length}. Repite con --va.`);
}

await conn.end();
