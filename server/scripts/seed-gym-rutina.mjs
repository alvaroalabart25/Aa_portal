// Carga la rutina que ya estaba usando (las cuatro sesiones que pasó tal cual).
// Uso:  node scripts/seed-gym-rutina.mjs
//
// Solo escribe en los días que estén VACÍOS: si ya has editado la rutina desde
// el portal, este script no toca nada.
import 'dotenv/config';
import mysql from 'mysql2/promise';

// Los pesos que traía escritos por serie («20 25 - 35») van a las notas: el
// objetivo de peso es un número, y la escalera real la va a ir aprendiendo sola
// según lo que registres cada día.
const RUTINA = [
  {
    name: 'Pierna pesada + Espalda',
    ejercicios: [
      ['Sentadilla con Barra', 'cuadriceps,gluteo', 4, '8-10', 50, null, 'Escalera 20 · 25 · 35. Objetivo 50 (lo tenía apuntado el 26 de abril).'],
      ['Prensa de Piernas', 'cuadriceps,aductores', 3, '10', 120, null, 'Escalera 45 · 60 · 65. Objetivo 120.'],
      ['Jalón al Pecho (agarre V)', 'espalda,biceps', 3, '10-12', 70, null, '55 · 70.'],
      ['Jalón al Pecho (agarre medio)', 'espalda', 3, '12', 55, null, null],
      ['SS · Remo con mancuerna + Encogimiento de hombros', 'espalda,trapecio', 3, '10', 25, null, 'Superserie. 20 · 22,5 · 25.'],
      ['Dominadas', 'espalda,biceps', 4, 'al fallo', null, null, 'Fin de fiesta. Mínimo 10; el objetivo son 20.'],
    ],
  },
  {
    name: 'Pierna pesada + Pecho',
    ejercicios: [
      ['Peso Muerto Rumano', 'isquios,gluteo', 4, '10-12', 80, null, '80 kg si va con barra.'],
      ['Extensión de Cuádriceps', 'cuadriceps', 3, '12', 75, null, '65 · 75.'],
      ['Press Banca (mancuernas)', 'pecho,triceps', 3, '10-12', null, null, '55 · 70.'],
      ['Press Inclinado (mancuernas)', 'pecho,hombro', 3, '12', null, null, null],
      ['Cruce de Poleas (unilateral)', 'pecho', 3, '12', 55, null, null],
      ['Flexiones + Plancha con toque de hombro', 'pecho,core', 3, null, null, 75, 'Fin de fiesta. 1:15 por lado.'],
    ],
  },
  {
    name: 'Pierna + Mantenimiento y brazo',
    ejercicios: [
      ['Sentadilla Búlgara', 'cuadriceps,gluteo', 3, '10 por pierna', 17.5, null, null],
      ['Abductor (máquina)', 'gluteo,aductores', 3, '20', null, null, 'Las últimas 4 pesas.'],
      ['Press Banca (mancuernas)', 'pecho,triceps', 3, '10', 25, null, '22,5 · 25.'],
      ['Cruce de Poleas (unilateral)', 'pecho,triceps', 3, 'al fallo (10)', null, null, null],
      ['SS · Extensión de tríceps unilateral + Curl de bíceps en polea', 'triceps,biceps', 3, '12', null, null, 'Superserie, las dos a 12. BM 40 · TM 21,5.'],
      ['Elevaciones laterales y frontales', 'hombro', 3, '10', null, null, null],
      ['Flexiones, plancha con toque de hombro y abdominales', 'core,pecho', 3, null, null, 75, 'Fin de fiesta. 1:15 por lado.'],
    ],
  },
  {
    name: 'Full body',
    ejercicios: [
      ['Sentadilla Goblet', 'cuadriceps,core', 3, '13', 40, null, '30 · 35 · 40.'],
      ['Hip Thrust (barra)', 'gluteo,isquios', 3, '12', 60, null, '30 · 40 · 60.'],
      ['Hammer Press de pecho (mancuernas)', 'pecho', 4, '8-10', 40, null, '30 · 35 · 40.'],
      ['Máquina de aperturas', 'pecho', 3, '10', 25, null, '20 · 22,5 · 25.'],
      ['Press Inclinado (mancuernas)', 'pecho,hombro', 3, '12', null, null, null],
      ['SS · Remo con barra T + Dominadas', 'espalda,biceps', 3, '10', null, null, 'Superserie.'],
      ['Press Arnold (sentado)', 'hombro', 3, '10', 15, null, null],
      ['Curl concentrado', 'biceps', 4, '10', 25, null, '20 · 20 · 25.'],
      ['Curl Martillo + Press Francés', 'biceps,triceps,antebrazo', 3, '12', null, null, 'Curl 15 · 17. Press francés 20 · 22,5.'],
    ],
  },
];

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  connectTimeout: 20000,
});

const [[u]] = await conn.query('SELECT id FROM users ORDER BY id LIMIT 1');
const [dias] = await conn.query(
  'SELECT id, name FROM gym_days WHERE user_id = ? AND archived_at IS NULL ORDER BY sort_order, id',
  [u.id],
);

if (dias.length < RUTINA.length) {
  console.log(`Hay ${dias.length} días y la rutina trae ${RUTINA.length}. Ejecuta antes add-gym.mjs.`);
  await conn.end();
  process.exit(1);
}

let creados = 0;
for (let i = 0; i < RUTINA.length; i += 1) {
  const dia = dias[i];
  const plan = RUTINA[i];
  const [[n]] = await conn.query('SELECT COUNT(*) AS n FROM gym_exercises WHERE day_id = ?', [dia.id]);
  if (n.n > 0) {
    console.log(`  · «${dia.name}» ya tenía ${n.n} ejercicios, no se toca`);
    continue;
  }
  await conn.query('UPDATE gym_days SET name = ? WHERE id = ? AND user_id = ?', [plan.name, dia.id, u.id]);
  for (let j = 0; j < plan.ejercicios.length; j += 1) {
    const [name, muscles, sets, reps, weight, seconds, notes] = plan.ejercicios[j];
    await conn.query(
      `INSERT INTO gym_exercises
         (user_id, day_id, muscles, name, kind, target_sets, target_reps, target_weight, rest_seconds, notes, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [u.id, dia.id, muscles, name, seconds ? 'tiempo' : 'repes', sets, reps ?? `${seconds}s`, weight, null, notes, j],
    );
    creados += 1;
  }
  console.log(`  ✔ «${plan.name}» con ${plan.ejercicios.length} ejercicios`);
}

console.log(`\n${creados} ejercicios cargados. Revísalos en el portal: los pesos por serie están en las notas.`);
await conn.end();
