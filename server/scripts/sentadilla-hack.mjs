/**
 * UNA SOLA VEZ: la sentadilla del día de Espalda + Pierna no es de barra.
 *
 * Él la hace en la MÁQUINA de sentadilla hack, y los kilos que apunta son los
 * de la máquina, ya con su peso incluido. Estaba dada de alta como «Sentadilla
 * con Barra» con `bar_kg = 15`, así que el portal la leía como peso POR UN LADO
 * y calculaba peso × 2 + 15. Dos consecuencias:
 *
 *   1. Todo lo apuntado antes del 23/08 se dividió entre dos cuando pasamos el
 *      histórico de barra a «por un lado» (pasar-barra-a-un-lado.mjs). Como
 *      esos kilos nunca fueron de barra, hay que devolverlos: × 2.
 *   2. El objetivo también se dividió: vuelve a su valor.
 *
 * Y como el catálogo es la IDENTIDAD del ejercicio (lo que hace que el
 * histórico siga siendo el mismo si lo quitas y lo vuelves a meter), no vale
 * con renombrar: una hack no es una sentadilla con barra. Se le da de alta su
 * propia entrada de catálogo, sin barra.
 *
 * Toca SOLO el ejercicio del usuario 1. La copia de la rutina compartida es de
 * otra persona y no se toca.
 *
 * No es idempotente en la parte de las series —multiplicar por dos otra vez
 * volvería a romperlo—, así que por defecto NO hace nada: enseña lo que haría.
 *
 *   node scripts/sentadilla-hack.mjs             (en seco)
 *   node scripts/sentadilla-hack.mjs --aplicar
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const APLICAR = process.argv.includes('--aplicar');
const USUARIO = 1;
const NOMBRE_VIEJO = 'Sentadilla con Barra';
const NOMBRE = 'Sentadilla Hack';
// El día en que el histórico de barra se pasó a «por un lado»: solo lo anterior
// se dividió, y solo eso hay que devolver.
const CONVERTIDO_ANTES_DE = '2026-08-23';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
});

const [[ej]] = await conn.query(
  `select e.id, e.name, e.bar_kg, e.target_weight, e.catalog_id, e.parts, e.parts_secondary, e.muscles
     from gym_exercises e
     join gym_days d on d.id = e.day_id
    where e.user_id = ? and e.name = ? and e.archived_at is null
    limit 1`,
  [USUARIO, NOMBRE_VIEJO],
);
if (!ej) {
  console.log(`No hay ningún «${NOMBRE_VIEJO}» activo del usuario ${USUARIO}. Nada que hacer.`);
  await conn.end();
  process.exit(0);
}
console.log(`Ejercicio ${ej.id}: ${ej.name} · barra ${ej.bar_kg} · objetivo ${ej.target_weight} · catálogo ${ej.catalog_id}`);

const [series] = await conn.query(
  // La fecha se pide ya formateada: mysql2 devuelve un DATE como Date local y
  // pasarlo por toISOString lo mueve un día hacia atrás, que es justo el día
  // que decide si esta serie se dividió o no.
  `select gs.id, date_format(se.session_date, '%Y-%m-%d') dia, gs.set_number, gs.weight, gs.reps
     from gym_sets gs join gym_sessions se on se.id = gs.session_id
    where gs.exercise_id = ? and gs.weight is not null and gs.weight > 0
    order by se.session_date, gs.set_number`,
  [ej.id],
);

console.log('\nSeries:');
for (const s of series) {
  const devolver = s.dia < CONVERTIDO_ANTES_DE;
  const nuevo = devolver ? Number(s.weight) * 2 : Number(s.weight);
  console.log(
    `  ${s.dia}  serie ${s.set_number}  ${String(s.weight).padStart(6)} kg` +
      (devolver ? `  →  ${String(nuevo.toFixed(2)).padStart(6)} kg` : '   (tal cual: apuntada después del cambio)'),
  );
}

const objetivo = ej.target_weight === null ? null : (Number(ej.target_weight) * 2).toFixed(2);
console.log(`\nObjetivo: ${ej.target_weight} → ${objetivo}`);
console.log(`Nombre:   ${ej.name} → ${NOMBRE}`);
console.log(`Barra:    ${ej.bar_kg} → NULL (el peso apuntado es el de la máquina, tal cual)`);

const [[cat]] = await conn.query('select id, name from gym_catalog where name = ? limit 1', [NOMBRE]);
console.log(`Catálogo: ${cat ? `ya existe (${cat.id})` : 'se dará de alta «' + NOMBRE + '», sin barra'}`);

if (!APLICAR) {
  console.log('\nEn seco. Para aplicarlo: node scripts/sentadilla-hack.mjs --aplicar');
  await conn.end();
  process.exit(0);
}

let catalogoId = cat?.id;
if (!catalogoId) {
  const [r] = await conn.query(
    `insert into gym_catalog (name, parts, parts_secondary, kind, bar_kg, created_by)
     select ?, parts, parts_secondary, kind, null, ? from gym_catalog where id = ?`,
    [NOMBRE, USUARIO, ej.catalog_id],
  );
  catalogoId = r.insertId;
  console.log(`\n✓ catálogo «${NOMBRE}» dado de alta (${catalogoId})`);
}

for (const s of series) {
  if (s.dia >= CONVERTIDO_ANTES_DE) continue;
  await conn.query('UPDATE gym_sets SET weight = ? WHERE id = ?', [(Number(s.weight) * 2).toFixed(2), s.id]);
}
// El nombre viaja con la serie (es la foto de lo que hiciste ese día), así que
// también hay que corregirlo ahí o el histórico seguirá diciendo «con Barra».
await conn.query('UPDATE gym_sets SET exercise_name = ? WHERE exercise_id = ?', [NOMBRE, ej.id]);
await conn.query('UPDATE gym_exercises SET name = ?, bar_kg = NULL, target_weight = ?, catalog_id = ? WHERE id = ?', [
  NOMBRE,
  objetivo,
  catalogoId,
  ej.id,
]);

console.log(`✓ ${series.filter((s) => s.dia < CONVERTIDO_ANTES_DE).length} series devueltas, ejercicio actualizado.`);
await conn.end();
