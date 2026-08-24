/**
 * UNA SOLA VEZ: pasar el histórico de barra a «por un lado».
 *
 * Su histórico está mezclado y él lo sabe: en los ejercicios de barra venía
 * apuntando el peso de los DOS lados sumados (sin contar la barra), y en el
 * último entrenamiento —el del 23 de agosto— ya apuntó solo un lado. Para que
 * la serie de datos se pueda comparar, todo lo anterior se divide entre dos.
 *
 * No es idempotente y no puede serlo: dividir entre dos otra vez volvería a
 * romperlo. Por eso por defecto NO hace nada, solo cuenta lo que haría. Para
 * aplicarlo de verdad hay que pedirlo:
 *
 *   node scripts/pasar-barra-a-un-lado.mjs            (en seco)
 *   node scripts/pasar-barra-a-un-lado.mjs --aplicar
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const APLICAR = process.argv.includes('--aplicar');
// El día en que ya apuntó por un lado: de aquí en adelante no se toca nada.
const YA_POR_LADO_DESDE = '2026-08-23';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
});

// Solo los ejercicios que YA están marcados como de barra: la marca la puso
// add-gym-barra.mjs y es la única fuente de verdad de qué se carga por lados.
const [series] = await conn.query(
  `select gs.id, se.session_date dia, gs.exercise_name nombre, gs.weight, ge.bar_kg
     from gym_sets gs
     join gym_sessions se on se.id = gs.session_id
     join gym_exercises ge on ge.id = gs.exercise_id
    where ge.bar_kg is not null
      and gs.weight is not null and gs.weight > 0
      and se.session_date < ?
    order by gs.exercise_name, se.session_date, gs.set_number`,
  [YA_POR_LADO_DESDE],
);

console.log(`${series.length} series a convertir (todo lo anterior al ${YA_POR_LADO_DESDE}):\n`);
let ant = null;
for (const s of series) {
  if (s.nombre !== ant) { console.log('  ' + s.nombre); ant = s.nombre; }
  const lado = Number(s.weight) / 2;
  const total = lado * 2 + Number(s.bar_kg);
  console.log(
    `    ${String(s.dia).slice(0, 10)}  ${String(s.weight).padStart(7)} kg  →  ${String(lado).padStart(6)}/lado  (real ${total} kg)`,
  );
}

const [objetivos] = await conn.query(
  `select e.id, e.name, e.target_weight, e.bar_kg
     from gym_exercises e
    where e.bar_kg is not null and e.target_weight is not null and e.archived_at is null`,
);
console.log(`\n${objetivos.length} objetivos de la rutina a convertir:`);
for (const o of objetivos) {
  const lado = Number(o.target_weight) / 2;
  console.log(`    ${o.name.padEnd(26)} ${String(o.target_weight).padStart(7)} kg  →  ${lado}/lado  (real ${lado * 2 + Number(o.bar_kg)} kg)`);
}

if (!APLICAR) {
  console.log('\nEn seco. Para aplicarlo: node scripts/pasar-barra-a-un-lado.mjs --aplicar');
  await conn.end();
  process.exit(0);
}

for (const s of series) {
  await conn.query('UPDATE gym_sets SET weight = ? WHERE id = ?', [(Number(s.weight) / 2).toFixed(2), s.id]);
}
for (const o of objetivos) {
  await conn.query('UPDATE gym_exercises SET target_weight = ? WHERE id = ?', [
    (Number(o.target_weight) / 2).toFixed(2),
    o.id,
  ]);
}
console.log(`\n✓ ${series.length} series y ${objetivos.length} objetivos convertidos.`);
await conn.end();
