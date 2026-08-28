/**
 * Las notas de una tarea o de un proyecto, CON FECHA.
 *
 * Una nota suelta dice qué pasa; una nota fechada dice cómo ha ido. Con la
 * caja de texto única no había forma de ver el histórico: lo de hace tres
 * semanas y lo de ayer eran el mismo párrafo. Ahora cada apunte pertenece a un
 * día, igual que en el bloc.
 *
 * Una fila por día y por ficha: si vuelves a escribir el mismo día, sigues el
 * apunte de ese día en vez de crear otro. Y vaciarlo lo borra, como en el bloc:
 * un día sin nada escrito no existe.
 *
 * `task_id` y `project_id` son excluyentes —una nota es de una tarea O de un
 * proyecto—, y cada una tiene su clave única. Con NULL en la otra, MySQL
 * permite repetidos, que es justo lo que hace falta para que las dos claves
 * puedan convivir en la misma tabla.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-notas-de-ficha.mjs
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

if (await existeTabla('work_notes')) {
  console.log('· work_notes ya existía');
} else {
  await conn.query(`
    CREATE TABLE work_notes (
      id bigint NOT NULL AUTO_INCREMENT,
      user_id bigint NOT NULL,
      -- de una tarea O de un proyecto, nunca de las dos
      task_id bigint NULL,
      project_id bigint NULL,
      note_date date NOT NULL,
      body text NOT NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_nota_tarea (user_id, task_id, note_date),
      UNIQUE KEY uq_nota_proyecto (user_id, project_id, note_date)
    )
  `);
  console.log('+ work_notes');
}

// Lo que ya estaba escrito en la caja de siempre pasa a ser el primer apunte,
// fechado con la última vez que se tocó, que es lo más cerca de la verdad que
// hay. La columna vieja NO se toca: si algo sale mal, sigue estando.
for (const [tabla, columna] of [
  ['tasks', 'task_id'],
  ['projects', 'project_id'],
]) {
  const [r] = await conn.query(
    `INSERT IGNORE INTO work_notes (user_id, ${columna}, note_date, body, created_at, updated_at)
     SELECT t.user_id, t.id, date(t.updated_at), t.notes, t.updated_at, t.updated_at
       FROM ${tabla} t
      WHERE t.notes IS NOT NULL AND trim(t.notes) <> '' AND trim(t.notes) <> '<p><br></p>'`,
  );
  console.log(`· ${tabla}: ${r.affectedRows} nota(s) de siempre pasadas a apunte fechado`);
}

await conn.end();
console.log('listo.');
