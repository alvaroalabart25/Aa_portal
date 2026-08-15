/**
 * Partes COLATERALES en el catálogo y en los ejercicios.
 *
 * Un jalón con agarre V entrena la espalda; el bíceps ahí trabaja de rebote.
 * Hasta ahora `parts` lo mezclaba todo y la cobertura entendía que un día de
 * espalda «quería» entrenar bíceps entero. A partir de aquí:
 *   - `parts`            = lo que el ejercicio ENTRENA (principal)
 *   - `parts_secondary`  = lo que trabaja de rebote (colateral)
 * El objetivo de una sesión se deriva SOLO de las principales; las colaterales
 * cuentan como trabajo que existe, pero no crean expectativas.
 *
 * Idempotente: mover una parte dos veces no hace nada la segunda.
 * Ejecutar DESDE server/:  node scripts/add-gym-colaterales.mjs
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

const tieneColumna = async (t, c) =>
  (await conn.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [BD, t, c]))[0]
    .length > 0;

console.log('columnas:');
for (const t of ['gym_catalog', 'gym_exercises']) {
  if (await tieneColumna(t, 'parts_secondary')) {
    console.log(`  · ${t}.parts_secondary ya existía`);
  } else {
    await conn.query(`ALTER TABLE ${t} ADD COLUMN parts_secondary varchar(320) NOT NULL DEFAULT ''`);
    console.log(`  ✔ ${t}.parts_secondary`);
  }
}

// Bloque de cada parte, para recalcular `muscles` (espejo de partes.ts).
const BLOQUE = {
  pecho_superior: 'pecho', pecho_medio: 'pecho', pecho_inferior: 'pecho',
  dorsal: 'espalda', espalda_media: 'espalda', lumbar: 'espalda',
  hombro_anterior: 'hombro', hombro_lateral: 'hombro', hombro_posterior: 'hombro',
  trapecio: 'trapecio',
  biceps: 'biceps', braquial: 'biceps',
  triceps_largo: 'triceps', triceps_lateral: 'triceps',
  antebrazo: 'antebrazo',
  abdomen: 'core', oblicuos: 'core',
  cuadriceps: 'cuadriceps',
  isquios_cadera: 'isquios', isquios_rodilla: 'isquios',
  gluteo_mayor: 'gluteo', gluteo_medio: 'gluteo',
  aductores: 'aductores',
  gemelo_gastrocnemio: 'gemelo', gemelo_soleo: 'gemelo',
};
const lista = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
const musculosDe = (partes) => [...new Set(lista(partes).map((p) => BLOQUE[p]).filter(Boolean))].join(',');

// Qué partes de cada ejercicio COMÚN son colaterales. Curado a mano: el motor
// del movimiento se queda en `parts`; el que asiste se va a `parts_secondary`.
// Los presses de pecho llevan el tríceps (y el hombro en los inclinados) de
// asistente; los tirones de espalda llevan el bíceps; los curl martillo
// trabajan el braquial y el bíceps asiste; etc.
const COLATERALES = [
  ['Press banca (barra)', ['triceps_lateral']],
  ['Press banca (mancuernas)', ['triceps_lateral']],
  ['Press inclinado (barra)', ['hombro_anterior']],
  ['Press inclinado (mancuernas)', ['hombro_anterior']],
  ['Press declinado', ['triceps_lateral']],
  ['Fondos en paralelas', ['triceps_lateral']],
  ['Flexiones', ['triceps_lateral']],
  ['Dominadas', ['biceps']],
  ['Jalón al Pecho (agarre V)', ['biceps']],
  ['Hiperextensiones', ['gluteo_mayor']],
  ['Face pull', ['trapecio']],
  ['Remo al mentón', ['hombro_lateral']],
  ['Curl martillo', ['biceps']],
  ['Curl de bíceps martillo', ['biceps']],
  ['Paseo del granjero', ['trapecio']],
  ['Sentadilla Goblet', ['abdomen']],
  ['Peso Muerto Rumano', ['lumbar']],
  ['Hip Thrust (barra)', ['isquios_cadera']],
];

const norm = (s) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

console.log('catálogo común:');
const [cat] = await conn.query("SELECT id, name, parts, parts_secondary FROM gym_catalog WHERE created_by IS NULL");
const porNombre = new Map(cat.map((c) => [norm(c.name), c]));
let curados = 0;
for (const [nombre, colaterales] of COLATERALES) {
  const c = porNombre.get(norm(nombre));
  if (!c) { console.log(`  · no está: ${nombre}`); continue; }
  const principales = lista(c.parts).filter((p) => !colaterales.includes(p));
  const secundarias = [...new Set([...lista(c.parts_secondary), ...lista(c.parts).filter((p) => colaterales.includes(p))])];
  if (principales.join(',') === c.parts && secundarias.join(',') === c.parts_secondary) continue;
  await conn.query('UPDATE gym_catalog SET parts=?, parts_secondary=? WHERE id=?', [
    principales.join(','), secundarias.join(','), c.id,
  ]);
  curados += 1;
}
console.log(`  ✔ ${curados} entradas curadas (segunda pasada = 0, es normal)`);

// Propagar a los ejercicios de TODAS las rutinas por identidad: solo se mueve
// la intersección con lo curado (si alguien editó sus partes, se respeta), y
// `muscles` se recalcula solo con las principales. No se lee contenido: la
// consulta trae partes y el id, y el script solo enseña cuántos tocó.
console.log('ejercicios existentes:');
const [afectados] = await conn.query(
  `SELECT e.id, e.parts, e.parts_secondary, c.parts_secondary AS cat_sec
   FROM gym_exercises e JOIN gym_catalog c ON c.id = e.catalog_id
   WHERE c.parts_secondary <> ''`,
);
let movidos = 0;
for (const e of afectados) {
  const colaterales = lista(e.cat_sec);
  const mover = lista(e.parts).filter((p) => colaterales.includes(p));
  if (mover.length === 0) continue;
  const principales = lista(e.parts).filter((p) => !colaterales.includes(p));
  const secundarias = [...new Set([...lista(e.parts_secondary), ...mover])];
  await conn.query('UPDATE gym_exercises SET parts=?, parts_secondary=?, muscles=? WHERE id=?', [
    principales.join(','), secundarias.join(','), musculosDe(principales.join(',')), e.id,
  ]);
  movidos += 1;
}
console.log(`  ✔ ${movidos} ejercicios actualizados`);

await conn.end();
console.log('hecho.');
