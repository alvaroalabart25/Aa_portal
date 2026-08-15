// Catálogo de ejercicios.
//
// Dos capas, y la diferencia es la regla de privacidad del portal:
//  - Los ejercicios POR DEFECTO (created_by NULL) son el vocabulario común:
//    los ve todo el mundo y existen para que casi nunca haga falta crear nada.
//  - Los que crea una persona (created_by = su id) son SOLO suyos.
//
// Además le da a cada ejercicio una identidad estable: hoy el histórico vive
// colgado de la copia del día y muere con ella. Con catalog_id, quitar Press
// banca de la rutina y volverlo a meter en marzo sigue siendo EL MISMO
// ejercicio, y el PR y la progresión sobreviven.
//
// Uso:  node scripts/add-gym-catalogo.mjs
// SQL directo (drizzle-kit push se cuelga con TiDB). Idempotente.
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
  connectTimeout: 20000,
});

const existeTabla = async (t) =>
  (await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [BD, t]))[0].length > 0;
const existeColumna = async (t, c) =>
  (await conn.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [BD, t, c]))[0]
    .length > 0;

console.log('tablas:');
if (await existeTabla('gym_catalog')) console.log('  · gym_catalog ya existía');
else {
  await conn.query(`CREATE TABLE gym_catalog (
    id bigint NOT NULL AUTO_INCREMENT,
    name varchar(160) NOT NULL,
    parts varchar(320) NOT NULL DEFAULT '',
    kind enum('repes','tiempo') NOT NULL DEFAULT 'repes',
    explain_text text NULL,
    created_by bigint NULL,
    archived_at datetime NULL,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_gym_catalog_owner (created_by, archived_at)
  )`);
  console.log('  ✔ gym_catalog');
}

// La nota personal sobre un ejercicio del catálogo. Sobrevive a la rutina: es
// donde vive «lo dejé por el hombro», para leerlo cuando vuelvas en marzo.
if (await existeTabla('gym_catalog_notes')) console.log('  · gym_catalog_notes ya existía');
else {
  await conn.query(`CREATE TABLE gym_catalog_notes (
    id bigint NOT NULL AUTO_INCREMENT,
    user_id bigint NOT NULL,
    catalog_id bigint NOT NULL,
    note text NOT NULL,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_gym_cat_note (user_id, catalog_id)
  )`);
  console.log('  ✔ gym_catalog_notes');
}

console.log('columnas:');
for (const [tabla, col, sql] of [
  ['gym_exercises', 'catalog_id', 'ADD COLUMN catalog_id bigint NULL'],
  ['gym_changes', 'catalog_id', 'ADD COLUMN catalog_id bigint NULL'],
]) {
  if (await existeColumna(tabla, col)) console.log(`  · ${tabla}.${col} ya existía`);
  else {
    await conn.query(`ALTER TABLE ${tabla} ${sql}`);
    console.log(`  ✔ ${tabla}.${col}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// La lista por defecto
// ─────────────────────────────────────────────────────────────────────────────
// Curada a mano: clásicos de gimnasio con su parte muscular ya etiquetada.
// Los combos personales (superseries «SS · …») NO van aquí a propósito: son de
// quien los inventó y la migración de abajo los convierte en privados suyos.
const T = 'tiempo';
const DEFECTO = [
  // pecho
  ['Press banca (barra)', 'pecho_medio,triceps_lateral'],
  ['Press banca (mancuernas)', 'pecho_medio,triceps_lateral'],
  ['Press inclinado (barra)', 'pecho_superior,hombro_anterior'],
  ['Press inclinado (mancuernas)', 'pecho_superior,hombro_anterior'],
  ['Press declinado', 'pecho_inferior,triceps_lateral'],
  ['Hammer Press de pecho (mancuernas)', 'pecho_medio'],
  ['Press de pecho en máquina', 'pecho_medio'],
  ['Máquina de aperturas', 'pecho_medio'],
  ['Aperturas con mancuernas', 'pecho_medio'],
  ['Cruce de poleas', 'pecho_medio'],
  ['Cruce de poleas de abajo a arriba', 'pecho_superior'],
  ['Cruce de poleas de arriba a abajo', 'pecho_inferior'],
  ['Cruce de Poleas (unilateral)', 'pecho_inferior'],
  ['Fondos en paralelas', 'pecho_inferior,triceps_lateral'],
  ['Flexiones', 'pecho_medio,triceps_lateral'],
  // espalda
  ['Dominadas', 'dorsal,biceps'],
  ['Jalón al pecho', 'dorsal'],
  ['Jalón al Pecho (agarre V)', 'dorsal,biceps'],
  ['Jalón al Pecho (agarre medio)', 'dorsal'],
  ['Remo con barra', 'espalda_media'],
  ['Remo con mancuerna', 'espalda_media'],
  ['Remo en polea baja', 'espalda_media'],
  ['Remo con barra T', 'espalda_media,dorsal'],
  ['Remo en máquina', 'espalda_media'],
  ['Pull-over en polea', 'dorsal'],
  ['Peso muerto', 'lumbar,gluteo_mayor,isquios_cadera'],
  ['Hiperextensiones', 'lumbar,gluteo_mayor'],
  ['Buenos días', 'lumbar,isquios_cadera'],
  // hombro
  ['Press militar (barra)', 'hombro_anterior'],
  ['Press militar (mancuernas)', 'hombro_anterior'],
  ['Press Arnold (sentado)', 'hombro_anterior,hombro_lateral'],
  ['Elevaciones frontales', 'hombro_anterior'],
  ['Elevaciones laterales', 'hombro_lateral'],
  ['Elevaciones laterales en polea', 'hombro_lateral'],
  ['Pájaros con mancuernas', 'hombro_posterior'],
  ['Face pull', 'hombro_posterior,trapecio'],
  ['Aperturas inversas en máquina', 'hombro_posterior'],
  // trapecio
  ['Encogimiento de hombros', 'trapecio'],
  ['Remo al mentón', 'trapecio,hombro_lateral'],
  // bíceps
  ['Curl con barra', 'biceps'],
  ['Curl con mancuernas', 'biceps'],
  ['Curl en polea', 'biceps'],
  ['Curl concentrado', 'biceps'],
  ['Curl predicador (banco Scott)', 'biceps'],
  ['Curl martillo', 'braquial,biceps'],
  ['Curl de bíceps martillo', 'braquial,biceps'],
  ['Curl inverso', 'braquial'],
  // tríceps
  ['Press francés', 'triceps_largo'],
  ['Extensión sobre la cabeza', 'triceps_largo'],
  ['Extensión de tríceps en polea alta', 'triceps_lateral'],
  ['Jalón de tríceps en polea (cuerda)', 'triceps_lateral'],
  ['Fondos en banco', 'triceps_lateral'],
  ['Patada de tríceps', 'triceps_largo'],
  // antebrazo
  ['Curl de muñeca', 'antebrazo'],
  ['Paseo del granjero', 'antebrazo,trapecio', T],
  // core
  ['Plancha', 'abdomen', T],
  ['Plancha lateral', 'oblicuos', T],
  ['Plancha con toque de hombro', 'abdomen', T],
  ['Crunch en polea', 'abdomen'],
  ['Elevaciones de piernas', 'abdomen'],
  ['Leñador en polea', 'oblicuos'],
  ['Giros rusos', 'oblicuos'],
  ['Rueda abdominal', 'abdomen'],
  // pierna
  ['Sentadilla con Barra', 'cuadriceps,gluteo_mayor'],
  ['Sentadilla Goblet', 'cuadriceps,abdomen'],
  ['Sentadilla Búlgara', 'cuadriceps,gluteo_mayor'],
  ['Sentadilla sumo', 'aductores,gluteo_mayor'],
  ['Sentadilla profunda', 'gluteo_mayor,cuadriceps'],
  ['Prensa de Piernas', 'cuadriceps,gluteo_mayor'],
  ['Extensión de Cuádriceps', 'cuadriceps'],
  ['Zancadas', 'cuadriceps,gluteo_mayor'],
  ['Peso Muerto Rumano', 'isquios_cadera,gluteo_mayor,lumbar'],
  ['Curl femoral tumbado', 'isquios_rodilla'],
  ['Curl femoral sentado', 'isquios_rodilla'],
  ['Hip Thrust (barra)', 'gluteo_mayor,isquios_cadera'],
  ['Abductor (máquina)', 'gluteo_medio'],
  ['Aductor en máquina', 'aductores'],
  ['Patada lateral con banda', 'gluteo_medio'],
  ['Elevación de talones de pie', 'gemelo_gastrocnemio'],
  ['Elevación de talones sentado', 'gemelo_soleo'],
];

const norm = (s) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

console.log('siembra:');
const [ya] = await conn.query('SELECT id, name, created_by FROM gym_catalog');
const porNombre = new Map(ya.filter((x) => x.created_by === null).map((x) => [norm(x.name), x.id]));
let sembrados = 0;
for (const [name, parts, kind] of DEFECTO) {
  if (porNombre.has(norm(name))) continue;
  const [r] = await conn.query('INSERT INTO gym_catalog (name, parts, kind, created_by) VALUES (?, ?, ?, NULL)', [
    name,
    parts,
    kind ?? 'repes',
  ]);
  porNombre.set(norm(name), r.insertId);
  sembrados += 1;
}
console.log(`  ✔ ${sembrados} por defecto nuevos (${porNombre.size} en total)`);

// ─────────────────────────────────────────────────────────────────────────────
// Migración: darle identidad a lo que ya existe
// ─────────────────────────────────────────────────────────────────────────────
// Cada ejercicio de rutina (activo O archivado: el histórico también cuenta)
// se casa con el catálogo por nombre. Lo que no case —superseries personales,
// pruebas— se convierte en entrada PRIVADA de su dueño: nadie más la ve.
const [ejercicios] = await conn.query('SELECT id, user_id, name, parts, kind FROM gym_exercises WHERE catalog_id IS NULL');
const privadosPorDueno = new Map(); // `${uid}:${nombre}` -> catalogId
const [privadosYa] = await conn.query('SELECT id, name, created_by FROM gym_catalog WHERE created_by IS NOT NULL');
for (const p of privadosYa) privadosPorDueno.set(`${p.created_by}:${norm(p.name)}`, p.id);

let casados = 0;
let privados = 0;
for (const e of ejercicios) {
  let catId = porNombre.get(norm(e.name));
  if (!catId) {
    const clave = `${e.user_id}:${norm(e.name)}`;
    catId = privadosPorDueno.get(clave);
    if (!catId) {
      const [r] = await conn.query('INSERT INTO gym_catalog (name, parts, kind, created_by) VALUES (?, ?, ?, ?)', [
        e.name,
        e.parts ?? '',
        e.kind ?? 'repes',
        e.user_id,
      ]);
      catId = r.insertId;
      privadosPorDueno.set(clave, catId);
      privados += 1;
    }
  } else {
    casados += 1;
  }
  await conn.query('UPDATE gym_exercises SET catalog_id = ? WHERE id = ?', [catId, e.id]);
}
console.log(`migración: ${casados} casados con la lista común · ${privados} pasan a privados de su dueño`);

const [[tot]] = await conn.query('SELECT COUNT(*) n FROM gym_catalog');
const [[sin]] = await conn.query('SELECT COUNT(*) n FROM gym_exercises WHERE catalog_id IS NULL');
console.log(`\nListo. ${tot.n} ejercicios en el catálogo · ${sin.n} filas de rutina sin identidad (deberían ser 0).`);
await conn.end();
