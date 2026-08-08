// Asigna las PARTES a los ejercicios que ya estaban cargados y recalcula el
// bloque muscular a partir de ellas.
// Uso:  node scripts/seed-gym-partes.mjs
//
// Solo toca los ejercicios que aún no tienen partes. Lo asigné yo leyendo el
// nombre: revísalo en el portal, que es tu rutina y no la mía.
import 'dotenv/config';
import mysql from 'mysql2/promise';

const BLOQUE_DE = {
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

// Por nombre exacto del ejercicio tal como quedó cargado
const PARTES_DE = {
  'Sentadilla con Barra': ['cuadriceps', 'gluteo_mayor'],
  'Prensa de Piernas': ['cuadriceps', 'gluteo_mayor'],
  'Jalón al Pecho (agarre V)': ['dorsal', 'biceps'],
  'Jalón al Pecho (agarre medio)': ['dorsal'],
  'SS · Remo con mancuerna + Encogimiento de hombros': ['espalda_media', 'trapecio'],
  'Dominadas': ['dorsal', 'biceps'],

  'Peso Muerto Rumano': ['isquios_cadera', 'gluteo_mayor', 'lumbar'],
  'Extensión de Cuádriceps': ['cuadriceps'],
  'Press Banca (mancuernas)': ['pecho_medio', 'triceps_lateral'],
  'Press Inclinado (mancuernas)': ['pecho_superior', 'hombro_anterior'],
  'Cruce de Poleas (unilateral)': ['pecho_inferior'],
  'Flexiones + Plancha con toque de hombro': ['pecho_medio', 'abdomen'],

  'Sentadilla Búlgara': ['cuadriceps', 'gluteo_mayor'],
  'Abductor (máquina)': ['gluteo_medio'],
  'SS · Extensión de tríceps unilateral + Curl de bíceps en polea': ['triceps_largo', 'biceps'],
  'Elevaciones laterales y frontales': ['hombro_lateral', 'hombro_anterior'],
  'Flexiones, plancha con toque de hombro y abdominales': ['abdomen', 'pecho_medio'],

  'Sentadilla Goblet': ['cuadriceps', 'abdomen'],
  'Hip Thrust (barra)': ['gluteo_mayor', 'isquios_cadera'],
  'Hammer Press de pecho (mancuernas)': ['pecho_medio'],
  'Máquina de aperturas': ['pecho_medio'],
  'SS · Remo con barra T + Dominadas': ['espalda_media', 'dorsal'],
  'Press Arnold (sentado)': ['hombro_anterior', 'hombro_lateral'],
  'Curl concentrado': ['biceps'],
  'Curl Martillo + Press Francés': ['braquial', 'triceps_largo', 'antebrazo'],
};

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  connectTimeout: 20000,
});

const [ejercicios] = await conn.query(
  "SELECT id, name, parts FROM gym_exercises WHERE archived_at IS NULL AND parts = ''",
);

let puestos = 0;
const sinMapa = [];
for (const e of ejercicios) {
  const partes = PARTES_DE[e.name];
  if (!partes) {
    sinMapa.push(e.name);
    continue;
  }
  const bloques = [...new Set(partes.map((p) => BLOQUE_DE[p]))];
  await conn.query('UPDATE gym_exercises SET parts = ?, muscles = ? WHERE id = ?', [
    partes.join(','),
    bloques.join(','),
    e.id,
  ]);
  puestos += 1;
}

console.log(`  ✔ ${puestos} ejercicios etiquetados por parte`);
if (sinMapa.length) console.log(`  · sin mapa (etiquétalos en el portal): ${sinMapa.join(' | ')}`);

const [resumen] = await conn.query(
  "SELECT parts, COUNT(*) n FROM gym_exercises WHERE archived_at IS NULL AND parts <> '' GROUP BY parts ORDER BY n DESC LIMIT 5",
);
console.log('\nMuestra:', resumen);
await conn.end();
