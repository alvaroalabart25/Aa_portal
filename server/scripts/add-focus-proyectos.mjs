/**
 * Los proyectos de un objetivo.
 *
 * Hasta ahora un objetivo colgaba de tareas sueltas, y eso obliga a buscarlas
 * por todo el portal cada vez. Un objetivo de verdad sale de uno o varios
 * PROYECTOS —«la web de la residencia» son sus páginas, «las campañas» son las
 * de CSO— y dentro de ellos se elige qué tareas cuentan.
 *
 * La relación con las tareas NO desaparece: sigue siendo la que manda, porque
 * no todas las tareas de un proyecto son de este objetivo. Los proyectos solo
 * dicen DÓNDE buscar, y dónde crear una tarea nueva desde el objetivo.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-focus-proyectos.mjs
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

if (await existeTabla('focus_projects')) {
  console.log('· focus_projects ya existía');
} else {
  await conn.query(`
    CREATE TABLE focus_projects (
      id bigint NOT NULL AUTO_INCREMENT,
      user_id bigint NOT NULL,
      item_id bigint NOT NULL,
      project_id bigint NOT NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_objetivo_proyecto (item_id, project_id),
      KEY idx_fp_user (user_id)
    )
  `);
  console.log('+ focus_projects');
}

// Los proyectos de las tareas que ya estaban colgadas: si un objetivo ya vive
// de tres tareas de un proyecto, ese proyecto es suyo y no hay que declararlo
// otra vez a mano.
const [r] = await conn.query(`
  INSERT IGNORE INTO focus_projects (user_id, item_id, project_id)
  SELECT DISTINCT fi.user_id, ft.item_id, t.project_id
    FROM focus_tasks ft
    JOIN focus_items fi ON fi.id = ft.item_id
    JOIN tasks t ON t.id = ft.task_id
   WHERE t.archived_at IS NULL AND fi.archived_at IS NULL
`);
console.log(`+ ${r.affectedRows} proyectos deducidos de las tareas que ya había`);

await conn.end();
console.log('listo.');
